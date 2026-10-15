import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINI, cropLayout, defaultMiniPosition, fadeTarget, stepOpacity, pointInside } from '../src/core/mini.js';

test('crop: the window shows exactly the video, scaled to the mini width', () => {
  const viewport = { width: 922, height: 468 };
  const video = { x: 0, y: 12, width: 922, height: 519 };
  const c = cropLayout({ viewport, video });
  assert.ok(Math.abs(c.zoom - MINI.width / 922) < 1e-9);
  assert.equal(c.window.width, MINI.width);
  assert.equal(c.window.height, Math.round(519 * c.zoom) + MINI.strip);
  // the video's top-left lands at (0, strip) inside the window
  assert.equal(c.view.x, 0);
  assert.equal(c.view.y, Math.round(-12 * c.zoom + MINI.strip));
  // the view keeps the same CSS viewport (bounds / zoom), so the page does not reflow
  // (rounding to a whole device pixel is up to 1/zoom CSS pixels)
  assert.ok(Math.abs(c.view.width / c.zoom - viewport.width) <= 1 / c.zoom);
  assert.ok(Math.abs(c.view.height / c.zoom - viewport.height) <= 1 / c.zoom);
});

test('crop: an offset video is shifted into place by a negative view origin', () => {
  const c = cropLayout({ viewport: { width: 1200, height: 700 }, video: { x: 24, y: 80, width: 800, height: 450 }, miniWidth: 400 });
  assert.ok(c.view.x < 0 && c.view.y < MINI.strip);
  assert.equal(c.window.width, 400);
  assert.ok(Math.abs(c.window.height - (450 * 0.5 + MINI.strip)) <= 1);
});

test('crop: width and zoom are clamped to sane limits', () => {
  assert.equal(cropLayout({ viewport: { width: 900, height: 500 }, video: { x: 0, y: 0, width: 900, height: 506 }, miniWidth: 5000 }).window.width, Math.round(900 * (MINI.maxWidth / 900)));
  const tiny = cropLayout({ viewport: { width: 900, height: 500 }, video: { x: 0, y: 0, width: 4000, height: 2250 } });
  assert.ok(tiny.zoom >= MINI.zoomMin);
  const huge = cropLayout({ viewport: { width: 900, height: 500 }, video: { x: 0, y: 0, width: 50, height: 28 } });
  assert.ok(huge.zoom <= MINI.zoomMax);
});

test('default position: bottom-right, lifted above the collapsed widget, always inside the work area', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  const p = defaultMiniPosition({ width: 320, height: 202 }, wa);
  assert.deepEqual(p, { x: 1920 - 320 - MINI.margin, y: 1040 - 202 - MINI.margin - MINI.lift });
  const small = defaultMiniPosition({ width: 320, height: 202 }, { x: 100, y: 50, width: 400, height: 260 });
  assert.ok(small.x >= 100 && small.y >= 50 && small.x + 320 <= 500 && small.y + 202 <= 310);
});

test('fade: full opacity while hovered or recently used, dim (not invisible) after 3 s of rest', () => {
  const t0 = 1_000_000;
  assert.equal(fadeTarget({ hovering: true, lastActiveAt: t0 - 60_000, now: t0 }), 1);
  assert.equal(fadeTarget({ hovering: false, lastActiveAt: t0 - 1000, now: t0 }), 1);
  assert.equal(fadeTarget({ hovering: false, lastActiveAt: t0 - MINI.fadeAfterMs, now: t0 }), MINI.dimOpacity);
  assert.ok(MINI.dimOpacity > 0.2, 'dimmed, never invisible');
});

test('opacity animates toward its target, brightening faster than dimming, and settles exactly', () => {
  let o = 1;
  for (let i = 0; i < 200; i += 1) o = stepOpacity(o, MINI.dimOpacity);
  assert.equal(o, MINI.dimOpacity);
  const up = stepOpacity(0.35, 1) - 0.35;
  const down = 1 - stepOpacity(1, 0.35);
  assert.ok(up / 0.65 > down / 0.65, 'brightening is quicker');
  assert.equal(stepOpacity(0.5, 0.5), 0.5);
});

test('pointInside uses a half-open rectangle', () => {
  const r = { x: 10, y: 10, width: 100, height: 50 };
  assert.equal(pointInside({ x: 10, y: 10 }, r), true);
  assert.equal(pointInside({ x: 109, y: 59 }, r), true);
  assert.equal(pointInside({ x: 110, y: 30 }, r), false);
  assert.equal(pointInside({ x: 5, y: 30 }, r), false);
});
