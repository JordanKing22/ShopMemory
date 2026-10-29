import { describe, expect, it } from "vitest";
import { StreamRestorer, UNKNOWN_TOKEN_TEXT, detokenizeEntities, redactText, restoreText, NO_PATTERN_TOKENS } from "@/lib/redaction";
import type { StreamRestorerOptions } from "@/lib/redaction/types";
import { mulberry32 } from "@/lib/seed/prng";
import { seedRedactionDictionary } from "./helpers/dictionary";

const dict = seedRedactionDictionary();
const original = "Per Ray Delgado [S1], Aerovance wants AV-2231-07 checked [S2][S9]. Ray's call. [[ not a token ]] [S";
const r = redactText(original.replace("[[ not a token ]]", "brackets"), dict, NO_PATTERN_TOKENS);
const tokenized = r.value;
const opts: StreamRestorerOptions = { tokens: r.tokens, sentSourceKeys: new Set(["S1", "S2"]) };
const expected = restoreText(tokenized, opts);

function streamed(chunks: string[]): { text: string; stats: ReturnType<StreamRestorer["stats"]> } {
  const s = new StreamRestorer(opts);
  let out = "";
  for (const c of chunks) out += s.push(c);
  out += s.flush();
  return { text: out, stats: s.stats() };
}

describe("StreamRestorer", () => {
  it("restores this request's tokens and keeps only citations to sent sources", () => {
    expect(expected.text).toBe("Per Ray Delgado [S1], Aerovance wants AV-2231-07 checked [S2]. Ray's call. brackets [S");
    expect(expected.stats).toEqual({ restoredTokens: 4, unknownTokens: 0, citationsValid: 2, citationsStripped: 1 });
  });

  it("gives the same result for every two-way split of the stream", () => {
    for (let i = 0; i <= tokenized.length; i++) {
      const got = streamed([tokenized.slice(0, i), tokenized.slice(i)]);
      expect(got.text, `split at ${i}`).toBe(expected.text);
      expect(got.stats).toEqual(expected.stats);
    }
  });

  it("gives the same result for random chunkings (fuzz)", () => {
    const rand = mulberry32(1234);
    for (let round = 0; round < 300; round++) {
      const chunks: string[] = [];
      let i = 0;
      while (i < tokenized.length) {
        const n = 1 + Math.floor(rand() * 7);
        chunks.push(tokenized.slice(i, i + n));
        i += n;
      }
      expect(streamed(chunks).text).toBe(expected.text);
    }
  });

  it("restores unknown tokens (another request's, or typed by the model) to [unknown]", () => {
    const out = restoreText("hi [[PERSON_ZZZZ]] and [[AMOUNT_0000]]", { tokens: new Map(), sentSourceKeys: null });
    expect(out.text).toBe(`hi ${UNKNOWN_TOKEN_TEXT} and ${UNKNOWN_TOKEN_TEXT}`);
    expect(out.stats.unknownTokens).toBe(2);
  });

  it("emits a held-back partial marker as written when the stream ends", () => {
    const s = new StreamRestorer({ tokens: new Map(), sentSourceKeys: null });
    expect(s.push("cost [[AMOU")).toBe("cost ");
    expect(s.flush()).toBe("[[AMOU");
  });

  it("detokenizeEntities maps entity tokens to display text (local replay emulation)", () => {
    expect(detokenizeEntities(tokenized, dict)).toContain("Aerovance");
    expect(detokenizeEntities("x [[AMOUNT_0000]]", dict)).toBe(`x ${UNKNOWN_TOKEN_TEXT}`);
  });
});
