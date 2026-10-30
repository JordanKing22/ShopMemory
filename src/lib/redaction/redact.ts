/**
 * Redaction (PLAN.md §4.5, §4.2 P7; docs/AI-GATEWAY.md §6). Mandatory on every cloud call, GovCloud included, and not
 * configurable (CLAUDE.md hard rule 6).
 *
 * Order per string: NFC → escape literal "[[" / "]]" → EMAIL → PN shapes → dictionary surfaces (customers, people,
 * contacts, part / job / quote numbers) → PHONE, AMOUNT on the text between hits. Nothing ever runs inside a produced
 * token. EMAIL and PN go first so an address or part number that CONTAINS a name or alias ("buyer@aerovance.…",
 * "HFC-99999") becomes one token instead of a customer token with the rest left in the clear; a PN-shaped string that
 * is exactly a database part / job / quote number still gets that record's own token. redactRequest() walks EVERY string of a ProviderRequest (system, every message, output.schemaName and
 * every key and value of output.jsonSchema) with one token map, so a name gets the same token everywhere in a request.
 *
 * Not redacted, on purpose: materials, machine makes/models, process terms, tolerances, hours, spec numbers and the
 * shop's own name (the know-how the model needs). Lower-case first names ("ask ray") are reported as suspects for the
 * preview, never silently changed.
 *
 * Pure: no DB, no env, no clock, no logging. Minted pattern tokens are RETURNED; the caller persists them (R1 only).
 */
import type { ProviderRequest, JsonObject, JsonValue } from "@/lib/ai/types";
import type { CompiledRedactionDictionary } from "./dictionary";
import { amountRegex, emailRegex, phoneRegex } from "./pattern-regex";
import { escapeLiteralTokens, normalizePatternValue, patternTokenFor, tokenRegex, tokensIn } from "./patterns";
import type {
  PatternTokenKind,
  PatternTokenRecord,
  PatternTokenResolver,
  RedactionDictionary,
  RedactionResult,
  Suspect,
  TokenMap,
  TokenMapEntry,
} from "./types";

type Piece = { text: string; token: boolean };

const PATTERNS_AFTER_DICTIONARY: readonly PatternTokenKind[] = ["PHONE", "AMOUNT"];

/** One redaction pass over one request: a shared token map and the pattern tokens minted so far. */
class RedactionSession {
  readonly tokens = new Map<string, TokenMapEntry>();
  readonly minted: PatternTokenRecord[] = [];
  readonly suspects: Suspect[] = [];
  private readonly mintedByValue = new Map<string, string>();
  private readonly mintedValueOf = new Map<string, string>();

  constructor(
    private readonly dict: CompiledRedactionDictionary,
    private readonly patterns: PatternTokenResolver,
  ) {}

  redact(input: string, field: string): string {
    const s = escapeLiteralTokens(input.normalize("NFC"));
    let pieces = this.patternPass([{ text: s, token: false }], "EMAIL");
    pieces = this.patternPass(pieces, "PN");
    pieces = pieces.flatMap((p) => (p.token ? [p] : this.dictionaryPass(p.text)));
    for (const kind of PATTERNS_AFTER_DICTIONARY) pieces = this.patternPass(pieces, kind);
    const out = pieces.map((p) => p.text).join("");
    this.findSuspects(pieces, field);
    return out;
  }

  private dictionaryPass(s: string): Piece[] {
    const pieces: Piece[] = [];
    let last = 0;
    for (const m of s.matchAll(this.dict.entityDict.matcher)) {
      let group = 1;
      while (group < m.length && m[group] === undefined) group++;
      const idx = this.dict.entityDict.groupToSurface[group] ?? -1;
      if (idx < 0) continue; // a stoplisted compound ("X-Ray"): left as written
      const start = m.index ?? 0;
      if (start > last) pieces.push({ text: s.slice(last, start), token: false });
      const st = this.dict.surfaceTokens[idx];
      if (!this.tokens.has(st.token)) {
        const entry: TokenMapEntry = { token: st.token, kind: st.kind, entityId: st.entityId, surface: m[0], source: "dictionary" };
        if (st.variant) entry.variant = st.variant;
        if (st.ambiguous) entry.ambiguous = true;
        this.tokens.set(st.token, entry);
      }
      pieces.push({ text: st.token, token: true });
      last = start + m[0].length;
    }
    if (last < s.length) pieces.push({ text: s.slice(last), token: false });
    return pieces;
  }

