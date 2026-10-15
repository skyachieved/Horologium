import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHandler, resolveInside, CSP } from '../src/main/protocol.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'horologium-proto-'));
const dirs = Object.fromEntries(['renderer', 'core', 'bundled', 'user'].map((d) => [d, path.join(tmp, d)]));
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(dirs.renderer, 'index.html'), '<h1>hi</h1>');
fs.writeFileSync(path.join(dirs.renderer, 'app.js'), 'export {};');
fs.writeFileSync(path.join(dirs.renderer, 'notes.txt'), 'plain text is not served');
fs.writeFileSync(path.join(dirs.core, 'hydration.js'), 'export const x = 1;');
fs.mkdirSync(path.join(dirs.bundled, 'themes'), { recursive: true });
fs.writeFileSync(path.join(dirs.bundled, 'themes', 'tokens.css'), ':root{}');
fs.writeFileSync(path.join(tmp, 'secret.js'), 'export const secret = 1;');

const handle = createHandler({ rendererRoot: dirs.renderer, coreRoot: dirs.core, bundledExtRoot: dirs.bundled, userExtRoot: dirs.user });
const get = (p, host = 'app') => handle({ url: `horologium://${host}${p}` });

test('serves renderer files with the right type and a strict CSP', async () => {
  const res = await get('/index.html');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('content-security-policy'), CSP);
  assert.equal(await res.text(), '<h1>hi</h1>');
  assert.match((await get('/app.js')).headers.get('content-type'), /javascript/);
});

test('the root path serves index.html', async () => {
  assert.equal(await (await get('/')).text(), '<h1>hi</h1>');
});

test('routes /core and /ext to their own roots', async () => {
  assert.equal(await (await get('/core/hydration.js')).text(), 'export const x = 1;');
  const css = await get('/ext/bundled/themes/tokens.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
});

test('path traversal is refused on every route', async () => {
  for (const p of [
    '/ext/bundled/..%2F..%2Fsecret.js',
    '/core/..%2Fsecret.js',
    '/..%2Fsecret.js',
    '/ext/bundled/%2e%2e%2f%2e%2e%2fsecret.js',
  ]) {
    const res = await get(p);
    assert.ok([403, 404].includes(res.status), `${p} -> ${res.status}`);
    assert.doesNotMatch(await res.text(), /secret = 1/);
  }
});

test('unknown file types, other hosts, and a missing user root are not served', async () => {
  assert.equal((await get('/notes.txt')).status, 404);
  assert.equal((await get('/index.html', 'evil')).status, 404);
  assert.equal((await get('/nope.js')).status, 404);
  const noUser = createHandler({ rendererRoot: dirs.renderer, coreRoot: dirs.core, bundledExtRoot: dirs.bundled, userExtRoot: null });
  assert.equal((await noUser({ url: 'horologium://app/ext/user/x.css' })).status, 404);
});

test('resolveInside only allows paths under the root', () => {
  assert.equal(resolveInside('/a/b', 'c/d.js'), path.resolve('/a/b/c/d.js'));
  assert.equal(resolveInside('/a/b', '../c'), null);
  assert.equal(resolveInside('/a/b', '../b-evil/x'), null);
  assert.equal(resolveInside('/a/b', 'c/../../d'), null);
});
