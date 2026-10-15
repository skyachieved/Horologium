import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanFolder, titleFromFile, isAudioFile } from '../src/main/media-scan.js';
import { createHandler } from '../src/main/protocol.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'horologium-media-'));
const lib = path.join(tmp, 'library');
const touch = (rel, body = 'x') => {
  const full = path.join(lib, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
};
touch('01 - Night Drive.mp3', 'AUDIO');
touch('10 - Last.flac');
touch('02_rain_on_glass.ogg');
touch('album/a.wav');
touch('album/notes.txt');
touch('album/cover.jpg');
touch('.hidden/secret.mp3');
touch('album/deeper/b.opus');
fs.writeFileSync(path.join(tmp, 'outside.mp3'), 'SECRET');

test('scanFolder finds only audio, naturally sorted, relative with forward slashes, skipping hidden folders', () => {
  const found = scanFolder(lib);
  assert.deepEqual(found.map((f) => f.file), ['01 - Night Drive.mp3', '02_rain_on_glass.ogg', '10 - Last.flac', 'album/a.wav', 'album/deeper/b.opus']);
});

test('titles are tidied from file names', () => {
  assert.equal(titleFromFile('01 - Night Drive.mp3'), 'Night Drive');
  assert.equal(titleFromFile('02_rain_on_glass.ogg'), 'rain on glass');
  assert.equal(titleFromFile('7. Seven.flac'), 'Seven');
  assert.equal(titleFromFile('2024.mp3'), '2024', 'a name that is only a number is kept');
  assert.equal(isAudioFile('X.MP3'), true);
  assert.equal(isAudioFile('x.exe'), false);
});

test('scanFolder respects its limits and survives a missing folder', () => {
  assert.equal(scanFolder(lib, { maxFiles: 2 }).length, 2);
  assert.equal(scanFolder(lib, { maxDepth: 0 }).length, 3);
  assert.deepEqual(scanFolder(path.join(tmp, 'nope')), []);
});

const handler = createHandler({
  rendererRoot: tmp, coreRoot: tmp, bundledExtRoot: tmp, userExtRoot: null,
  mediaRoots: () => ({ abc123: lib }),
});
const get = (p) => handler({ url: `horologium://app${p}` });

test('the media route serves audio from a chosen folder with the right type', async () => {
  const res = await get('/media/abc123/01%20-%20Night%20Drive.mp3');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/mpeg');
  assert.equal(await res.text(), 'AUDIO');
  assert.equal((await get('/media/abc123/album/deeper/b.opus')).headers.get('content-type'), 'audio/ogg');
});

test('the media route refuses everything that is not audio inside a registered folder', async () => {
  assert.equal((await get('/media/abc123/album/notes.txt')).status, 404);
  assert.equal((await get('/media/abc123/album/cover.jpg')).status, 404);
  assert.equal((await get('/media/zzz999/01%20-%20Night%20Drive.mp3')).status, 404, 'unknown folder id');
  for (const p of ['/media/abc123/..%2Foutside.mp3', '/media/abc123/album%2F..%2F..%2Foutside.mp3', '/media/abc123/%2e%2e%2foutside.mp3']) {
    const res = await get(p);
    assert.ok([403, 404].includes(res.status), `${p} -> ${res.status}`);
    assert.doesNotMatch(await res.text(), /SECRET/);
  }
});

test('removing a folder stops serving it immediately', async () => {
  let roots = { abc123: lib };
  const h = createHandler({ rendererRoot: tmp, coreRoot: tmp, bundledExtRoot: tmp, userExtRoot: null, mediaRoots: () => roots });
  assert.equal((await h({ url: 'horologium://app/media/abc123/10%20-%20Last.flac' })).status, 200);
  roots = {};
  assert.equal((await h({ url: 'horologium://app/media/abc123/10%20-%20Last.flac' })).status, 404);
});
