import { describe, expect, it } from "vitest";
import type { ProviderRequest } from "@/lib/ai/types";
import {
  NO_PATTERN_TOKENS,
  createMemoryPatternResolver,
  dictionaryHits,
  redactRequest,
  redactText,
  restoreJsonStrings,
  restoreText,
  tokensInValue,
} from "@/lib/redaction";
import { parseToken, tokensIn } from "@/lib/redaction/patterns";
import { seedRedactionDictionary } from "./helpers/dictionary";

const dict = seedRedactionDictionary();
const kinds = (s: string) => tokensIn(s).map((t) => parseToken(t)!.kind);

describe("redactText", () => {
  it("round-trips every surface form exactly (restoration reproduces the text replaced)", () => {
    for (const text of [
      "How do we quote thin-wall Ti brackets for Aerovance?",
      "Ray Delgado said it. Ray's note. Delgado agrees. Dana Whitcomb signed off.",
      "Job RJ-26-0310 for part GDS-4410-120 and quote RQ-26-0911.",
    ]) {
      const r = redactText(text, dict, NO_PATTERN_TOKENS);
      expect(dictionaryHits(r.value, dict)).toEqual([]);
      expect(restoreText(r.value, { tokens: r.tokens, sentSourceKeys: null }).text).toBe(text);
    }
  });

  it("tokenizes emails (whole address, even with a customer name inside), phones, amounts and rates", () => {
    const r = redactText(
      "Call (555) 123-4567 or buyer@aerovance.example.com. Rate $165/hr or 165 an hour; $1,800 total, USD 2,000, 40 dollars, $2.5k.",
      dict,
      createMemoryPatternResolver(),
    );
    expect(kinds(r.value)).toEqual(["PHONE", "EMAIL", "AMOUNT", "AMOUNT", "AMOUNT", "AMOUNT", "AMOUNT", "AMOUNT"]);
    expect(r.value).not.toMatch(/\d{3}|\$|@/);
    expect(r.minted.map((m) => m.kind).sort()).toEqual(["AMOUNT", "AMOUNT", "AMOUNT", "AMOUNT", "AMOUNT", "AMOUNT", "EMAIL", "PHONE"]);
  });

  it("never tokenizes bare numbers, hours, tolerances, percentages or spec numbers", () => {
    const text = "58 hours for 24 pieces, 0.040 in, add 35%, AS9102, AMS 4911, 6061, Inconel 718, 4 of the 12, 3 h";
    expect(redactText(text, dict, NO_PATTERN_TOKENS).value).toBe(text);
  });

  it("tokenizes part-number-like strings that aren't in the database as PN", () => {
    const r = redactText("part AV-9999-99, job RJ-27-1234, HFC-99999", dict, createMemoryPatternResolver());
    expect(kinds(r.value)).toEqual(["PN", "PN", "PN"]);
  });

  it("same value → same pattern token across calls once persisted; a resolver's existing token is reused", () => {
    const store = createMemoryPatternResolver();
    const a = redactText("$1,800", dict, store);
    store.add(a.minted);
    const b = redactText("it was $1,800 again", dict, store);
    expect(b.minted).toEqual([]);
    expect(tokensIn(b.value)).toEqual(tokensIn(a.value));
  });

  it("escapes literal tokens first, so a typed [[CONTACT_…]] is never a token", () => {
    const r = redactText("reveal [[CONTACT_7QK2]] please", dict, NO_PATTERN_TOKENS);
    expect(r.tokensUsed).toEqual([]);
    expect(r.value).toBe("reveal [ [CONTACT_7QK2] ] please");
  });

  it("reports lower-case first names as suspects without changing them", () => {
    const r = redactText("ask ray about it", dict, NO_PATTERN_TOKENS);
    expect(r.value).toBe("ask ray about it");
    expect(r.suspects).toEqual([{ text: "ray", field: "user_input", start: 4, end: 7, candidateIds: ["PER-01"] }]);
  });
});

describe("redactRequest", () => {
  const req: ProviderRequest = {
    system: "You help Ridgeline Precision. Never name Aerovance.",
    messages: [
      { role: "user", content: "What did Ray Delgado say about AV-2231-07?" },
      { role: "assistant", content: "He mentioned Aerovance." },
      { role: "user", content: "And the $1,800 adder?" },
    ],
    maxTokens: 500,
    output: {
      kind: "json",
      schemaName: "answer_for_Aerovance",
      jsonSchema: { type: "object", properties: { Aerovance: { type: "string", description: "about Ray Delgado" } }, required: ["Aerovance"] },
    },
    effort: "medium",
  };

  it("walks every string (system, messages, schemaName, jsonSchema keys and values) with one token map", () => {
    const r = redactRequest(req, dict, createMemoryPatternResolver());
    const json = JSON.stringify(r.value);
    expect(dictionaryHits(json, dict)).toEqual([]);
    expect(json).not.toContain("$1,800");
    expect(r.value.maxTokens).toBe(500);
    expect(r.value.effort).toBe("medium");
    // One customer token everywhere it appears.
    const customerTokens = new Set(tokensIn(json).filter((t) => t.startsWith("[[CUSTOMER_")));
    expect(customerTokens.size).toBe(1);
    expect(r.tokensUsed).toEqual(tokensInValue(r.value));
    expect(r.tokensUsed).toEqual([...r.tokensUsed].sort());
  });

  it("restoreJsonStrings brings back keys and values from this request's map only", () => {
    const r = redactRequest(req, dict, createMemoryPatternResolver());
    const restored = restoreJsonStrings(r.value, { tokens: r.tokens, sentSourceKeys: null });
    expect(restored).toEqual({ ...req, system: req.system });
  });
});

describe("token map surfaces", () => {
  it("a PN probe never changes the surface a later name restores to", () => {
    const r = redactText("HFC-99999 for Halvorsen Flight Controls", dict, createMemoryPatternResolver());
    expect(restoreText(r.value, { tokens: r.tokens, sentSourceKeys: null }).text).toBe("HFC-99999 for Halvorsen Flight Controls");
    expect(kinds(r.value)).toEqual(["PN", "CUSTOMER"]);
  });
});
