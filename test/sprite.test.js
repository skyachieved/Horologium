import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSprite, spriteSvg, SPRITE_STATES } from '../src/core/sprite.js';
import { checkSvgSafety } from '../src/core/svg.js';

const row = (s) => s.padEnd(8, '.');
const frame = (...rows) => Array.from({ length: 8 }, (_, i) => row(rows[i] ?? ''));
const sprite = (extra = {}) => ({
  size: [8, 8],
  palette: { o: '#222222', a: '#ff6b5b' },
  frames: { idle: [frame('..oooo', '.oaaaao', '.oaaaao', '..oooo'), frame('', '..oooo', '.oaaaao', '..oooo')] },
  ...extra,
});

test('a valid sprite has no problems', () => {
  assert.deepEqual(checkSprite(sprite()), []);
});

test('problems: wrong sizes, unknown colours, bad palette keys, unknown states, no idle', () => {
  const bad = sprite({ palette: { o: '#222222', '..': '#000000' } });
  bad.frames.idle[0] = ['oooo'];
  bad.frames.dance = [frame('x')];
  const text = checkSprite(bad).join('\n');
  assert.match(text, /palette key "\.\."/);
  assert.match(text, /1 rows, expected 8/);
  assert.match(text, /4 columns, expected 8/);
  assert.match(text, /unknown state/);
  assert.match(text, /"a" is not in the palette/);
  assert.match(text, /"x" is not in the palette/);
  assert.match(checkSprite({ ...sprite(), frames: { wave: [frame()] } }).join(), /frames\.idle needs at least one frame/);
});

test('the SVG has a group per state (missing states reuse idle), merged pixel runs, and passes the SVG safety check', () => {
  const svg = spriteSvg(sprite());
  for (const s of SPRITE_STATES) assert.match(svg, new RegExp(`data-state="${s}"`));
  assert.match(svg, /<rect x="2" y="0" width="4" height="1" fill="#222222"\/>/, 'a run of 4 outline pixels is one rect');
  assert.match(svg, /animation: hz-sprite-2 [\d.]+s steps\(1, end\) 0\.000s infinite/);
  assert.match(svg, /hz-sprite-2 [\d.]+s steps\(1, end\) 0\.333s infinite/, 'the second frame waits for its slot (2 frames at 3 fps)');
  assert.deepEqual(checkSvgSafety(svg), []);
});

test('a single-frame state is always visible and not animated', () => {
  const svg = spriteSvg({ ...sprite(), frames: { idle: [frame('oo')] } });
  assert.match(svg, /class="sprite-frame solo">/);
  assert.doesNotMatch(svg, /hz-sprite-1/);
});
