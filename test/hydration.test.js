import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  totalBodyWaterL, calculateDailyTarget, climateAddOnMl, validateProfile, nextReminder, dayWindow,
  dayKey, milestoneCrossed, typicalGapMin, DAY_LENGTH_MS, MIN_GAP_MS, MAX_GAP_MS, EXERCISE_CAP_ML,
  kgFromLb, lbFromKg, cmFromInches, inchesFromCm, flozFromMl, mlFromFloz,
} from '../src/core/hydration.js';

const man = { sex: 'male', age: 30, heightCm: 175, weightKg: 70, exerciseIntensity: 'none', exerciseMin: 0, cupMl: 355 };
const woman = { sex: 'female', age: 30, heightCm: 165, weightKg: 60, exerciseIntensity: 'none', exerciseMin: 0, cupMl: 355 };
const MIN = 60 * 1000;

test('Watson TBW matches hand calculation for reference adults', () => {
  assert.ok(Math.abs(totalBodyWaterL(man) - 42.03) < 0.05);
  assert.ok(Math.abs(totalBodyWaterL(woman) - 30.34) < 0.05);
});

test('reference man lands near 3.0 L and reference woman near 2.2 L', () => {
  const m = calculateDailyTarget(man);
  const w = calculateDailyTarget(woman);
  assert.ok(m.totalMl >= 2950 && m.totalMl <= 3100, `man ${m.totalMl}`);
  assert.ok(w.totalMl >= 2100 && w.totalMl <= 2300, `woman ${w.totalMl}`);
});

test('sex "other" sits between male and female TBW for the same body', () => {
  const body = { age: 30, heightCm: 170, weightKg: 65 };
  const lo = totalBodyWaterL({ ...body, sex: 'female' });
  const hi = totalBodyWaterL({ ...body, sex: 'male' });
  const mid = totalBodyWaterL({ ...body, sex: 'other' });
  assert.ok(mid > Math.min(lo, hi) && mid < Math.max(lo, hi));
});

test('target increases with weight, exercise and heat', () => {
  const base = calculateDailyTarget(man).totalMl;
  assert.ok(calculateDailyTarget({ ...man, weightKg: 90 }).totalMl > base);
  assert.ok(calculateDailyTarget({ ...man, exerciseIntensity: 'moderate', exerciseMin: 60 }).totalMl > base);
  assert.ok(calculateDailyTarget(man, { tempC: 33, humidityPct: 40 }).totalMl > base);
});

test('exercise is intensity x minutes, capped', () => {
  assert.equal(calculateDailyTarget({ ...man, exerciseIntensity: 'moderate', exerciseMin: 60 }).exerciseMl, 500);
  assert.equal(calculateDailyTarget({ ...man, exerciseIntensity: 'vigorous', exerciseMin: 30 }).exerciseMl, 400);
  assert.equal(calculateDailyTarget({ ...man, exerciseIntensity: 'vigorous', exerciseMin: 300 }).exerciseMl, EXERCISE_CAP_ML);
  assert.equal(calculateDailyTarget({ ...man, exerciseIntensity: 'none', exerciseMin: 120 }).exerciseMl, 0);
});

test('climate add-on bands', () => {
  assert.equal(climateAddOnMl(null), 0);
  assert.equal(climateAddOnMl({ tempC: 15, humidityPct: 90 }), 0);
  assert.equal(climateAddOnMl({ tempC: 24 }), 250);
  assert.equal(climateAddOnMl({ tempC: 29.9, humidityPct: 50 }), 250);
  assert.equal(climateAddOnMl({ tempC: 31 }), 500);
  assert.equal(climateAddOnMl({ tempC: 27, humidityPct: 80 }), 500);
  assert.equal(climateAddOnMl({ level: 'warm' }), 250);
  assert.equal(climateAddOnMl({ level: 'hot' }), 500);
  assert.equal(climateAddOnMl({ tempC: Number.NaN }), 0);
});

test('target is clamped to 1.2-4.5 L and flagged', () => {
  const tiny = calculateDailyTarget({ sex: 'female', age: 40, heightCm: 100, weightKg: 30, exerciseIntensity: 'none', exerciseMin: 0, cupMl: 250 });
  assert.equal(tiny.totalMl, 1200);
  assert.equal(tiny.clamped, true);
  const huge = calculateDailyTarget({ sex: 'male', age: 12, heightCm: 230, weightKg: 250, exerciseIntensity: 'vigorous', exerciseMin: 300, cupMl: 500 }, { level: 'hot' });
  assert.equal(huge.totalMl, 4500);
  assert.equal(huge.clamped, true);
});

test('cups are whole numbers of the chosen cup size', () => {
  const t = calculateDailyTarget({ ...man, cupMl: 250 });
  assert.ok(Number.isInteger(t.cups) && t.cups >= 1);
  assert.equal(t.cupsMl, t.cups * 250);
  assert.ok(Math.abs(t.cupsMl - t.totalMl) <= 125);
  const big = calculateDailyTarget({ ...man, cupMl: 500 });
  assert.ok(big.cups < t.cups);
});

