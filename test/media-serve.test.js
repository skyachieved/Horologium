import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseRange, serveFileWithRange } from '../src/main/media-serve.js';
import { createHandler } from '../src/main/protocol.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'horologium-serve-'));
const file = path.join(tmp, 'tone.wav');
const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
fs.writeFileSync(file, bytes);
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const req = (range) => ({ headers: new Headers(range ? { range } : {}) });

test('parseRange handles open, closed and suffix ranges and rejects nonsense', () => {
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=900-5000', 1000), { start: 900, end: 999 }, 'end is clamped to the file');
  assert.equal(parseRange('bytes=1000-', 1000), null, 'start beyond the end');
  assert.equal(parseRange('bytes=50-10', 1000), null);
  assert.equal(parseRange('bytes=-0', 1000), null);
  assert.equal(parseRange('bytes=-', 1000), null);
  assert.equal(parseRange('items=0-1', 1000), null);
  assert.equal(parseRange(undefined, 1000), null);
});

test('no Range header: 200 with the full length and Accept-Ranges', async () => {
  const res = await serveFileWithRange(file, req(), 'audio/wav');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('content-length'), '1000');
  assert.equal(res.headers.get('content-type'), 'audio/wav');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes);
});

test('a Range request gets 206 with the exact slice and Content-Range', async () => {
  const res = await serveFileWithRange(file, req('bytes=100-199'), 'audio/wav');
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 100-199/1000');
  assert.equal(res.headers.get('content-length'), '100');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes.subarray(100, 200));

  const open = await serveFileWithRange(file, req('bytes=950-'), 'audio/wav');
  assert.equal(open.headers.get('content-range'), 'bytes 950-999/1000');
  assert.deepEqual(Buffer.from(await open.arrayBuffer()), bytes.subarray(950));
});

test('an unsatisfiable range gets 416 with the file size', async () => {
  const res = await serveFileWithRange(file, req('bytes=5000-'), 'audio/wav');
  assert.equal(res.status, 416);
  assert.equal(res.headers.get('content-range'), 'bytes */1000');
});

test('a missing file rejects (the protocol handler turns that into 404)', async () => {
  await assert.rejects(() => serveFileWithRange(path.join(tmp, 'nope.wav'), req(), 'audio/wav'));
});

test('through the protocol handler both audio routes are range-aware (this is what makes seeking work in the app)', async () => {
  const handler = createHandler({
    rendererRoot: tmp, coreRoot: tmp, bundledExtRoot: tmp, userExtRoot: tmp,
    mediaRoots: () => ({ abc123: tmp }), serveFile: serveFileWithRange,
  });
  for (const route of ['/media/abc123/tone.wav', '/ext/user/tone.wav']) {
    const part = await handler({ url: `horologium://app${route}`, headers: new Headers({ range: 'bytes=10-19' }) });
    assert.equal(part.status, 206, route);
    assert.equal(part.headers.get('content-range'), 'bytes 10-19/1000', route);
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(10, 20), route);

    const whole = await handler({ url: `horologium://app${route}` }); // a request object without headers must still work
    assert.equal(whole.status, 200, route);
    assert.equal(whole.headers.get('content-length'), '1000', route);
    assert.equal(whole.headers.get('accept-ranges'), 'bytes', route);
    assert.equal(whole.headers.get('content-type'), 'audio/wav', route);
    await whole.arrayBuffer();
  }
  assert.equal((await handler({ url: 'horologium://app/media/abc123/missing.wav' })).status, 404);
});