  private regexFor(kind: PatternTokenKind): RegExp | null {
    if (kind === "EMAIL") return emailRegex();
    if (kind === "PHONE") return phoneRegex();
    if (kind === "AMOUNT") return amountRegex();
    return this.dict.pnRegex ? new RegExp(this.dict.pnRegex.source, this.dict.pnRegex.flags) : null;
  }

  private patternPass(pieces: Piece[], kind: PatternTokenKind): Piece[] {
    const re = this.regexFor(kind);
    if (!re) return pieces;
    const out: Piece[] = [];
    for (const p of pieces) {
      if (p.token) {
        out.push(p);
        continue;
      }
      let last = 0;
      for (const m of p.text.matchAll(re)) {
        const start = m.index ?? 0;
        if (m[0].trim() === "") continue;
        if (start > last) out.push({ text: p.text.slice(last, start), token: false });
        out.push({ text: (kind === "PN" && this.wholeRecordToken(m[0])) || this.patternToken(kind, m[0]), token: true });
        last = start + m[0].length;
      }
      if (last < p.text.length) out.push({ text: p.text.slice(last), token: false });
    }
    return out;
  }

  /** The dictionary token when `text` is exactly one record-number surface (a known part / job / quote). */
  private wholeRecordToken(text: string): string | null {
    const hits = [...text.matchAll(this.dict.entityDict.matcher)];
    if (hits.length !== 1 || hits[0].index !== 0 || hits[0][0].length !== text.length) return null;
    const kind = this.surfaceAt(hits[0])?.kind;
    if (kind !== "PART" && kind !== "JOB" && kind !== "QUOTE") return null;
    return this.dictionaryPass(text)[0].text; // registers the entry with this exact surface
  }

  private surfaceAt(m: RegExpMatchArray) {
    let group = 1;
    while (group < m.length && m[group] === undefined) group++;
    const idx = this.dict.entityDict.groupToSurface[group] ?? -1;
    return idx < 0 ? null : this.dict.surfaceTokens[idx];
  }

  private patternToken(kind: PatternTokenKind, value: string): string {
    const norm = normalizePatternValue(kind, value);
    const key = `${kind}|${norm}`;
    let token = this.mintedByValue.get(key) ?? this.patterns.tokenFor(kind, value);
    if (!token) {
      token = patternTokenFor(this.dict.key, kind, value, (t) => {
        const mine = this.mintedValueOf.get(t);
        return mine !== undefined ? mine !== key : this.patterns.isTaken(t);
      });
      this.mintedByValue.set(key, token);
      this.mintedValueOf.set(token, key);
      this.minted.push({ token, kind, value: value.normalize("NFC").trim() });
    }
    if (!this.tokens.has(token)) {
      this.tokens.set(token, { token, kind, entityId: null, surface: value, source: "pattern" });
    }
    return token;
  }

  /** Lower-case first names ("ask ray") left in the text: shown in the preview as suspects. */
  private findSuspects(pieces: Piece[], field: string): void {
    if (this.dict.firstNames.size === 0) return;
    let offset = 0;
    const word = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
    for (const p of pieces) {
      if (!p.token) {
        for (const m of p.text.matchAll(word)) {
          const w = m[0];
          const ids = this.dict.firstNames.get(w.toLowerCase());
          if (!ids || w[0] !== w[0].toLowerCase()) continue;
          const start = offset + (m.index ?? 0);
          this.suspects.push({ text: w, field, start, end: start + w.length, candidateIds: [...ids] });
        }
      }
      offset += p.text.length;
    }
  }
}

