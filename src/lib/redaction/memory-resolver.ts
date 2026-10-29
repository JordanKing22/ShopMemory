/**
 * In-memory PatternTokenResolver for tests, seed time and previews (previews never persist minted tokens). The DB
 * implementation is src/lib/audit/token-store.ts.
 */
import { normalizePatternValue } from "./patterns";
import type { PatternTokenKind, PatternTokenRecord, PatternTokenResolver } from "./types";

export interface MemoryPatternResolver extends PatternTokenResolver {
  /** Remember tokens (e.g. what a redaction call minted). */
  add(records: readonly PatternTokenRecord[]): void;
  /** token → value, for tests and local Reveal emulation. Sensitive. */
  valueOf(token: string): string | undefined;
}

export function createMemoryPatternResolver(initial: readonly PatternTokenRecord[] = []): MemoryPatternResolver {
  const byValue = new Map<string, string>();
  const byToken = new Map<string, { kind: PatternTokenKind; norm: string; value: string }>();
  const add = (records: readonly PatternTokenRecord[]) => {
    for (const r of records) {
      const norm = normalizePatternValue(r.kind, r.value);
      if (!byToken.has(r.token)) byToken.set(r.token, { kind: r.kind, norm, value: r.value });
      if (!byValue.has(`${r.kind}|${norm}`)) byValue.set(`${r.kind}|${norm}`, r.token);
    }
  };
  add(initial);
  return {
    tokenFor: (kind, value) => byValue.get(`${kind}|${normalizePatternValue(kind, value)}`),
    isTaken: (token) => byToken.has(token),
    add,
    valueOf: (token) => byToken.get(token)?.value,
  };
}

/** Nothing persisted, nothing taken. */
export const NO_PATTERN_TOKENS: PatternTokenResolver = {
  tokenFor: () => undefined,
  isTaken: () => false,
};
