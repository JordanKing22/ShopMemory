/**
 * THE token grammar (CLAUDE.md hard rule 6, PLAN.md §4.5). Nothing else in the code base may define, parse or format
 * a redaction token: import from here.
 *
 *   [[KIND_XXXX]]      KIND ∈ CUSTOMER PERSON PART JOB QUOTE CONTACT PN EMAIL PHONE AMOUNT
 *   [[KIND_XXXX_F]]    first-name / nickname surface of a person or contact
 *   [[KIND_XXXX_L]]    last-name surface of a person or contact
 *
 * XXXX is 4 Crockford base32 characters: the first 20 bits of HMAC-SHA256(tokenKey(shop seed), message).
 * - Entity tokens: message "KIND|entityId" (opaque DB IDs such as CUS-01 / PER-01 / P-OWNER / PRT-A01). Collisions
 *   inside one kind are resolved deterministically: entity IDs are processed in code-point order and a later ID that
 *   hits a taken code retries with "KIND|entityId|1", "|2", … Variants share their entity's code.
 * - Pattern tokens (PN / EMAIL / PHONE / AMOUNT): message "KIND|value|<normalized value>", retried with "|1", "|2", …
 *   while the token already stands for a different value in redaction_tokens.
 * The key is a fixed demo constant derived from shop_profile.seed, so tokens are identical at seed time
 * (seed-data/audit/history.yaml, cassettes) and at run time, and stable across resets. Stable tokens let a provider
 * correlate a customer across calls; the Privacy page states that trade-off.
 *
 * Written by the architect (it is the shared contract every Phase 3 builder depends on); owned by the redaction
 * builder afterwards. Additions are fine; changing an output of an existing function changes every cassette and the
 * seeded audit history (re-run `npm run demo:record -- --rekey`, `npm run seed:lock`).
 *
 * Pure (node:crypto only): no DB, no env, no clock.
 */
import { createHash, createHmac } from "node:crypto";
import { TOKEN_KINDS, type TokenKind } from "@/db/schema/enums";
import type { EntityTokenKind, ParsedToken, PatternTokenKind, TokenVariant } from "./types";

export { TOKEN_KINDS };

export const ENTITY_TOKEN_KINDS: readonly EntityTokenKind[] = ["CUSTOMER", "PERSON", "PART", "JOB", "QUOTE", "CONTACT"];
export const PATTERN_TOKEN_KINDS: readonly PatternTokenKind[] = ["PN", "EMAIL", "PHONE", "AMOUNT"];

/** PLAN.md §4.5, verbatim. Groups: 1 = kind, 2 = code, 3 = variant (F | L) or undefined. */
export const TOKEN_PATTERN_SOURCE = String.raw`\[\[(CUSTOMER|PERSON|PART|JOB|QUOTE|CONTACT|PN|EMAIL|PHONE|AMOUNT)_([0-9A-Z]{4})(?:_([FL]))?\]\]`;

/** A fresh global matcher (callers may use matchAll / replace without sharing lastIndex state). */
export function tokenRegex(): RegExp {
  return new RegExp(TOKEN_PATTERN_SOURCE, "g");
}

const TOKEN_EXACT = new RegExp(`^${TOKEN_PATTERN_SOURCE}$`);

/** Length of the longest possible token ("[[CUSTOMER_XXXX_F]]" = 19). The stream restorer buffers at most this much. */
export const TOKEN_MAX_LENGTH = "[[CUSTOMER_XXXX_F]]".length;

export function isToken(s: string): boolean {
  return TOKEN_EXACT.test(s);
}

export function parseToken(s: string): ParsedToken | null {
  const m = TOKEN_EXACT.exec(s);
  if (!m) return null;
  const parsed: ParsedToken = { kind: m[1] as TokenKind, code: m[2] };
  if (m[3] === "F" || m[3] === "L") parsed.variant = m[3];
  return parsed;
}

export function formatToken(kind: TokenKind, code: string, variant?: TokenVariant): string {
  return variant ? `[[${kind}_${code}_${variant}]]` : `[[${kind}_${code}]]`;
}

/** All tokens in a text, in order (duplicates kept). */
export function tokensIn(text: string): string[] {
  return [...text.matchAll(tokenRegex())].map((m) => m[0]);
}

// ---------------------------------------------------------------------------------------------------------------
// Literal escaping (applied to every string before redaction, so a typed "[[CONTACT_7QK2]]" is never a token)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Breaks every "[[" and "]]" run with a space ("[[" → "[ [", "]]]" → "] ] ]"). Idempotent; the result contains no
 * "[[" or "]]", so nothing in it can match the token grammar or be revealed.
 */
