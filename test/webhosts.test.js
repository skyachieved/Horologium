import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostMatches, isNavigationAllowed, isExternalOpenAllowed } from '../src/core/webhosts.js';

const YT = ['youtube.com', '*.youtube.com', 'googlevideo.com', '*.googlevideo.com'];

test('exact and wildcard patterns', () => {
  assert.equal(hostMatches('youtube.com', 'youtube.com'), true);
  assert.equal(hostMatches('YouTube.COM', 'youtube.com'), true);
  assert.equal(hostMatches('www.youtube.com', 'youtube.com'), false);
  assert.equal(hostMatches('www.youtube.com', '*.youtube.com'), true);
  assert.equal(hostMatches('a.b.youtube.com', '*.youtube.com'), true);
  assert.equal(hostMatches('youtube.com', '*.youtube.com'), false, 'wildcard means a subdomain, not the apex');
  assert.equal(hostMatches('youtube.com.', 'youtube.com'), true, 'trailing dot is the same host');
});

test('look-alike hosts do not match', () => {
  assert.equal(hostMatches('evilyoutube.com', '*.youtube.com'), false);
  assert.equal(hostMatches('youtube.com.evil.com', '*.youtube.com'), false);
  assert.equal(hostMatches('youtube.com.evil.com', 'youtube.com'), false);
  assert.equal(hostMatches('notyoutube.com', 'youtube.com'), false);
});

test('only https URLs on allowed hosts may be navigated to', () => {
  assert.equal(isNavigationAllowed('https://www.youtube.com/watch?v=abc', YT), true);
  assert.equal(isNavigationAllowed('https://music.youtube.com/', YT), true);
  assert.equal(isNavigationAllowed('https://rr1---sn.googlevideo.com/videoplayback', YT), true);
  assert.equal(isNavigationAllowed('https://youtube.com:8443/x', YT), true, 'port does not change the host');
  assert.equal(isNavigationAllowed('http://www.youtube.com/', YT), false);
  assert.equal(isNavigationAllowed('https://evil.example/', YT), false);
  assert.equal(isNavigationAllowed('javascript:alert(1)', YT), false);
  assert.equal(isNavigationAllowed('file:///etc/passwd', YT), false);
  assert.equal(isNavigationAllowed('data:text/html,<script>1</script>', YT), false);
  assert.equal(isNavigationAllowed('blob:https://www.youtube.com/abc', YT), false);
  assert.equal(isNavigationAllowed('not a url', YT), false);
  assert.equal(isNavigationAllowed('', YT), false);
});

test('credential tricks are judged by the real host', () => {
  assert.equal(isNavigationAllowed('https://youtube.com@evil.example/', YT), false);
  assert.equal(isNavigationAllowed('https://user:pw@www.youtube.com/', YT), false, 'embedded credentials are refused outright');
  // A backslash ends the host in the URL standard, so Chromium also navigates to www.youtube.com here: allowing
  // it is correct. What matters is that we judge the same host the browser will connect to (we use the same parser).
  assert.equal(isNavigationAllowed('https://www.youtube.com\\@evil.example/', YT), true);
  assert.equal(new URL('https://www.youtube.com\\@evil.example/').hostname, 'www.youtube.com');
});

test('external opening is https only', () => {
  assert.equal(isExternalOpenAllowed('https://open.spotify.com/'), true);
  assert.equal(isExternalOpenAllowed('http://example.com'), false);
  assert.equal(isExternalOpenAllowed('file:///C:/Windows/System32/calc.exe'), false);
  assert.equal(isExternalOpenAllowed('ms-msdt:/id PCWDiagnostic'), false);
  assert.equal(isExternalOpenAllowed('https://user:pw@example.com'), false);
});
