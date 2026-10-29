/**
 * Restoration (PLAN.md §4.2 R3, §4.5): swaps tokens back using ONLY this request's token map, and validates [S#]
 * citations in the same pass. Safe across chunk boundaries: a trailing partial token ("[[PERS") or citation ("[S1")
 * is held back until it is complete or can no longer become one.
 *
 * - A token in `opts.tokens` → its surface (the exact text replaced in this request).
 * - Any other grammar token (typed by the model, or from another request) → "[unknown]".
 * - "[S#]" kept when its key is in `sentSourceKeys`, otherwise stripped and counted. null = no citation check.
 *
 * Pure; never logs.
 */
import { CITATION_MAX_LENGTH, TOKEN_KINDS, TOKEN_MAX_LENGTH, citationRegex, tokenRegex } from "./patterns";
import type { CompiledRedactionDictionary } from "./dictionary";
import type { RedactionDictionary, RestoreStats, StreamRestorerOptions } from "./types";

export const UNKNOWN_TOKEN_TEXT = "[unknown]";

const HOLD_MAX = Math.max(TOKEN_MAX_LENGTH, CITATION_MAX_LENGTH);
const CODE_CHAR = /^[0-9A-Z]$/;

/** Could `s` (starting with "[") still grow into a token or a citation? */
function isPartialMarker(s: string): boolean {
  if (s.length === 0 || s[0] !== "[") return false;
  return isPartialCitation(s) || isPartialToken(s);
}

function isPartialCitation(s: string): boolean {
  // "[" "S" digits{1,3} (no closing bracket yet)
  if (s.length === 1) return true;
  if (s[1] !== "S") return false;
  const digits = s.slice(2);
  return /^[1-9]?$|^[1-9][0-9]{0,2}$/.test(digits);
}

function isPartialToken(s: string): boolean {
  if (s.length === 1) return true;
  if (s[1] !== "[") return false;
  const rest = s.slice(2);
  const us = rest.indexOf("_");
  const kind = us === -1 ? rest : rest.slice(0, us);
  if (us === -1) return TOKEN_KINDS.some((k) => k.startsWith(kind));
  if (!(TOKEN_KINDS as readonly string[]).includes(kind)) return false;
  const tail = rest.slice(us + 1); // "XXXX", "XXXX_F", "XXXX]" (one closing bracket so far)
  let i = 0;
  while (i < tail.length && i < 4 && CODE_CHAR.test(tail[i])) i++;
  if (i < tail.length && i < 4) return false;
  if (i === tail.length) return true;
  let j = i;
  if (tail[j] === "_") {
    j++;
    if (j === tail.length) return true;
    if (tail[j] !== "F" && tail[j] !== "L") return false;
    j++;
  }
  if (j === tail.length) return true;
  return tail.slice(j) === "]";
}

export class StreamRestorer {
  private buffer = "";
  private readonly counts: RestoreStats = { restoredTokens: 0, unknownTokens: 0, citationsValid: 0, citationsStripped: 0 };

  constructor(private readonly opts: StreamRestorerOptions) {}

  /** Restored text safe to emit now (may be ""). */
  push(chunk: string): string {
    this.buffer += chunk;
    const hold = this.holdIndex();
    const ready = this.buffer.slice(0, hold);
    this.buffer = this.buffer.slice(hold);
    return this.restore(ready);
  }

  /** Everything still held back (a partial marker that never completed is emitted as written). */
  flush(): string {
    const rest = this.buffer;
    this.buffer = "";
    return this.restore(rest);
  }

  stats(): RestoreStats {
    return { ...this.counts };
  }

  private holdIndex(): number {
    const b = this.buffer;
    const from = Math.max(0, b.length - HOLD_MAX + 1);
    for (let i = from; i < b.length; i++) {
      if (b[i] === "[" && isPartialMarker(b.slice(i))) return i;
    }
    return b.length;
  }

  private restore(text: string): string {
    if (!text) return text;
    const withTokens = text.replace(tokenRegex(), (token) => {
      const entry = this.opts.tokens.get(token);
      if (entry) {
        this.counts.restoredTokens++;
        return entry.surface;
      }
      this.counts.unknownTokens++;
      return UNKNOWN_TOKEN_TEXT;
    });
    const keys = this.opts.sentSourceKeys;
    if (keys === null) return withTokens;
    return withTokens.replace(citationRegex(), (cite, n: string) => {
      if (keys.has(`S${n}`)) {
        this.counts.citationsValid++;
        return cite;
      }
      this.counts.citationsStripped++;
      return "";
    });
  }
}

export function restoreText(text: string, opts: StreamRestorerOptions): { text: string; stats: RestoreStats } {
  const r = new StreamRestorer(opts);
  const out = r.push(text) + r.flush();
  return { text: out, stats: r.stats() };
}

/** Restores every string leaf (and object key) of a parsed JSON value. */
export function restoreJsonStrings<T>(value: T, opts: StreamRestorerOptions): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return restoreText(v, opts).text;
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[restoreText(k, opts).text] = walk(x);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

/**
 * Entity tokens → their dictionary display text; every other token → "[unknown]". Used to emulate what a live local
 * model returns when replaying a (tokenized) local cassette.
 */
export function detokenizeEntities(text: string, dict: RedactionDictionary): string {
  const d = dict as CompiledRedactionDictionary;
  return text.replace(tokenRegex(), (token) => d.entityTokens.get(token)?.display ?? UNKNOWN_TOKEN_TEXT);
}
