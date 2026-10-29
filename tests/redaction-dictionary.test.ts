import { describe, expect, it } from "vitest";
import { buildRedactionDictionary, dictionaryHits, redactText, NO_PATTERN_TOKENS, contactDisplayName } from "@/lib/redaction";
import { isToken, parseToken } from "@/lib/redaction/patterns";
import type { RedactionDictionaryInput } from "@/lib/redaction/types";
import { seedDictionaryInput, seedRedactionDictionary, tokenOf } from "./helpers/dictionary";

const dict = seedRedactionDictionary();
const redact = (t: string) => redactText(t, dict, NO_PATTERN_TOKENS).value;

describe("redaction dictionary from the seed", () => {
  it("tokenizes customers, people (full / first / last), the owner persona, contacts and record numbers", () => {
    expect(parseToken(tokenOf(dict, "Aerovance"))?.kind).toBe("CUSTOMER");
    expect(parseToken(tokenOf(dict, "Ray Delgado"))).toMatchObject({ kind: "PERSON" });
    expect(parseToken(tokenOf(dict, "Ray"))).toMatchObject({ kind: "PERSON", variant: "F" });
    expect(parseToken(tokenOf(dict, "Delgado"))).toMatchObject({ kind: "PERSON", variant: "L" });
    expect(parseToken(tokenOf(dict, "Dana Whitcomb"))?.kind).toBe("PERSON");
    expect(parseToken(tokenOf(dict, "Morgan Ellery"))?.kind).toBe("CONTACT");
    expect(parseToken(tokenOf(dict, "AV-2231-07"))?.kind).toBe("PART");
    expect(parseToken(tokenOf(dict, "RJ-26-0310"))?.kind).toBe("JOB");
    // Variants share their entity's code, so Reveal and the audit can tell they are one person.
    const code = parseToken(tokenOf(dict, "Ray Delgado"))!.code;
    expect(parseToken(tokenOf(dict, "Ray"))!.code).toBe(code);
    expect(parseToken(tokenOf(dict, "Delgado"))!.code).toBe(code);
  });

  it("matches like the entity detector: longest first, case rules, compounds and possessives", () => {
    expect(redact("Ray Delgado")).toMatch(/^\[\[PERSON_[0-9A-Z]{4}\]\]$/);
    expect(redact("X-Ray inspection")).toBe("X-Ray inspection");
    expect(redact("ask ray")).toBe("ask ray"); // lower-case first names are suspects, not hits
    expect(redact("Aerovance's brackets")).toMatch(/^\[\[CUSTOMER_[0-9A-Z]{4}\]\]'s brackets$/);
    expect(redact("AEROVANCE")).toMatch(/^\[\[CUSTOMER_/);
    expect(redact("av 2231 07c")).toBe(tokenOf(dict, "AV-2231-07"));
  });

  it("never redacts materials, machines, specs, tolerances, hours or the shop's own name", () => {
    const text = "Ti-6Al-4V and Inconel 718 on the DMU 50, AS9102 first article, 0.040 in walls, 58 hours, Ridgeline Precision";
    expect(redact(text)).toBe(text);
  });

  it("every entity has a full-form token in entityTokens, and every surface's token is listed", () => {
    for (const st of dict.surfaceTokens) {
      expect(isToken(st.token)).toBe(true);
      expect(dict.entityTokens.get(st.token)).toBeDefined();
    }
    const kinds = new Set([...dict.entityTokens.values()].map((i) => i.kind));
    expect([...kinds].sort()).toEqual(["CONTACT", "CUSTOMER", "JOB", "PART", "PERSON", "QUOTE"]);
  });

  it("is deterministic: rebuilding from the same input gives the same tokens and version", () => {
    const again = buildRedactionDictionary(seedDictionaryInput());
    expect(again.version).toBe(dict.version);
    expect([...again.entityTokens.keys()]).toEqual([...dict.entityTokens.keys()]);
  });

  it("dictionaryHits reports kinds and positions only", () => {
    const hits = dictionaryHits("Maya asked Aerovance about RJ-26-0310", dict);
    expect(hits.map((h) => h.kind)).toEqual(["PERSON", "CUSTOMER", "JOB"]);
    expect(hits[0]).toEqual({ kind: "PERSON", start: 0, end: 4 });
    expect(dictionaryHits("thin-wall titanium, X-Ray", dict)).toEqual([]);
  });
});

describe("ambiguity tokens and contacts (synthetic input)", () => {
  const input: RedactionDictionaryInput = {
    entities: {
      customers: [{ id: "CUS-01", name: "Testco", aliases: [], classification: "customer_confidential", partClassificationFloor: "customer_confidential" }],
      people: [
        { id: "PER-01", fullName: "Sam Alder", aliases: ["Sam", "Alder"] },
        { id: "PER-02", fullName: "Sam Birch", aliases: ["Sam", "Birch"] },
      ],
      parts: [],
      jobs: [],
      quotes: [],
      stoplistNumbers: [],
    },
    contacts: [{ customerId: "CUS-01", name: "Jo Quill (fictional)", email: "jo@testco.example.com" }],
    tokenSeed: 1,
  };
  const d = buildRedactionDictionary(input);

  it("a first name shared by two people gets one ambiguity token restoring to the first name only", () => {
    const r = redactText("Sam said hi", d, NO_PATTERN_TOKENS);
    const tok = r.tokensUsed[0];
    expect(parseToken(tok)).toMatchObject({ kind: "PERSON", variant: "F" });
    expect(d.entityTokens.get(tok)).toMatchObject({ ambiguous: true, entityId: null, display: "Sam" });
    expect(tok).not.toBe(tokenOf(d, "Sam Alder").replace("]]", "_F]]"));
  });

  it("contacts: the trailing (fictional) is dropped; full, first and last names are CONTACT tokens", () => {
    expect(contactDisplayName("Jo Quill (fictional)")).toBe("Jo Quill");
    const r = redactText("Jo Quill, Jo and Quill", d, NO_PATTERN_TOKENS);
    expect(r.tokensUsed.map((t) => parseToken(t)?.kind)).toEqual(["CONTACT", "CONTACT", "CONTACT"]);
    expect(r.value).not.toMatch(/Jo|Quill/);
  });
});
