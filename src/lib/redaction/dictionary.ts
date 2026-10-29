/**
 * The redaction dictionary (PLAN.md §4.5, docs/AI-GATEWAY.md §6): customers + aliases, people and the owner persona
 * (full / first / last forms), customer contacts, part / job / quote numbers. It reuses the entity detector's
 * compiled alternation (src/lib/policy/entity-detect.ts), so redaction and P3 classification see exactly the same
 * surfaces: longest first, Unicode boundaries, NFC, "X-Ray" / "Gamma Ray" consumed, separator-tolerant numbers.
 *
 * Every surface maps to one token. Codes come from patterns.ts (HMAC of the shop seed and the opaque entity ID), so
 * they are identical at seed time and run time and stable across resets. A surface shared by two people (or two
 * contacts) gets an ambiguity token that restores to that surface only.
 *
 * Pure: no DB, no env, no clock, no logging. Real names live only inside the returned object.
 */
import { buildDictionary, type DictionaryCandidate, type EntityDictionary } from "@/lib/policy/entity-detect";
import { canonicalJson, sha256Hex } from "@/lib/seed/source";
import { ambiguityEntityId, assignEntityCodes, entityCodeKey, formatToken, tokenKey } from "./patterns";
import type {
  EntityTokenInfo,
  EntityTokenKind,
  RedactionDictionary,
  RedactionDictionaryInput,
  TokenKind,
  TokenVariant,
} from "./types";

/** Contacts join the entity detector as people under this ID prefix (never a real DB ID). */
const CONTACT_PREFIX = "~contact:";

/** The token a dictionary surface is replaced with. */
export interface SurfaceToken {
  token: string;
  kind: EntityTokenKind;
  /** null for an ambiguity token. */
  entityId: string | null;
  variant?: TokenVariant;
  ambiguous: boolean;
}

export interface CompiledRedactionDictionary extends RedactionDictionary {
  /** The entity detector over every surface (contacts included as people with a "~contact:" ID). */
  readonly entityDict: EntityDictionary;
  /** surface index (entityDict.surfaces) → token. */
  readonly surfaceTokens: readonly SurfaceToken[];
  /** HMAC key for pattern tokens (tokenKey(tokenSeed)). */
  readonly key: Buffer;
  /** Lower-cased first names / nicknames of people and contacts → their IDs (preview suspects: "ask ray"). */
  readonly firstNames: ReadonlyMap<string, readonly string[]>;
  /** PN shapes (unanchored, compiled): customer part-number patterns plus the shop's RJ-/RQ- numbers. */
  readonly pnRegex: RegExp | null;
}

/** "Morgan Ellery (fictional)" → "Morgan Ellery". */
export function contactDisplayName(name: string): string {
  return name.replace(/\s*\([^()]*\)\s*$/u, "").replace(/\s+/gu, " ").trim();
}

function isContactId(id: string): boolean {
  return id.startsWith(CONTACT_PREFIX);
}

/** The shop's own job and quote number shapes ("RJ-26-0310", "RQ-26-0911"). */
const SHOP_NUMBER_SHAPES = [String.raw`R[JQ]-\d{2}-\d{4}`];

