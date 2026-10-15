/*
 * Seeded random numbers. PURE. The same seed always produces the same sequence, which is what makes
 * generated music reproducible ("New variation" just picks a new seed) and unit-testable.
 */

/** FNV-1a 32-bit string hash -> unsigned int. */
export function hashSeed(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, good enough for music. */
export function createRng(seed) {
  let a = (typeof seed === 'string' ? hashSeed(seed) : Number(seed)) >>> 0;
  const label = String(seed);

  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng = {
    next,
    /** float in [lo, hi) */
    range: (lo, hi) => lo + next() * (hi - lo),
    /** integer in [lo, hi] inclusive */
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    /** roughly bell-shaped value in [-1, 1] (sum of two uniforms) */
    jitter: () => next() + next() - 1,
    shuffle(list) {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    /** pick by weights: weighted([['a', 3], ['b', 1]]) */
    weighted(pairs) {
      const total = pairs.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [value, w] of pairs) {
        r -= w;
        if (r <= 0) return value;
      }
      return pairs[pairs.length - 1][0];
    },
    /** an independent stream derived from this seed and a label (e.g. one per voice) */
    fork: (name) => createRng(hashSeed(`${label}:${name}`)),
  };
  return rng;
}
