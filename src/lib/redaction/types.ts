/**
 * Shared redaction types (docs/AI-GATEWAY.md §6, PLAN.md §4.5). Type-only. The token grammar itself lives only in
 * src/lib/redaction/patterns.ts (CLAUDE.md hard rule 6). Written by the architect; the redaction builder owns this
 * file afterwards and may add to it.
 */
import type { TokenKind } from "@/db/schema/enums";
import type { DictionaryInput } from "@/lib/policy/entity-detect";

export type { TokenKind };

/** Tokens computed from the HMAC rule over a dictionary entity ID (stable across resets). */
export type EntityTokenKind = "CUSTOMER" | "PERSON" | "PART" | "JOB" | "QUOTE" | "CONTACT";
/** Tokens minted from regex hits (value-keyed HMAC) and persisted in redaction_tokens. */
export type PatternTokenKind = "PN" | "EMAIL" | "PHONE" | "AMOUNT";
/** Surface-form variant of a person/contact token: F = first name / nickname, L = last name. Full name has none. */
export type TokenVariant = "F" | "L";

export interface ParsedToken {
  kind: TokenKind;
  /** 4 characters of the grammar alphabet. */
  code: string;
  variant?: TokenVariant;
}

// ---------------------------------------------------------------------------------------------------------------
// Dictionary
// ---------------------------------------------------------------------------------------------------------------

/** One customer contact (customer_accounts row). Contacts are never sent to a model; free-text mentions are tokenized. */
export interface ContactInput {
  /** customer_accounts.customer_id; the CONTACT token's entity ID. */
  customerId: string;
  /** As stored, e.g. "Morgan Ellery (fictional)". A trailing parenthetical is ignored for matching. */
  name: string | null;
  /** As stored (@example.com). Matched by the EMAIL pattern, not the dictionary. */
  email: string | null;
}

/**
 * Everything the redaction dictionary is built from. Produced by src/lib/data/dictionary.ts from the DB (runtime) or
 * from seed bundle tables (seed:check), so seed time and run time produce identical tokens.
 */
export interface RedactionDictionaryInput {
  /** The entity-detect input: customers + aliases, people + the owner persona, parts, jobs, quotes, stoplists. */
  entities: DictionaryInput;
  contacts: readonly ContactInput[];
  /** shop_profile.seed. Keys the token HMAC (patterns.ts tokenKey()). */
  tokenSeed: number;
}

/** What an entity token stands for. Used by Reveal, local-replay de-tokenization and seed:check. */
export interface EntityTokenInfo {
  token: string;
  kind: EntityTokenKind;
  /** Dictionary entity ID (CUS-01, PER-01, P-OWNER, PRT-A01, J-A10, Q-A01, contact: the customer ID); null for an ambiguity token. */
  entityId: string | null;
  /** Canonical text for this token and variant ("Aerovance", "Ray Delgado", "Ray", "Delgado", "AV-2231-07"). */
  display: string;
  variant?: TokenVariant;
  /** Shared first name of two people/contacts: restores to the first name only. */
  ambiguous: boolean;
}

/**
 * The compiled dictionary. Consumers use only these fields; the redaction builder's concrete type extends this
 * interface with its compiled matcher.
 */
export interface RedactionDictionary {
  /** sha256 of the canonical input (cache key; changes when any surface changes). */
  readonly version: string;
  readonly tokenSeed: number;
  /** Every entity token (all variants, ambiguity tokens included) → what it stands for. */
  readonly entityTokens: ReadonlyMap<string, EntityTokenInfo>;
}

// ---------------------------------------------------------------------------------------------------------------
// Redacting one request
// ---------------------------------------------------------------------------------------------------------------

/** One token produced while redacting THIS request. Restoration and Reveal resolve only these. */
export interface TokenMapEntry {
  token: string;
  kind: TokenKind;
  entityId: string | null;
  /** The exact text replaced (first occurrence in this request). Restoration emits it. Never logged. */
  surface: string;
  variant?: TokenVariant;
  ambiguous?: boolean;
  source: "dictionary" | "pattern";
}

/** token → entry, for one request only. */
export type TokenMap = ReadonlyMap<string, TokenMapEntry>;

/** A pattern token minted by this request that isn't persisted yet (the caller writes it to redaction_tokens). */
export interface PatternTokenRecord {
  token: string;
  kind: PatternTokenKind;
  /** The exact matched text. Sensitive: never logged, never routable. */
  value: string;
}

/** Read access to redaction_tokens (src/lib/audit/token-store.ts implements it). */
export interface PatternTokenResolver {
  /** Existing token for this exact value, if any. */
  tokenFor(kind: PatternTokenKind, value: string): string | undefined;
  /** True when the token string already stands for a different value (collision → next counter). */
  isTaken(token: string): boolean;
}

/** A lowercase first name ("ask ray") that matched no dictionary surface; shown in the preview, never auto-redacted. */
export interface Suspect {
  text: string;
  /** Where it was found: "user_input", "system", "messages[1].content", … */
  field: string;
  start: number;
  end: number;
  /** People/contacts whose first name this is. */
  candidateIds: string[];
}

export interface RedactionResult<T> {
  /** The redacted value (same shape as the input). */
  value: T;
  /** This request's tokens. */
  tokens: TokenMap;
  /** Distinct tokens in `value`, code-point sorted (the audit's tokens_used). */
  tokensUsed: string[];
  /** Pattern tokens minted by this call that the caller must persist. */
  minted: PatternTokenRecord[];
  suspects: Suspect[];
}

// ---------------------------------------------------------------------------------------------------------------
// Restoring a response
// ---------------------------------------------------------------------------------------------------------------

export interface StreamRestorerOptions {
  /** This request's token map. Unknown tokens restore to "[unknown]". Pass an empty map for local targets. */
  tokens: TokenMap;
  /** S# keys actually sent ("S1"…). Citations to other keys are stripped and counted. null = no citation check. */
  sentSourceKeys: ReadonlySet<string> | null;
}

export interface RestoreStats {
  restoredTokens: number;
  unknownTokens: number;
  citationsValid: number;
  citationsStripped: number;
}