function sortedDistinctTokens(strings: Iterable<string>): string[] {
  const all = new Set<string>();
  for (const s of strings) for (const t of tokensIn(s)) all.add(t);
  return [...all].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function compiled(dict: RedactionDictionary): CompiledRedactionDictionary {
  const d = dict as CompiledRedactionDictionary;
  if (!d.entityDict || !d.surfaceTokens) throw new TypeError("Not a compiled redaction dictionary.");
  return d;
}

export function redactText(
  text: string,
  dict: RedactionDictionary,
  patterns: PatternTokenResolver,
  opts: { field?: string } = {},
): RedactionResult<string> {
  const session = new RedactionSession(compiled(dict), patterns);
  const value = session.redact(text, opts.field ?? "user_input");
  return {
    value,
    tokens: session.tokens as TokenMap,
    tokensUsed: sortedDistinctTokens([value]),
    minted: session.minted,
    suspects: session.suspects,
  };
}

/**
 * Redacts a cloud model's response for storage: tokens in `keep` (the ones this request sent) stay as they are, and
 * everything between them is redacted like user input, so a name the model wrote in the clear never reaches the audit
 * log. A token the request didn't produce is escaped like any literal "[[…]]" (it can't be revealed later).
 */
export function redactAroundTokens(
  text: string,
  keep: ReadonlySet<string>,
  dict: RedactionDictionary,
  patterns: PatternTokenResolver,
  opts: { field?: string } = {},
): RedactionResult<string> {
  const session = new RedactionSession(compiled(dict), patterns);
  const field = opts.field ?? "response";
  const s = text.normalize("NFC");
  let value = "";
  let last = 0;
  for (const m of s.matchAll(tokenRegex())) {
    if (!keep.has(m[0])) continue;
    const start = m.index ?? 0;
    if (start > last) value += session.redact(s.slice(last, start), field);
    value += m[0];
    last = start + m[0].length;
  }
  if (last < s.length) value += session.redact(s.slice(last), field);
  return {
    value,
    tokens: session.tokens as TokenMap,
    tokensUsed: sortedDistinctTokens([value]),
    minted: session.minted,
    suspects: session.suspects,
  };
}

function redactJson(session: RedactionSession, value: JsonValue, field: string, out: string[]): JsonValue {
  if (typeof value === "string") {
    const r = session.redact(value, field);
    out.push(r);
    return r;
  }
  if (Array.isArray(value)) return value.map((v, i) => redactJson(session, v, `${field}[${i}]`, out));
  if (value !== null && typeof value === "object") {
    const obj: JsonObject = {};
    for (const [k, v] of Object.entries(value)) {
      const rk = session.redact(k, `${field}.${k}`);
      out.push(rk);
      obj[rk] = redactJson(session, v, `${field}.${k}`, out);
    }
    return obj;
  }
  return value;
}

/** Redacts every string in the request with one shared token map (P7). maxTokens / effort are not strings. */
export function redactRequest(
  req: ProviderRequest,
  dict: RedactionDictionary,
  patterns: PatternTokenResolver,
): RedactionResult<ProviderRequest> {
  const session = new RedactionSession(compiled(dict), patterns);
  const strings: string[] = [];
  const system = session.redact(req.system, "system");
  strings.push(system);
  const messages = req.messages.map((m, i) => {
    const content = session.redact(m.content, `messages[${i}].content`);
    strings.push(content);
    return { role: m.role, content };
  });
  let output: ProviderRequest["output"] = req.output;
  if (req.output.kind === "json") {
    const schemaName = session.redact(req.output.schemaName, "output.schemaName");
    strings.push(schemaName);
    const jsonSchema = redactJson(session, req.output.jsonSchema, "output.jsonSchema", strings) as JsonObject;
    output = { kind: "json", schemaName, jsonSchema };
  }
  const value: ProviderRequest = { system, messages, maxTokens: req.maxTokens, output };
  if (req.effort !== undefined) value.effort = req.effort;
  return {
    value,
    tokens: session.tokens as TokenMap,
    tokensUsed: sortedDistinctTokens(strings),
    minted: session.minted,
    suspects: session.suspects,
  };
}

/** Every token string in a value (strings walked recursively), distinct and code-point sorted. */
export function tokensInValue(value: unknown): string[] {
  const strings: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        strings.push(k);
        walk(x);
      }
    }
  };
  walk(value);
  return sortedDistinctTokens(strings);
}

/** True when the text contains anything of the token grammar (used by tests and seed checks). */
export function hasTokens(text: string): boolean {
  return tokenRegex().test(text);
}
