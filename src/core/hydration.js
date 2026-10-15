/*
 * Hydration model: turns a personal profile (+ optional weather) into a daily fluid target,
 * expresses it in whole cups of the user's own cup size, and paces reminders across the day.
 *
 * PURE: no DOM, no Electron, no clock reads (callers pass `now`). Unit-tested in Node.
 *
 * Model
 *   1. Total body water (TBW) via the Watson formula (needs height, weight, age, sex).
 *   2. Baseline fluid = TBW x 0.072. The factor is calibrated so a reference 70 kg / 175 cm /
 *      30 y man lands near 3.0 L and a 60 kg / 165 cm / 30 y woman near 2.2 L, which are the
 *      US National Academies adequate intakes for total beverages.
 *   3. Add-ons: exercise sweat (intensity x minutes), warm/hot weather.
 *   4. Clamp to 1.2-4.5 L, round to 50 mL, convert to whole cups.
 *
 * General wellness guidance, not medical advice.
 */

export const ML_PER_FLOZ = 29.5735;
export const FLUID_FRACTION_OF_TBW = 0.072;

/** Estimated sweat to replace per hour of exercise, by intensity (mL/h). */
export const SWEAT_ML_PER_HOUR = Object.freeze({ none: 0, light: 300, moderate: 500, vigorous: 800 });
export const EXERCISE_CAP_ML = 1500;

/** Climate add-on when the user overrides the automatic weather lookup. */
export const CLIMATE_LEVEL_ML = Object.freeze({ temperate: 0, warm: 250, hot: 500 });

export const CUP_SIZES = Object.freeze({ small: 250, medium: 355, large: 500 });

export const MIN_TARGET_ML = 1200;
export const MAX_TARGET_ML = 4500;

/** The "day" starts at the first launch of the local day and lasts this long (or until midnight). */
export const DAY_LENGTH_MS = 14 * 60 * 60 * 1000;
export const MIN_GAP_MS = 15 * 60 * 1000;
export const MAX_GAP_MS = 120 * 60 * 1000;

export const LIMITS = Object.freeze({
  age: [12, 110],
  heightCm: [100, 230],
  weightKg: [30, 250],
  exerciseMin: [0, 300],
  cupMl: [60, 1000],
});

export const SEXES = Object.freeze(['male', 'female', 'other']);
export const MILESTONES = Object.freeze([25, 50, 75, 100]);

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const roundTo = (n, step) => Math.round(n / step) * step;

// ---------- unit helpers ----------
export const flozFromMl = (ml) => ml / ML_PER_FLOZ;
export const mlFromFloz = (oz) => oz * ML_PER_FLOZ;
export const kgFromLb = (lb) => lb * 0.45359237;
export const lbFromKg = (kg) => kg / 0.45359237;
export const cmFromInches = (inches) => inches * 2.54;
export const inchesFromCm = (cm) => cm / 2.54;

/** Total body water in litres (Watson). sex 'other' averages the male and female formulas. */
export function totalBodyWaterL({ sex, age, heightCm, weightKg }) {
  const male = 2.447 - 0.09156 * age + 0.1074 * heightCm + 0.3362 * weightKg;
  const female = -2.097 + 0.1069 * heightCm + 0.2466 * weightKg;
  if (sex === 'male') return male;
  if (sex === 'female') return female;
  return (male + female) / 2;
}

/**
 * Problems with a profile as machine-readable codes so the UI can localize them:
 * [{ field, code: 'missing' | 'range' | 'choice', min?, max? }]. Empty array = usable.
 */
export function validateProfile(p) {
  const problems = [];
  if (!p || typeof p !== 'object') return [{ field: 'profile', code: 'missing' }];
  if (!SEXES.includes(p.sex)) problems.push({ field: 'sex', code: 'choice' });
  if (!(p.exerciseIntensity in SWEAT_ML_PER_HOUR)) problems.push({ field: 'exerciseIntensity', code: 'choice' });
  for (const field of ['age', 'heightCm', 'weightKg', 'exerciseMin', 'cupMl']) {
    const v = p[field];
    const [min, max] = LIMITS[field];
    if (!Number.isFinite(v)) problems.push({ field, code: 'missing' });
    else if (v < min || v > max) problems.push({ field, code: 'range', min, max });
  }
  return problems;
}

