import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampToWorkArea, pickWorkArea, defaultCollapsedBounds, restoreBounds, planExpand, planCollapse,
} from '../src/core/geometry.js';

const wa = { x: 0, y: 0, width: 1920, height: 1040 };
const small = { width: 180, height: 170 };
const big = { width: 380, height: 560 };

test('clamp keeps a window inside the work area and shrinks oversized ones', () => {
  assert.deepEqual(clampToWorkArea({ x: -50, y: -20, width: 100, height: 100 }, wa), { x: 0, y: 0, width: 100, height: 100 });
  assert.deepEqual(clampToWorkArea({ x: 1900, y: 1030, width: 100, height: 100 }, wa), { x: 1820, y: 940, width: 100, height: 100 });
  const huge = clampToWorkArea({ x: 0, y: 0, width: 5000, height: 5000 }, wa);
  assert.deepEqual([huge.width, huge.height], [1920, 1040]);
});

test('work area choice follows the largest overlap', () => {
  const left = { x: 0, y: 0, width: 1000, height: 800 };
  const right = { x: 1000, y: 0, width: 1000, height: 800 };
  assert.equal(pickWorkArea({ x: 900, y: 100, width: 300, height: 300 }, [left, right]), right);
  assert.equal(pickWorkArea({ x: 700, y: 100, width: 300, height: 300 }, [left, right]), left);
  assert.equal(pickWorkArea({ x: 5000, y: 5000, width: 10, height: 10 }, [left, right]), left);
});

test('first run lands bottom-right with a margin', () => {
  const b = defaultCollapsedBounds(small, wa);
  assert.deepEqual(b, { x: 1920 - 180 - 24, y: 1040 - 170 - 24, width: 180, height: 170 });
});

test('saved positions are restored, or reset when that display is gone', () => {
  assert.deepEqual(restoreBounds({ x: 300, y: 200 }, small, [wa]), { x: 300, y: 200, ...small });
  assert.deepEqual(restoreBounds({ x: 9000, y: 9000 }, small, [wa]), defaultCollapsedBounds(small, wa));
  assert.deepEqual(restoreBounds({ x: null, y: null }, small, [wa]), defaultCollapsedBounds(small, wa));
  assert.deepEqual(restoreBounds(undefined, small, [wa]), defaultCollapsedBounds(small, wa));
});

test('expanding near the top grows downward and keeps the character in place', () => {
  const collapsed = { x: 800, y: 100, ...small };
  const { bounds, flipped } = planExpand(collapsed, big, wa);
  assert.equal(flipped, false);
  assert.equal(bounds.y, 100);
  assert.equal(bounds.x + bounds.width / 2, collapsed.x + collapsed.width / 2);
});

test('expanding near the bottom grows upward (flipped) so nothing falls off screen', () => {
  const collapsed = { x: 1700, y: 850, ...small }; // bottom edge at 1020
  const { bounds, flipped } = planExpand(collapsed, big, wa);
  assert.equal(flipped, true);
  assert.equal(bounds.y + bounds.height, 850 + 170); // bottom edges line up
  assert.ok(bounds.y >= 0);
  assert.ok(bounds.x + bounds.width <= 1920);
});

test('collapse restores the exact original spot, even after edge clamping', () => {
  const collapsed = { x: 1700, y: 850, ...small }; // right edge at 1880: the wider expanded window gets clamped sideways
  const { bounds, session } = planExpand(collapsed, big, wa);
  assert.notEqual(bounds.x + bounds.width / 2, collapsed.x + collapsed.width / 2, 'clamped: center drifted');
  assert.deepEqual(planCollapse(bounds, small, wa, session), collapsed);
});

test('collapse after the user dragged the expanded window keeps the character where it is now', () => {
  const collapsed = { x: 800, y: 100, ...small };
  const { bounds, session } = planExpand(collapsed, big, wa);
  const dragged = { ...bounds, x: bounds.x + 200, y: bounds.y + 50 };
  const back = planCollapse(dragged, small, wa, session);
  assert.equal(back.y, dragged.y);
  assert.equal(back.x + back.width / 2, dragged.x + dragged.width / 2);
});

test('a flipped window that was dragged collapses toward its bottom edge', () => {
  const collapsed = { x: 1000, y: 850, ...small };
  const { bounds, session } = planExpand(collapsed, big, wa);
  assert.equal(session.flipped, true);
  const dragged = { ...bounds, y: bounds.y - 100 };
  const back = planCollapse(dragged, small, wa, session);
  assert.equal(back.y + back.height, dragged.y + dragged.height);
});

test('when neither direction fits, it stays top-anchored and is clamped', () => {
  const tiny = { x: 0, y: 0, width: 800, height: 400 };
  const { bounds, flipped } = planExpand({ x: 300, y: 100, ...small }, big, tiny);
  assert.equal(flipped, false);
  assert.ok(bounds.y + bounds.height <= 400);
});
