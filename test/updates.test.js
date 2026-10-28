import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVersion, compareVersions, isNewer, updateRoute, shouldCheck, shouldNotify, notesToText, hasUnseenNews, CHECK_EVERY_MS } from '../src/core/updates.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('versions compare like semver, with pre-releases before their release', () => {
  assert.deepEqual(parseVersion('v1.2.3'), { major: 1, minor: 2, patch: 3, pre: null });
  assert.equal(parseVersion('1.2'), null);
  assert.equal(parseVersion('latest'), null);
  assert.equal(compareVersions('0.2.0', '0.1.9'), 1);
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1, 'numeric, not alphabetical');
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0-beta.10', '1.0.0-beta.2'), 1);
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1);
  assert.equal(compareVersions('1.0.0-1', '1.0.0-alpha'), -1, 'numeric identifiers sort first');
  assert.ok(isNewer('0.2.0', '0.1.0'));
  assert.ok(!isNewer('0.1.0', '0.1.0'));
  assert.ok(!isNewer('<script>', '0.1.0'), 'garbage from the network is never newer');
});

test('the update route follows how the app was installed', () => {
  assert.equal(updateRoute({ packaged: false, platform: 'win32' }), 'source');
  assert.equal(updateRoute({ packaged: true, platform: 'win32' }), 'install');
  assert.equal(updateRoute({ packaged: true, platform: 'linux', appImage: true }), 'install');
  assert.equal(updateRoute({ packaged: true, platform: 'linux', appImage: false }), 'download', 'a .deb opens the release page');
  assert.equal(updateRoute({ packaged: true, platform: 'darwin' }), 'download', 'unsigned macOS apps cannot replace themselves');
});

test('automatic checks respect the setting and the interval; manual checks always run', () => {
  const now = 10 * CHECK_EVERY_MS;
  assert.ok(shouldCheck({ enabled: true, lastCheckedAt: null, now }));
  assert.ok(!shouldCheck({ enabled: true, lastCheckedAt: now - 60 * 60 * 1000, now }));
  assert.ok(shouldCheck({ enabled: true, lastCheckedAt: now - CHECK_EVERY_MS, now }));
  assert.ok(!shouldCheck({ enabled: false, lastCheckedAt: null, now }), 'turned off in Settings');
  assert.ok(shouldCheck({ enabled: false, manual: true, now }));
  assert.ok(shouldNotify({ latest: '0.3.0', notifiedVersion: '0.2.0' }));
  assert.ok(!shouldNotify({ latest: '0.3.0', notifiedVersion: '0.3.0' }), 'one notification per version');
});

test('release notes become plain text, never markup', () => {
  const md = '## What\'s new\r\n\r\n- **Pixel** characters\n* Fixed `sound`\n\n\nSee [the notes](https://x.y).\n';
  assert.deepEqual(notesToText(md), ["What's new", '', '• Pixel characters', '• Fixed sound', '', 'See the notes.']);
  const html = '<h2>New</h2><ul><li>Sprites &amp; speech</li><li><img src=x onerror=alert(1)>Updates</li></ul><p>Bye</p>';
  const lines = notesToText(html);
  assert.ok(lines.includes('• Sprites & speech'));
  assert.ok(lines.includes('• Updates'));
  assert.ok(!lines.join('').includes('<'), 'no tags survive');
  assert.equal(notesToText('x\n'.repeat(500)).length, 60, 'capped');
  assert.deepEqual(notesToText(null), []);
});

test('the News dot shows after an upgrade until News is opened', () => {
  assert.ok(hasUnseenNews({ seen: '0.1.0', current: '0.2.0' }));
  assert.ok(!hasUnseenNews({ seen: '0.2.0', current: '0.2.0' }));
  assert.ok(hasUnseenNews({ seen: null, current: '0.2.0' }));
});

test('the bundled news covers this version, in English and Korean (update news.json with every release)', () => {
  const news = JSON.parse(fs.readFileSync(path.join(root, 'src/renderer/news.json'), 'utf8'));
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(news[0].version, version, 'the newest entry must be the version in package.json');
  for (let i = 0; i < news.length; i += 1) {
    const entry = news[i];
    assert.ok(parseVersion(entry.version) && /^\d{4}-\d{2}-\d{2}$/.test(entry.date), JSON.stringify(entry).slice(0, 80));
    if (i > 0) assert.equal(compareVersions(news[i - 1].version, entry.version), 1, 'newest first');
    for (const lang of ['en', 'ko']) {
      assert.ok(entry[lang]?.title && entry[lang].items.length, `${entry.version}.${lang}`);
    }
    assert.equal(entry.en.items.length, entry.ko.items.length, `${entry.version}: every English item has a Korean one`);
  }
});