test('validateProfile reports machine-readable problems', () => {
  assert.deepEqual(validateProfile(man), []);
  const bad = validateProfile({ ...man, age: 5, weightKg: Number.NaN, sex: 'x' });
  const by = Object.fromEntries(bad.map((p) => [p.field, p.code]));
  assert.equal(by.age, 'range');
  assert.equal(by.weightKg, 'missing');
  assert.equal(by.sex, 'choice');
  assert.deepEqual(validateProfile(null), [{ field: 'profile', code: 'missing' }]);
});

test('unit conversions round-trip', () => {
  assert.ok(Math.abs(lbFromKg(kgFromLb(150)) - 150) < 1e-9);
  assert.ok(Math.abs(inchesFromCm(cmFromInches(70)) - 70) < 1e-9);
  assert.ok(Math.abs(flozFromMl(mlFromFloz(12)) - 12) < 1e-9);
  assert.ok(Math.abs(mlFromFloz(12) - 354.9) < 0.5);
});

// ----- reminders pacing -----
const at = (h, m = 0) => new Date(2026, 9, 15, h, m).getTime();

test('day window is 14 h but never crosses local midnight', () => {
  const w = dayWindow(at(9));
  assert.equal(w.end - w.start, DAY_LENGTH_MS);
  const late = dayWindow(at(22));
  assert.equal(late.end, new Date(2026, 9, 16).getTime());
});

test('first reminder is one gap after the day starts', () => {
  const start = at(8);
  const r = nextReminder({ now: start, dayStartMs: start, drinks: [], targetCups: 8 });
  assert.equal(r.kind, 'cup');
  assert.equal(r.at, start + (DAY_LENGTH_MS / 8)); // 105 min
});

test('gap adapts: falling behind shortens it, getting ahead stretches it', () => {
  const start = at(8);
  const evenly = nextReminder({ now: start, dayStartMs: start, drinks: [start + 105 * MIN], targetCups: 8 });
  const behind = nextReminder({ now: at(18), dayStartMs: start, drinks: [start + 105 * MIN], targetCups: 14 });
  const ahead = nextReminder({ now: start + 30 * MIN, dayStartMs: start, drinks: [start + 5 * MIN, start + 10 * MIN, start + 15 * MIN], targetCups: 8 });
  assert.ok(behind.gapMs < evenly.gapMs, 'more cups owed -> smaller gap');
  assert.ok(ahead.gapMs > 0 && ahead.gapMs <= MAX_GAP_MS);
});

test('gap is clamped to 15-120 minutes', () => {
  const start = at(8);
  assert.equal(nextReminder({ now: start, dayStartMs: start, drinks: [], targetCups: 200 }).gapMs, MIN_GAP_MS);
  assert.equal(nextReminder({ now: start, dayStartMs: start, drinks: [], targetCups: 2 }).gapMs, MAX_GAP_MS);
});

test('goal reached or window closed means no further reminder', () => {
  const start = at(8);
  const done = nextReminder({ now: at(12), dayStartMs: start, drinks: new Array(8).fill(start), targetCups: 8 });
  assert.deepEqual([done.at, done.kind], [null, 'goal']);
  const closed = nextReminder({ now: start + DAY_LENGTH_MS + MIN, dayStartMs: start, drinks: [], targetCups: 8 });
  assert.deepEqual([closed.at, closed.kind], [null, 'closed']);
});

test('a short window (late start) still produces sensible reminders and then closes', () => {
  const start = at(22, 30); // window = 90 min until midnight
  const r = nextReminder({ now: start, dayStartMs: start, drinks: [], targetCups: 8 });
  assert.equal(r.gapMs, MIN_GAP_MS);
  assert.equal(r.at, start + MIN_GAP_MS);
  const stillOpen = nextReminder({ now: at(23, 41), dayStartMs: start, drinks: [at(23, 40)], targetCups: 8 });
  assert.equal(stillOpen.kind, 'cup'); // 23:55 is inside the window
  const late = nextReminder({ now: at(23, 51), dayStartMs: start, drinks: [at(23, 50)], targetCups: 8 });
  assert.equal(late.kind, 'closed'); // next slot would be 00:05
});

test('typical gap label', () => {
  assert.equal(typicalGapMin(8), 105);
  assert.equal(typicalGapMin(100), 15);
  assert.equal(typicalGapMin(1), 120);
});

test('milestones fire once per crossing and report the highest', () => {
  assert.equal(milestoneCrossed(0, 1, 8), null);       // 12%
  assert.equal(milestoneCrossed(1, 2, 8), 25);         // 25%
  assert.equal(milestoneCrossed(2, 3, 8), null);       // 37%
  assert.equal(milestoneCrossed(3, 4, 8), 50);
  assert.equal(milestoneCrossed(7, 8, 8), 100);
  assert.equal(milestoneCrossed(0, 8, 8), 100);        // jump past several
  assert.equal(milestoneCrossed(4, 3, 8), null);       // undo never celebrates
  assert.equal(milestoneCrossed(8, 9, 8), null);       // bonus cups after the goal
});

test('dayKey is the local calendar date', () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59).getTime()), '2026-01-05');
  assert.equal(dayKey(new Date(2026, 11, 31, 0, 0).getTime()), '2026-12-31');
});