export function escapeLiteralTokens(s: string): string {
  return s.replace(/\[(?=\[)/g, "[ ").replace(/\](?=\])/g, "] ");
}

// ---------------------------------------------------------------------------------------------------------------
// Citations ([S#] source keys; validated by the stream restorer in the same pass as token restoration)
// ---------------------------------------------------------------------------------------------------------------

/** "[S1]" … "[S999]". Group 1 = the number. One key per bracket. */
export const CITATION_PATTERN_SOURCE = String.raw`\[S([1-9][0-9]{0,2})\]`;
export const CITATION_MAX_LENGTH = "[S999]".length;

export function citationRegex(): RegExp {
  return new RegExp(CITATION_PATTERN_SOURCE, "g");
}

// ---------------------------------------------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------------------------------------------

/** Crockford base32 (no I, L, O, U). Every generated code uses it; the grammar accepts [0-9A-Z]. */
export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const TOKEN_KEY_LABEL = "floorwise-redaction-token-key-v1";

/** The HMAC key for a shop seed (shop_profile.seed). A demo constant, not a secret. */
export function tokenKey(tokenSeed: number): Buffer {
  return createHash("sha256").update(`${TOKEN_KEY_LABEL}|${tokenSeed}`, "utf8").digest();
}

/** First 20 bits of HMAC-SHA256(key, message) as 4 Crockford characters. */
export function hmacCode(key: Buffer, message: string): string {
  const d = createHmac("sha256", key).update(message, "utf8").digest();
  const bits = (d[0] << 12) | (d[1] << 4) | (d[2] >> 4);
  let out = "";
  for (let shift = 15; shift >= 0; shift -= 5) out += CROCKFORD_ALPHABET[(bits >> shift) & 31];
  return out;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const MAX_ATTEMPTS = 10_000;

/** Map key used by {@link assignEntityCodes}: "KIND|entityId". */
export function entityCodeKey(kind: EntityTokenKind, entityId: string): string {
  return `${kind}|${entityId}`;
}

/**
 * Pseudo entity ID of the ambiguity token for a first name shared by two or more people (or two or more contacts).
 * It takes part in {@link assignEntityCodes} like any other ID of that kind and is always used with variant "F".
 */
export function ambiguityEntityId(firstName: string): string {
  return `~ambiguous:${firstName.normalize("NFC").toLowerCase()}`;
}

/**
 * Codes for a set of entities, deterministic for a given set: per kind, IDs are processed in code-point order and a
 * collision retries with a counter suffix. Returns entityCodeKey(kind, id) → code. Duplicates are ignored.
 */
export function assignEntityCodes(
  key: Buffer,
  entities: readonly { kind: EntityTokenKind; entityId: string }[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const kind of ENTITY_TOKEN_KINDS) {
    const ids = [...new Set(entities.filter((e) => e.kind === kind).map((e) => e.entityId))].sort(cmp);
    const used = new Set<string>();
    for (const id of ids) {
      let assigned = false;
      for (let attempt = 0; attempt < MAX_ATTEMPTS && !assigned; attempt++) {
        const code = hmacCode(key, attempt === 0 ? `${kind}|${id}` : `${kind}|${id}|${attempt}`);
        if (!used.has(code)) {
          used.add(code);
          out.set(entityCodeKey(kind, id), code);
          assigned = true;
        }
      }
      if (!assigned) throw new Error("Token space exhausted."); // unreachable in practice; carries no value
    }
  }
  return out;
}

/** The value a pattern token is keyed by: NFC + trimmed; emails also lower-cased. */
export function normalizePatternValue(kind: PatternTokenKind, value: string): string {
  const v = value.normalize("NFC").trim();
  return kind === "EMAIL" ? v.toLowerCase() : v;
}

/**
 * The token for a pattern hit. `isTaken(token)` must return true when that token already stands for a DIFFERENT
 * value (redaction_tokens); the next counter is then tried. Same value → same token, across requests and resets.
 */
export function patternTokenFor(
  key: Buffer,
  kind: PatternTokenKind,
  value: string,
  isTaken: (token: string) => boolean = () => false,
): string {
  const norm = normalizePatternValue(kind, value);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const message = attempt === 0 ? `${kind}|value|${norm}` : `${kind}|value|${norm}|${attempt}`;
    const token = formatToken(kind, hmacCode(key, message));
    if (!isTaken(token)) return token;
  }
  throw new Error("Token space exhausted."); // unreachable in practice; carries no value
}