/**
 * Climate add-on in mL. `weather` is one of:
 *   null / undefined                    -> 0 (unknown)
 *   { level: 'temperate'|'warm'|'hot' } -> manual override
 *   { tempC, humidityPct? }             -> automatic (Open-Meteo current conditions)
 */
export function climateAddOnMl(weather) {
  if (!weather) return 0;
  if (typeof weather.level === 'string') return CLIMATE_LEVEL_ML[weather.level] ?? 0;
  const { tempC, humidityPct } = weather;
  if (!Number.isFinite(tempC)) return 0;
  const humid = Number.isFinite(humidityPct) && humidityPct >= 70;
  if (tempC > 30 || (tempC >= 27 && humid)) return 500;
  if (tempC >= 24) return 250;
  return 0;
}

/** Daily fluid target with a breakdown of where every millilitre came from. */
export function calculateDailyTarget(profile, weather = null) {
  const tbwL = totalBodyWaterL(profile);
  const baseMl = tbwL * 1000 * FLUID_FRACTION_OF_TBW;
  const sweatPerHour = SWEAT_ML_PER_HOUR[profile.exerciseIntensity] ?? 0;
  const exerciseMl = Math.min(EXERCISE_CAP_ML, (profile.exerciseMin / 60) * sweatPerHour);
  const climateMl = climateAddOnMl(weather);

  const rawMl = baseMl + exerciseMl + climateMl;
  const totalMl = roundTo(clamp(rawMl, MIN_TARGET_ML, MAX_TARGET_ML), 50);
  const cups = Math.max(1, Math.round(totalMl / profile.cupMl));

  return {
    tbwL,
    baseMl: Math.round(baseMl),
    exerciseMl: Math.round(exerciseMl),
    climateMl,
    rawMl: Math.round(rawMl),
    totalMl,
    clamped: rawMl < MIN_TARGET_ML || rawMl > MAX_TARGET_ML,
    cupMl: profile.cupMl,
    cups,
    cupsMl: cups * profile.cupMl,
  };
}

/** Local calendar day key, e.g. "2026-10-15". */
export function dayKey(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Reminder window for a day that started at `dayStartMs`: 14 hours, but never past local midnight. */
export function dayWindow(dayStartMs) {
  const d = new Date(dayStartMs);
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return { start: dayStartMs, end: Math.min(dayStartMs + DAY_LENGTH_MS, midnight) };
}

/**
 * When is the next cup reminder due?
 *   now, dayStartMs  ms timestamps
 *   drinks           ms timestamps of cups logged today, ascending
 *   targetCups       the day's goal in cups
 * Returns { at: ms | null, gapMs, kind: 'cup' | 'goal' | 'closed' }.
 *
 * The gap is adaptive: time left in the window divided by cups still owed, measured from the
 * last drink (or the day start). Falling behind shortens it, getting ahead stretches it, always
 * within 15-120 minutes. If the next slot would fall outside the window, reminders are done.
 */
export function nextReminder({ now, dayStartMs, drinks, targetCups }) {
  const { start, end } = dayWindow(dayStartMs);
  if (drinks.length >= targetCups) return { at: null, gapMs: 0, kind: 'goal' };
  if (now >= end) return { at: null, gapMs: 0, kind: 'closed' };

  const anchor = drinks.length ? Math.max(drinks[drinks.length - 1], start) : start;
  const remaining = targetCups - drinks.length;
  const gapMs = clamp((end - anchor) / remaining, MIN_GAP_MS, MAX_GAP_MS);
  const at = anchor + gapMs;
  if (at >= end) return { at: null, gapMs, kind: 'closed' };
  return { at, gapMs, kind: 'cup' };
}

/** Typical minutes between cups if the whole window were still ahead (for the "pace" label). */
export function typicalGapMin(targetCups, windowMs = DAY_LENGTH_MS) {
  return Math.round(clamp(windowMs / Math.max(1, targetCups), MIN_GAP_MS, MAX_GAP_MS) / 60000);
}

/** Highest milestone (25/50/75/100 %) newly reached by going from `before` to `after` cups, else null. */
export function milestoneCrossed(before, after, targetCups) {
  if (targetCups <= 0 || after <= before) return null;
  const pct = (cups) => Math.floor((cups / targetCups) * 100);
  const b = pct(before);
  const a = pct(after);
  let hit = null;
  for (const m of MILESTONES) if (b < m && a >= m) hit = m;
  return hit;
}
