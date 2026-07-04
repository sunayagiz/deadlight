/**
 * Deterministic seeded PRNG for the daily challenge. Pure + Phaser-free: given a
 * seed the whole run replays identically because stepSim threads this `rng`
 * everywhere it needs randomness. No `new Date()` here — the caller (render/entry
 * layer) formats today's date and passes it in as a string.
 */

/** xmur3 string hash → 32-bit unsigned int seed for mulberry32. Stable across runs. */
export function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/**
 * mulberry32: tiny, fast, well-distributed 32-bit PRNG. Returns a stateful
 * generator `() => number` in [0, 1). ONE instance per run — it advances on every
 * call, so sharing it across a whole sim run is what makes the run reproducible.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The canonical daily seed string, e.g. `DEADLIGHT-20260705`. Date is passed in. */
export function dailySeedString(dateYYYYMMDD: string): string {
  return `DEADLIGHT-${dateYYYYMMDD}`;
}
