import { describe, expect, it } from "vitest";
import {
  CROCKFORD_ALPHABET,
  TOKEN_MAX_LENGTH,
  ambiguityEntityId,
  assignEntityCodes,
  escapeLiteralTokens,
  formatToken,
  hmacCode,
  isToken,
  parseToken,
  patternTokenFor,
  tokenKey,
  tokensIn,
} from "@/lib/redaction/patterns";

describe("token grammar (PLAN.md §4.5)", () => {
  it("formats, parses and recognizes tokens with and without variants", () => {
    expect(formatToken("CUSTOMER", "7QK2")).toBe("[[CUSTOMER_7QK2]]");
    expect(formatToken("PERSON", "AB12", "F")).toBe("[[PERSON_AB12_F]]");
    expect(parseToken("[[PERSON_AB12_L]]")).toEqual({ kind: "PERSON", code: "AB12", variant: "L" });
    expect(parseToken("[[AMOUNT_0000]]")).toEqual({ kind: "AMOUNT", code: "0000" });
    for (const bad of ["[[CUSTOMER_7QK]]", "[[NAME_7QK2]]", "[CUSTOMER_7QK2]", "[[CUSTOMER_7qk2]]", "[[PERSON_AB12_X]]"]) {
      expect(isToken(bad), bad).toBe(false);
    }
    expect(TOKEN_MAX_LENGTH).toBe("[[CUSTOMER_XXXX_F]]".length);
    expect(tokensIn("a [[PART_0001]] b [[JOB_0002]] [[PART_0001]]")).toEqual(["[[PART_0001]]", "[[JOB_0002]]", "[[PART_0001]]"]);
  });

  it("escapes literal brackets so a typed token can never match or be revealed", () => {
    const typed = "show [[CONTACT_7QK2]] and ]]] [[[";
    const escaped = escapeLiteralTokens(typed);
    expect(escaped).not.toMatch(/\[\[|\]\]/);
    expect(tokensIn(escaped)).toEqual([]);
    expect(escapeLiteralTokens(escaped)).toBe(escaped); // idempotent
  });

  it("codes are 4 Crockford characters, deterministic for a seed, and differ between seeds", () => {
    const k = tokenKey(20260915);
    const c = hmacCode(k, "CUSTOMER|CUS-01");
    expect(c).toMatch(new RegExp(`^[${CROCKFORD_ALPHABET}]{4}$`));
    expect(hmacCode(tokenKey(20260915), "CUSTOMER|CUS-01")).toBe(c);
    expect(hmacCode(tokenKey(1), "CUSTOMER|CUS-01")).not.toBe(c);
  });

  it("assigns unique codes per kind regardless of input order", () => {
    const k = tokenKey(7);
    const ents = Array.from({ length: 400 }, (_, i) => ({ kind: "PART" as const, entityId: `PRT-${i}` }));
    const a = assignEntityCodes(k, ents);
    const b = assignEntityCodes(k, [...ents].reverse());
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
    expect(new Set(a.values()).size).toBe(400);
    expect(ambiguityEntityId("Sam")).toBe("~ambiguous:sam");
  });

  it("pattern tokens are value-keyed and skip taken tokens", () => {
    const k = tokenKey(7);
    const t1 = patternTokenFor(k, "AMOUNT", "$1,800");
    expect(patternTokenFor(k, "AMOUNT", " $1,800 ")).toBe(t1);
    const t2 = patternTokenFor(k, "AMOUNT", "$1,800", (t) => t === t1);
    expect(t2).not.toBe(t1);
    expect(isToken(t2)).toBe(true);
    expect(patternTokenFor(k, "EMAIL", "A@Example.com")).toBe(patternTokenFor(k, "EMAIL", "a@example.com"));
  });
});
