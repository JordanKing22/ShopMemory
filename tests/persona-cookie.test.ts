import { timingSafeEqual } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERSONA_COOKIE, isValidPersonaId, signPersona, verifyPersona } from "@/lib/auth/persona-cookie";

// Wrap timingSafeEqual in a spy (the module under test imports it by name, so spyOn on the object would miss it).
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, default: actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const SECRET = Buffer.alloc(32, 7);
const OTHER = Buffer.alloc(32, 9);

afterEach(() => {
  vi.mocked(timingSafeEqual).mockClear();
});

describe("persona cookie", () => {
  it("uses the fw_persona name", () => {
    expect(PERSONA_COOKIE).toBe("fw_persona");
  });

  it("round-trips a persona ID", () => {
    for (const id of ["P-OWNER", "P-PER-01", "P-PER-06"]) {
      const v = signPersona(id, SECRET);
      expect(v).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
      expect(v.startsWith(`${id}.`)).toBe(true);
      expect(verifyPersona(v, SECRET)).toBe(id);
    }
  });

  it("accepts string secrets too", () => {
    const v = signPersona("P-OWNER", "a string secret");
    expect(verifyPersona(v, "a string secret")).toBe("P-OWNER");
    expect(verifyPersona(v, "another string secret")).toBeNull();
  });

  it("is deterministic for the same secret and differs across secrets and IDs", () => {
    expect(signPersona("P-OWNER", SECRET)).toBe(signPersona("P-OWNER", SECRET));
    expect(signPersona("P-OWNER", SECRET)).not.toBe(signPersona("P-OWNER", OTHER));
    expect(signPersona("P-OWNER", SECRET).split(".")[1]).not.toBe(signPersona("P-PER-02", SECRET).split(".")[1]);
  });

  it("never contains the role", () => {
    const v = signPersona("P-PER-02", SECRET);
    expect(v.toLowerCase()).not.toMatch(/owner|quoter|machinist|trainee/);
  });

  it("rejects a value signed with another secret", () => {
    expect(verifyPersona(signPersona("P-OWNER", OTHER), SECRET)).toBeNull();
  });

  it("rejects tampered values", () => {
    const v = signPersona("P-PER-02", SECRET);
    const [, sig] = v.split(".");
    // Swap the ID but keep the signature (the classic privilege-escalation attempt).
    expect(verifyPersona(`P-OWNER.${sig}`, SECRET)).toBeNull();
    // Flip one signature character.
    const flipped = sig[0] === "A" ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
    expect(verifyPersona(`P-PER-02.${flipped}`, SECRET)).toBeNull();
    // Truncate / extend the signature.
    expect(verifyPersona(`P-PER-02.${sig.slice(0, -1)}`, SECRET)).toBeNull();
    expect(verifyPersona(`P-PER-02.${sig}A`, SECRET)).toBeNull();
    // Case change on the ID.
    expect(verifyPersona(`p-per-02.${sig}`, SECRET)).toBeNull();
  });

  it("rejects non-canonical base64url encodings of a valid signature", () => {
    const v = signPersona("P-OWNER", SECRET);
    const [id, sig] = v.split(".");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = alphabet.indexOf(sig[42]);
    // The last char of a 32-byte value encodes 4 data bits + 2 padding bits; setting padding bits keeps the bytes.
    const variant = alphabet[(last & ~0b11) | ((last & 0b11) ^ 0b01)];
    expect(Buffer.from(sig.slice(0, 42) + variant, "base64url").equals(Buffer.from(sig, "base64url"))).toBe(true);
    expect(verifyPersona(`${id}.${sig.slice(0, 42)}${variant}`, SECRET)).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["no dot", "P-OWNER"],
    ["only a dot", "."],
    ["empty id", `.${"A".repeat(43)}`],
    ["empty signature", "P-OWNER."],
    ["extra dots", `P-OWNER.${"A".repeat(43)}.x`],
    ["dot inside id", `P.OWNER.${"A".repeat(43)}`],
    ["non-base64url signature", `P-OWNER.${"+".repeat(43)}`],
    ["padded signature", `P-OWNER.${"A".repeat(42)}=`],
    ["standard base64 chars", `P-OWNER.${"A".repeat(41)}/+`],
    ["whitespace", ` P-OWNER.${"A".repeat(43)}`],
    ["id with invalid chars", `P OWNER.${"A".repeat(43)}`],
    ["overlong id", `${"P".repeat(65)}.${"A".repeat(43)}`],
    ["huge value", "A".repeat(10_000)],
  ])("rejects malformed input: %s", (_label, value) => {
    expect(verifyPersona(value, SECRET)).toBeNull();
  });

  it("rejects non-string inputs and empty secrets without throwing", () => {
    for (const v of [undefined, null, 42, {}, [], true]) expect(verifyPersona(v, SECRET)).toBeNull();
    const v = signPersona("P-OWNER", SECRET);
    expect(verifyPersona(v, "")).toBeNull();
    expect(verifyPersona(v, new Uint8Array(0))).toBeNull();
  });

  it("refuses to sign invalid IDs or with an empty secret, without echoing the input", () => {
    expect(() => signPersona("P.OWNER", SECRET)).toThrow(/invalid persona id/);
    expect(() => signPersona("", SECRET)).toThrow(/invalid persona id/);
    expect(() => signPersona("P-OWNER", "")).toThrow(/empty secret/);
    try {
      signPersona("SECRET-CANARY.x", SECRET);
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("SECRET-CANARY");
    }
  });

  it("validates persona IDs", () => {
    expect(isValidPersonaId("P-PER-01")).toBe(true);
    expect(isValidPersonaId("P-OWNER")).toBe(true);
    expect(isValidPersonaId("P.OWNER")).toBe(false);
    expect(isValidPersonaId("")).toBe(false);
    expect(isValidPersonaId(1)).toBe(false);
  });

  it("compares signatures with crypto.timingSafeEqual on equal-length buffers", () => {
    const spy = vi.mocked(timingSafeEqual);
    spy.mockClear();
    const v = signPersona("P-OWNER", SECRET);
    expect(verifyPersona(v, SECRET)).toBe("P-OWNER");
    expect(verifyPersona(signPersona("P-OWNER", OTHER), SECRET)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
    for (const [a, b] of spy.mock.calls) {
      expect((a as Buffer).length).toBe(32);
      expect((b as Buffer).length).toBe(32);
    }
    // Malformed input is rejected before any comparison.
    spy.mockClear();
    expect(verifyPersona("P-OWNER.short", SECRET)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
