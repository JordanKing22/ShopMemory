/** Scenario matching for Ask/doc tasks (PLAN.md §11.1): Jaccard ≥ 0.6 on the TOKENIZED, normalized question. Pure. */
import { tokenRegex } from "@/lib/redaction/patterns";

export const SCENARIO_JACCARD_MIN = 0.6;

/** Words (lower-cased letters/digits) plus whole redaction tokens, as a set. */
export function questionTokens(tokenized: string): Set<string> {
  const out = new Set<string>();
  const rest = tokenized.normalize("NFC").replace(tokenRegex(), (t) => {
    out.add(t);
    return " ";
  });
  for (const m of rest.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) out.add(m[0]);
  return out;
}

export function jaccard(a: string, b: string): number {
  const A = questionTokens(a);
  const B = questionTokens(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