function compilePn(patterns: readonly string[]): RegExp | null {
  const parts: string[] = [];
  for (const raw of [...patterns, ...SHOP_NUMBER_SHAPES]) {
    const inner = raw.replace(/^\^/, "").replace(/\$$/, "");
    if (!inner) continue;
    try {
      new RegExp(inner, "u"); // validate alone so one bad pattern can't disable the rest
      parts.push(`(?:${inner})`);
    } catch {
      // An invalid seed pattern is reported by seed:check; here it is skipped.
    }
  }
  if (parts.length === 0) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join("|")})(?![\\p{L}\\p{N}])`, "giu");
}

export function buildRedactionDictionary(input: RedactionDictionaryInput): CompiledRedactionDictionary {
  const contacts = input.contacts
    .filter((c) => c.name && contactDisplayName(c.name))
    .map((c) => {
      const fullName = contactDisplayName(c.name!);
      const words = fullName.split(" ");
      const aliases = words.length > 1 ? [words[0], words[words.length - 1]] : [];
      return { id: `${CONTACT_PREFIX}${c.customerId}`, customerId: c.customerId, fullName, aliases };
    });

  const entityDict = buildDictionary({
    ...input.entities,
    people: [...input.entities.people, ...contacts.map(({ id, fullName, aliases }) => ({ id, fullName, aliases }))],
  });

  // Canonical display text per entity.
  const display = new Map<string, string>();
  for (const c of input.entities.customers) display.set(entityCodeKey("CUSTOMER", c.id), c.name);
  for (const p of input.entities.people) display.set(entityCodeKey("PERSON", p.id), p.fullName);
  for (const c of contacts) display.set(entityCodeKey("CONTACT", c.customerId), c.fullName);
  for (const r of input.entities.parts) display.set(entityCodeKey("PART", r.id), r.partNumber);
  for (const r of input.entities.jobs) display.set(entityCodeKey("JOB", r.id), r.jobNumber);
  for (const r of input.entities.quotes) display.set(entityCodeKey("QUOTE", r.id), r.quoteNumber);

  // Resolve every surface to (kind, entity or ambiguity ID, variant) before codes exist.
  interface Pending {
    kind: EntityTokenKind;
    entityId: string;
    variant?: TokenVariant;
    ambiguous: boolean;
    display: string;
  }
  const pending: Pending[] = entityDict.surfaces.map((surface) => {
    const ids = [...new Set(surface.candidates.map((c: DictionaryCandidate) => c.id))];
    if (surface.kind === "person") {
      // A surface shared by a person and a contact is treated as a contact (stricter Reveal rules: fail closed).
      const kind: EntityTokenKind = ids.some(isContactId) ? "CONTACT" : "PERSON";
      const variant: TokenVariant | undefined = surface.form === "first" ? "F" : surface.form === "last" ? "L" : undefined;
      if (ids.length > 1) {
        const ambiguity = ambiguityEntityId(variant === "L" ? `last:${surface.text}` : variant ? surface.text : `full:${surface.text}`);
        return { kind, entityId: ambiguity, variant: variant ?? "F", ambiguous: true, display: surface.text };
      }
      const id = isContactId(ids[0]) ? ids[0].slice(CONTACT_PREFIX.length) : ids[0];
      const full = display.get(entityCodeKey(kind, id)) ?? surface.text;
      return { kind, entityId: id, variant, ambiguous: false, display: variant ? surface.text : full };
    }
    const kind: EntityTokenKind =
      surface.kind === "customer" ? "CUSTOMER" : surface.kind === "part" ? "PART" : surface.kind === "job" ? "JOB" : "QUOTE";
    return { kind, entityId: ids[0], ambiguous: false, display: display.get(entityCodeKey(kind, ids[0])) ?? surface.text };
  });

  const entities: { kind: EntityTokenKind; entityId: string }[] = [
    ...input.entities.customers.map((c) => ({ kind: "CUSTOMER" as const, entityId: c.id })),
    ...input.entities.people.map((p) => ({ kind: "PERSON" as const, entityId: p.id })),
    ...contacts.map((c) => ({ kind: "CONTACT" as const, entityId: c.customerId })),
    ...input.entities.parts.map((r) => ({ kind: "PART" as const, entityId: r.id })),
    ...input.entities.jobs.map((r) => ({ kind: "JOB" as const, entityId: r.id })),
    ...input.entities.quotes.map((r) => ({ kind: "QUOTE" as const, entityId: r.id })),
    ...pending.filter((p) => p.ambiguous).map((p) => ({ kind: p.kind, entityId: p.entityId })),
  ];
  const key = tokenKey(input.tokenSeed);
  const codes = assignEntityCodes(key, entities);
  const codeOf = (kind: EntityTokenKind, id: string) => codes.get(entityCodeKey(kind, id))!;

  const entityTokens = new Map<string, EntityTokenInfo>();
  const addInfo = (info: EntityTokenInfo) => {
    if (!entityTokens.has(info.token)) entityTokens.set(info.token, info);
  };
  // Base (full-form) tokens for every entity, so Reveal works even for entities with no matchable surface.
  for (const e of entities) {
    if (e.entityId.startsWith("~")) continue;
    const token = formatToken(e.kind, codeOf(e.kind, e.entityId));
    addInfo({ token, kind: e.kind, entityId: e.entityId, display: display.get(entityCodeKey(e.kind, e.entityId)) ?? "", ambiguous: false });
  }

  const surfaceTokens: SurfaceToken[] = pending.map((p) => {
    const token = formatToken(p.kind as TokenKind, codeOf(p.kind, p.entityId), p.variant);
    const info: EntityTokenInfo = {
      token,
      kind: p.kind,
      entityId: p.ambiguous ? null : p.entityId,
      display: p.display,
      ambiguous: p.ambiguous,
    };
    if (p.variant) info.variant = p.variant;
    addInfo(info);
    const st: SurfaceToken = { token, kind: p.kind, entityId: info.entityId, ambiguous: p.ambiguous };
    if (p.variant) st.variant = p.variant;
    return st;
  });

  const firstNames = new Map<string, string[]>();
  entityDict.surfaces.forEach((surface) => {
    if (surface.kind !== "person" || surface.form !== "first") return;
    const ids = surface.candidates.map((c) => (isContactId(c.id) ? c.id.slice(CONTACT_PREFIX.length) : c.id));
    const k = surface.text.normalize("NFC").toLowerCase();
    firstNames.set(k, [...new Set([...(firstNames.get(k) ?? []), ...ids])]);
  });

  const version = sha256Hex(canonicalJson(input));
  return {
    version,
    tokenSeed: input.tokenSeed,
    entityTokens,
    entityDict,
    surfaceTokens,
    key,
    firstNames,
    pnRegex: compilePn(input.partNumberPatterns ?? []),
  };
}

export interface DictionaryHit {
  kind: TokenKind;
  start: number;
  end: number;
}

/**
 * Positions (never text) of dictionary surfaces in `text` (NFC offsets). Lets "no names here" checks run on cassettes,
 * seeded rows and logs without ever printing a name.
 */
export function dictionaryHits(text: string, dict: RedactionDictionary): DictionaryHit[] {
  const d = dict as CompiledRedactionDictionary;
  const s = text.normalize("NFC");
  const hits: DictionaryHit[] = [];
  for (const m of s.matchAll(d.entityDict.matcher)) {
    let group = 1;
    while (group < m.length && m[group] === undefined) group++;
    const idx = d.entityDict.groupToSurface[group] ?? -1;
    if (idx < 0) continue;
    const start = m.index ?? 0;
    hits.push({ kind: d.surfaceTokens[idx].kind, start, end: start + m[0].length });
  }
  return hits;
}
