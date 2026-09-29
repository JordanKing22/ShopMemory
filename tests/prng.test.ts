import { describe, expect, it } from "vitest";
import { fnv1a32, intBetween, logUniformInt, mulberry32, normal, pick, pickWeighted, roundHalf, subRng } from "@/lib/seed/prng";

describe("prng", () => {
  it("mulberry32 matches the reference value", () => {
    expect(mulberry32(42)()).toBe(0.6011037519201636);
  });

  it("fnv1a32 matches reference hashes", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });

  it("sub-seeds are deterministic and independent per record and stream", () => {
    const a1 = subRng(7, "PRT-G01", "qty")();
    const a2 = subRng(7, "PRT-G01", "qty")();
    expect(a1).toBe(a2);
    expect(subRng(7, "PRT-G01", "date")()).not.toBe(a1);
    expect(subRng(7, "PRT-G02", "qty")()).not.toBe(a1);
    expect(subRng(8, "PRT-G01", "qty")()).not.toBe(a1);
  });

  it("normal() is roughly standard normal", () => {
    const rng = mulberry32(1);
    const xs = Array.from({ length: 20000 }, () => normal(rng));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(sd - 1)).toBeLessThan(0.03);
  });

  it("integer helpers stay in range", () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 2000; i++) {
      const n = intBetween(rng, 5, 9);
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThanOrEqual(9);
      const q = logUniformInt(rng, 5, 200);
      expect(q).toBeGreaterThanOrEqual(5);
      expect(q).toBeLessThanOrEqual(200);
    }
    expect(pick(rng, ["x"])).toBe("x");
    expect(pickWeighted(rng, [{ value: "a", weight: 0 }, { value: "b", weight: 1 }])).toBe("b");
  });

  it("roundHalf rounds to the nearest 0.5", () => {
    expect(roundHalf(41.26)).toBe(41.5);
    expect(roundHalf(41.2)).toBe(41);
    expect(roundHalf(0.74)).toBe(0.5);
  });
});
