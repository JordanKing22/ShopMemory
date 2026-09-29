/**
 * Deterministic randomness for the seed generator (PLAN.md §7.5). Every draw comes from a per-record sub-seed
 * `fnv1a32("${SEED}|${recordKey}|${stream}")`, so editing one record never reshuffles the others.
 * Never use Math.random() in seed code.
 */

export type Rng = () => number;

/** The standard mulberry32 generator: returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const encoder = new TextEncoder();

/** 32-bit FNV-1a over the UTF-8 bytes of `s`. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (const byte of encoder.encode(s)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A generator private to one record and one purpose ("stream"). */
export function subRng(seed: number, recordKey: string, stream: string): Rng {
  return mulberry32(fnv1a32(`${seed}|${recordKey}|${stream}`));
}

/** Standard normal via Box–Muller (uses exactly two draws). */
export function normal(rng: Rng): number {
  const u1 = 1 - rng(); // (0, 1]
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error("pick() from an empty list");
  return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
}

/** Weighted pick; weights must be ≥ 0 with a positive sum. */
export function pickWeighted<T>(rng: Rng, items: readonly { value: T; weight: number }[]): T {
  const total = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
  if (!(total > 0)) throw new Error("pickWeighted() needs a positive total weight");
  let r = rng() * total;
  for (const i of items) {
    r -= Math.max(0, i.weight);
    if (r < 0) return i.value;
  }
  return items[items.length - 1].value;
}

/** Integer in [min, max], inclusive. */
export function intBetween(rng: Rng, min: number, max: number): number {
  return min + Math.min(max - min, Math.floor(rng() * (max - min + 1)));
}

/** Integer in [min, max] whose logarithm is uniform (many small quantities, a few large ones). */
export function logUniformInt(rng: Rng, min: number, max: number): number {
  const lo = Math.log(min);
  const hi = Math.log(max + 1);
  return Math.min(max, Math.max(min, Math.floor(Math.exp(lo + rng() * (hi - lo)))));
}

/** Round to the nearest 0.5. */
export function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
