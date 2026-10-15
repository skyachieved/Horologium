import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGarbageCollector } from '../src/main/gc.js';

function fakeWebContents({ attached = false, failOn = null, destroyed = false } = {}) {
  const log = [];
  let isAttached = attached;
  return {
    log,
    isDestroyed: () => destroyed,
    debugger: {
      isAttached: () => isAttached,
      attach: (v) => { if (failOn === 'attach') throw new Error('attach failed'); isAttached = true; log.push(`attach ${v}`); },
      sendCommand: async (m) => { if (failOn === 'send') throw new Error('send failed'); log.push(m); },
      detach: () => { isAttached = false; log.push('detach'); },
    },
  };
}

test('attaches, collects, detaches (so no debugger stays attached to the widget)', async () => {
  const wc = fakeWebContents();
  const collect = createGarbageCollector(() => wc);
  assert.equal(await collect(), true);
  assert.deepEqual(wc.log, ['attach 1.3', 'HeapProfiler.collectGarbage', 'detach']);
});

test('an already attached debugger (DevTools open) is used but never detached', async () => {
  const wc = fakeWebContents({ attached: true });
  const collect = createGarbageCollector(() => wc);
  assert.equal(await collect(), true);
  assert.deepEqual(wc.log, ['HeapProfiler.collectGarbage']);
});

test('calls closer together than the minimum gap are skipped', async () => {
  let clock = 1_000_000;
  const wc = fakeWebContents();
  const collect = createGarbageCollector(() => wc, { minGapMs: 15_000, now: () => clock });
  assert.equal(await collect(), true);
  clock += 14_999;
  assert.equal(await collect(), false, 'too soon');
  clock += 1;
  assert.equal(await collect(), true);
  assert.equal(wc.log.filter((l) => l === 'HeapProfiler.collectGarbage').length, 2);
});

test('overlapping calls run one collection at a time', async () => {
  const wc = fakeWebContents();
  const collect = createGarbageCollector(() => wc, { minGapMs: 0 });
  const results = await Promise.all([collect(), collect(), collect()]);
  assert.deepEqual(results, [true, false, false]);
});

test('failures are swallowed, the debugger is still detached, and a later call may retry', async () => {
  const sendFails = fakeWebContents({ failOn: 'send' });
  const collect = createGarbageCollector(() => sendFails, { minGapMs: 0 });
  assert.equal(await collect(), false);
  assert.deepEqual(sendFails.log, ['attach 1.3', 'detach']);
  sendFails.debugger.sendCommand = async (m) => { sendFails.log.push(m); };
  assert.equal(await collect(), true, 'a failed run does not start the throttle window');

  const attachFails = fakeWebContents({ failOn: 'attach' });
  assert.equal(await createGarbageCollector(() => attachFails)(), false);
});

test('a missing or destroyed window is a no-op', async () => {
  assert.equal(await createGarbageCollector(() => null)(), false);
  const dead = fakeWebContents({ destroyed: true });
  assert.equal(await createGarbageCollector(() => dead)(), false);
  assert.deepEqual(dead.log, []);
});
