/**
 * Entity detection and suspicion signals (PLAN.md §4.2 P3, §4.3, §4.4, §4.5).
 *
 * One detector serves three callers:
 * - the request classifier (P3): naming an export-controlled job or part makes the question itself
 *   export-controlled ({@link floorFromText}), and deterministic {@link suspicionSignals} mark a request
 *   `suspected_controlled` before anything is sent;
 * - the content scan in `src/db/classification.ts` callers (card text, document bodies, transcript turns,
 *   quote-log answers), so a record that *mentions* an export-controlled job inherits export_controlled;
 * - the seed loader and `seed:check` (classification ≥ derived floor, including mentions).
 *
 * The dictionary is built from plain data passed in ({@link DictionaryInput}); this module has no I/O,
 * no clock and no randomness, and it knows no domain facts of its own.
 *
 * Matching rules
 * - One compiled alternation, longest surface first ("Ray Delgado" before "Ray"), leftmost match wins,
 *   matches never overlap. Unicode-aware boundaries `(?<![\p{L}\p{N}]) … (?![\p{L}\p{N}])`, so
 *   "Aerovance's" matches Aerovance but "Aerovances" does not.
 * - Customer names and aliases, person full names and last names (≥ 4 characters) are case-insensitive.
 *   First names and nicknames (and last names shorter than 4 characters) match case-sensitively in their
 *   capitalized form only ("Ray" yes, "ask ray" no).
 * - A small stoplist of compounds ("X-Ray", "Gamma Ray") is consumed before person names can match inside it.
 * - Part, job and quote numbers are case-insensitive with optional separators between their letter/digit
 *   groups (hyphen, dash, dot, space or none); part numbers also accept one trailing revision letter:
 *   "AV-2231-07", "AV223107", "av 2231 07" and "AV-2231-07C" all match `AV-2231-07`.
 * - Input text is NFC-normalized before matching. Offsets (`start`/`end`) index the NFC form, which is
 *   identical to the input for NFC input (the seed loader and the app normalize everything to NFC).
 *
 * Classification of a mention: customer → the customer's own classification (naming a defense customer is
 * not by itself export-controlled; its part floor only drives the near-miss signal); person → `internal`;
 * part / job / quote → the record's classification.
 */
import { CLASS_RANK, maxClass, type Classification } from "@/db/schema/enums";

// ---------------------------------------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------------------------------------

/** What a mention refers to. */
export type EntityKind = "customer" | "person" | "part" | "job" | "quote";

/** Which surface form of a person matched; drives the redactor's `_F` / `_L` token variants. */
export type PersonForm = "full" | "first" | "last";

export interface CustomerInput {
  id: string;
  name: string;
  aliases: readonly string[];
  /** The customer record's own classification (normally customer_confidential). */
  classification: Classification;
  /** Minimum classification of this customer's parts, quotes and jobs (defense customers: export_controlled). */
  partClassificationFloor: Classification;
}

export interface PersonInput {
  id: string;
  fullName: string;
  /** Every way the name may appear in text (full name, last name, first name, nicknames). */
  aliases: readonly string[];
}

export interface PartInput {
  id: string;
  partNumber: string;
  classification: Classification;
}

export interface JobInput {
  id: string;
  jobNumber: string;
  classification: Classification;
}

export interface QuoteInput {
  id: string;
  quoteNumber: string;
  classification: Classification;
}

/** Plain data the dictionary is built from (the seed bundle or the DB supplies it). */
export interface DictionaryInput {
  customers: readonly CustomerInput[];
  /** People and persona-only labels (including the owner, who is not a knowledge holder). */
  people: readonly PersonInput[];
  parts: readonly PartInput[];
  jobs: readonly JobInput[];
  quotes: readonly QuoteInput[];
  /**
   * Material / spec / machine numbers that must never count as a numeric core (e.g. "6061", "7075", "718",
   * "9102"). Entries may carry letters or separators ("AS9102", "17-4"); their digit groups and the
   * concatenation of those groups are all stoplisted.
   */
  stoplistNumbers: readonly string[];
  /** Compounds that never match person names. Defaults to {@link DEFAULT_NAME_COMPOUND_STOPLIST}. */
  nameCompoundStoplist?: readonly string[];
  /**
   * Ordinary words that happen to be one edit away from a watched customer name and must not raise a
   * near-miss signal (compared case-insensitively). Empty by default.
   */
  nearMissIgnore?: readonly string[];
}

/** One record a dictionary surface can refer to. */
export interface DictionaryCandidate {
  kind: EntityKind;
  id: string;
  classification: Classification;
  /** Person candidates only. */
  form?: PersonForm;
}

/** One matchable surface form, compiled into the alternation. */
export interface DictionarySurface {
  kind: EntityKind;
  /** The canonical text the surface was built from ("AV-2231-07", "Ray Delgado", "Ray"). */
  text: string;
  caseSensitive: boolean;
  /** Person surfaces only. */
  form?: PersonForm;
  /** Records sharing this surface (normally one; more means an ambiguous surface such as a shared first name). */
  candidates: readonly DictionaryCandidate[];
  /** Max classification over the candidates. */
  classification: Classification;
}

/** A distinctive digit sequence that identifies exactly one export-controlled part or job. */
export interface NumericCore {
  core: string;
  recordKind: "part" | "job";
  recordId: string;
  classification: Classification;
}

/** A customer name/alias watched for one-edit misspellings. */
export interface NearMissTarget {
  customerId: string;
  /** The name or alias as given. */
  surface: string;
  /** Lower-cased, NFC, words joined by single spaces. */
  normalized: string;
  wordCount: number;
  /** The customer's part classification floor (the level a misspelled mention should be treated as). */
  classification: Classification;
}

/** The compiled dictionary. Treat as immutable; rebuild it when the underlying records change. */
export interface EntityDictionary {
  readonly surfaces: readonly DictionarySurface[];
  readonly numericCores: ReadonlyMap<string, NumericCore>;
  readonly nearMissTargets: readonly NearMissTarget[];
  /** Normalized customer names and aliases (all customers): exact hits are never near-misses. */
  readonly exactCustomerNames: ReadonlySet<string>;
  readonly nearMissIgnore: ReadonlySet<string>;
  /** The compiled alternation (global + unicode). Use {@link detectEntities}; `matchAll` clones it. */
  readonly matcher: RegExp;
  /** Capture group n (1-based) → index into `surfaces`, or -1 for a stoplisted compound. */
  readonly groupToSurface: readonly number[];
}

/** A dictionary hit in a piece of text. */
export interface EntityMention {
  kind: EntityKind;
  /** The matched record. For an ambiguous surface, the first candidate in input order (see `ambiguousIds`). */
  id: string;
  /** The exact matched text (NFC). */
  surface: string;
  start: number;
  end: number;
  /** customer → its classification; person → internal; part/job/quote → the record's classification. */
  classification: Classification;
  /** Person mentions only: which surface form matched. */
  form?: PersonForm;
  /** Present when the surface belongs to more than one record of this kind (e.g. two people named "Sam"). */
  ambiguousIds?: string[];
}

/** A deterministic pre-send hint that text is about export-controlled work without naming it exactly. */
export interface SuspicionSignal {
  kind: "numeric_core" | "near_miss_customer";
  /** The export-controlled part/job (numeric_core) or the defense customer (near_miss_customer). */
  recordId: string;
  recordKind: "part" | "job" | "customer";
  /** The text that triggered the signal (NFC). */
  surface: string;
  start: number;
  end: number;
  /** The classification the request is suspected to carry (export_controlled for the seeded data). */
  classification: Classification;
}

// ---------------------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------------------

/** Compounds that must never be read as a person's name. Kept deliberately small. */
export const DEFAULT_NAME_COMPOUND_STOPLIST: readonly string[] = ["X-Ray", "Gamma Ray"];
/** Last names at least this long match case-insensitively; shorter ones behave like first names. */
export const LAST_NAME_MIN_CASE_INSENSITIVE = 4;
/** A numeric core has at least this many digits. */
export const NUMERIC_CORE_MIN_DIGITS = 4;
/** Only customer names/aliases at least this long are watched for near-misses. */
export const NEAR_MISS_MIN_LENGTH = 7;
/** Every person mention carries this classification (people are implicitly internal, PLAN.md §4.3). */
export const PERSON_CLASSIFICATION: Classification = "internal";

const BOUNDARY_BEFORE = "(?<![\\p{L}\\p{N}])";
const BOUNDARY_AFTER = "(?![\\p{L}\\p{N}])";
/** Optional separator between the letter/digit groups of a part, job or quote number. */
const NUMBER_SEP = "[\\-\\u2010-\\u2015.\\u0020\\u00A0]?";
/** Optional trailing revision letter on a part number ("AV-2231-07C", "AV-2231-07-C"). */
const REVISION_SUFFIX = "(?:[\\-\\u2010-\\u2015]?[A-Za-z])?";
/** Separators allowed between the words of a stoplisted compound ("X-Ray", "X Ray", "Gamma-Ray"). */
const COMPOUND_SEP = "[\\s\\-\\u2010-\\u2015]+";

/**
 * A chain of digit groups joined by hyphens/dashes ("4410", "4410-120", "26-0310"). Decimal and
 * thousands-grouped numbers ("1.4410", "4,410") are single numbers, not chains of standalone groups.
 */
const NUMERIC_CHAIN = new RegExp(
  "(?<![\\p{L}\\p{N}]|[0-9][.,])[0-9]+(?:[\\-\\u2010-\\u2015][0-9]+)*(?![\\p{L}\\p{N}]|[.,][0-9])",
  "gu",
);
const DIGIT_GROUP = /[0-9]+/g;
const WORD = new RegExp("[\\p{L}\\p{N}]+", "gu");
const TOKEN_GAP = new RegExp("^[\\s\\-\\u2010-\\u2015]+$", "u");
const LETTER_OR_DIGIT_RUN = new RegExp("\\p{L}+|\\p{N}+", "gu");

const KIND_ORDER: Record<EntityKind, number> = { part: 0, job: 1, quote: 2, customer: 3, person: 4 };

// ---------------------------------------------------------------------------------------------------------
// Dictionary
// ---------------------------------------------------------------------------------------------------------

interface Alternative {
  pattern: string;
  sortLength: number;
  rank: number;
  kindOrder: number;
  seq: number;
  /** Index into surfaces, or -1 for a stoplisted compound. */
  surface: number;
}

interface SurfaceDraft {
  kind: EntityKind;
  text: string;
  caseSensitive: boolean;
  form?: PersonForm;
  pattern: string;
  candidates: DictionaryCandidate[];
}

/**
 * Build the entity dictionary: compiled surface alternation, numeric cores and near-miss targets.
 * Blank names and aliases are ignored. Deterministic for a given input.
 */
export function buildDictionary(input: DictionaryInput): EntityDictionary {
  const drafts: SurfaceDraft[] = [];
  const byKey = new Map<string, SurfaceDraft>();

  const add = (
    kind: EntityKind,
    text: string,
    pattern: string,
    caseSensitive: boolean,
    candidate: DictionaryCandidate,
    form?: PersonForm,
  ) => {
    const key = `${kind}|${form ?? ""}|${pattern}`;
    let draft = byKey.get(key);
    if (!draft) {
      draft = { kind, text, caseSensitive, form, pattern, candidates: [] };
      byKey.set(key, draft);
      drafts.push(draft);
    }
    if (!draft.candidates.some((c) => c.id === candidate.id)) draft.candidates.push(candidate);
  };

  for (const c of input.customers) {
    for (const surface of uniqueClean([c.name, ...c.aliases])) {
      add("customer", surface, literal(surface, true), false, {
        kind: "customer",
        id: c.id,
        classification: c.classification,
      });
    }
  }

  for (const p of input.people) {
    const fullName = clean(p.fullName);
    const fullWords = fullName.split(" ").filter(Boolean);
    const lastName = fullWords.length > 1 ? fullWords[fullWords.length - 1].toLowerCase() : null;
    for (const surface of uniqueClean([p.fullName, ...p.aliases])) {
      let form: PersonForm;
      let caseSensitive: boolean;
      if (surface.includes(" ")) {
        form = "full";
        caseSensitive = false;
      } else if (lastName !== null && surface.toLowerCase() === lastName) {
        form = "last";
        caseSensitive = codePointLength(surface) < LAST_NAME_MIN_CASE_INSENSITIVE;
      } else {
        form = "first";
        caseSensitive = true;
      }
      const text = caseSensitive ? capitalize(surface) : surface;
      const candidate: DictionaryCandidate = { kind: "person", id: p.id, classification: PERSON_CLASSIFICATION, form };
      add("person", text, literal(text, !caseSensitive), caseSensitive, candidate, form);
    }
  }

  const addNumber = (kind: "part" | "job" | "quote", id: string, number: string, classification: Classification) => {
    const text = clean(number);
    const pattern = numberPattern(text, kind === "part");
    if (pattern === null) return;
    add(kind, text, pattern, false, { kind, id, classification });
  };
  for (const r of input.parts) addNumber("part", r.id, r.partNumber, r.classification);
  for (const r of input.jobs) addNumber("job", r.id, r.jobNumber, r.classification);
  for (const r of input.quotes) addNumber("quote", r.id, r.quoteNumber, r.classification);

  const surfaces: DictionarySurface[] = drafts.map((d) => ({
    kind: d.kind,
    text: d.text,
    caseSensitive: d.caseSensitive,
    ...(d.form ? { form: d.form } : {}),
    candidates: d.candidates,
    classification: maxClass(...d.candidates.map((c) => c.classification)),
  }));

  const alternatives: Alternative[] = drafts.map((d, i) => ({
    pattern: d.pattern,
    sortLength: codePointLength(d.text),
    rank: CLASS_RANK[surfaces[i].classification],
    kindOrder: KIND_ORDER[d.kind],
    seq: i,
    surface: i,
  }));
  const compounds = uniqueClean(input.nameCompoundStoplist ?? DEFAULT_NAME_COMPOUND_STOPLIST);
  compounds.forEach((compound, i) => {
    const words = compound.split(new RegExp(COMPOUND_SEP, "u")).filter(Boolean);
    if (words.length === 0) return;
    alternatives.push({
      pattern: words.map((w) => literal(w, true)).join(COMPOUND_SEP),
      sortLength: codePointLength(compound),
      rank: CLASS_RANK.export_controlled + 1, // stoplisted compounds win ties
      kindOrder: -1,
      seq: drafts.length + i,
      surface: -1,
    });
  });
  alternatives.sort(
    (a, b) => b.sortLength - a.sortLength || b.rank - a.rank || a.kindOrder - b.kindOrder || a.seq - b.seq,
  );

  const body = alternatives.length > 0 ? alternatives.map((a) => `(${a.pattern})`).join("|") : "(?!)";
  const matcher = new RegExp(`${BOUNDARY_BEFORE}(?:${body})${BOUNDARY_AFTER}`, "gu");
  const groupToSurface = [-1, ...alternatives.map((a) => a.surface)];

  return {
    surfaces,
    numericCores: buildNumericCores(input),
    nearMissTargets: buildNearMissTargets(input.customers),
    exactCustomerNames: new Set(
      input.customers.flatMap((c) => uniqueClean([c.name, ...c.aliases]).map(normalizeWords)).filter(Boolean),
    ),
    nearMissIgnore: new Set((input.nearMissIgnore ?? []).map(normalizeWords).filter(Boolean)),
    matcher,
    groupToSurface,
  };
}

function buildNumericCores(input: DictionaryInput): Map<string, NumericCore> {
  const stop = new Set<string>();
  for (const s of input.stoplistNumbers) for (const c of digitVariants(s)) stop.add(c);

  interface Rec {
    key: string;
    kind: "part" | "job" | "quote";
    id: string;
    classification: Classification;
  }
  const holders = new Map<string, Set<string>>();
  const records = new Map<string, Rec>();
  const register = (rec: Rec, number: string) => {
    records.set(rec.key, rec);
    for (const core of coresOf(number)) {
      let set = holders.get(core);
      if (!set) holders.set(core, (set = new Set()));
      set.add(rec.key);
    }
  };
  for (const r of input.parts)
    register({ key: `part:${r.id}`, kind: "part", id: r.id, classification: r.classification }, r.partNumber);
  for (const r of input.jobs)
    register({ key: `job:${r.id}`, kind: "job", id: r.id, classification: r.classification }, r.jobNumber);
  for (const r of input.quotes)
    register({ key: `quote:${r.id}`, kind: "quote", id: r.id, classification: r.classification }, r.quoteNumber);

  const cores = new Map<string, NumericCore>();
  for (const [core, set] of holders) {
    if (set.size !== 1 || stop.has(core)) continue;
    const rec = records.get([...set][0])!;
    if (rec.kind === "quote" || rec.classification !== "export_controlled") continue;
    cores.set(core, { core, recordKind: rec.kind, recordId: rec.id, classification: rec.classification });
  }
  return cores;
}

function buildNearMissTargets(customers: readonly CustomerInput[]): NearMissTarget[] {
  const targets: NearMissTarget[] = [];
  for (const c of customers) {
    if (c.partClassificationFloor !== "export_controlled") continue;
    for (const surface of uniqueClean([c.name, ...c.aliases])) {
      const normalized = normalizeWords(surface);
      if (codePointLength(normalized) < NEAR_MISS_MIN_LENGTH) continue;
      targets.push({
        customerId: c.id,
        surface,
        normalized,
        wordCount: normalized.split(" ").length,
        classification: c.partClassificationFloor,
      });
    }
  }
  return targets;
}

// ---------------------------------------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------------------------------------

/** All dictionary mentions in `text`, in order, non-overlapping (longest surface first, leftmost wins). */
export function detectEntities(text: string, dict: EntityDictionary): EntityMention[] {
  const s = text.normalize("NFC");
  const mentions: EntityMention[] = [];
  for (const m of s.matchAll(dict.matcher)) {
    let group = 1;
    while (group < m.length && m[group] === undefined) group++;
    const surfaceIndex = dict.groupToSurface[group] ?? -1;
    if (surfaceIndex < 0) continue; // stoplisted compound ("X-Ray"): consumed, not a mention
    const surface = dict.surfaces[surfaceIndex];
    const start = m.index ?? 0;
    const first = surface.candidates[0];
    const mention: EntityMention = {
      kind: surface.kind,
      id: first.id,
      surface: m[0],
      start,
      end: start + m[0].length,
      classification: surface.classification,
    };
    if (surface.form) mention.form = surface.form;
    if (surface.candidates.length > 1) mention.ambiguousIds = surface.candidates.map((c) => c.id);
    mentions.push(mention);
  }
  return mentions;
}

/** Max classification over the mentions in `text` (`general` when there are none). */
export function floorFromText(
  text: string,
  dict: EntityDictionary,
): { floor: Classification; mentions: EntityMention[] } {
  const mentions = detectEntities(text, dict);
  return { floor: maxClass(...mentions.map((m) => m.classification)), mentions };
}

/**
 * Deterministic suspicion signals (PLAN.md §4.2 P3 (1) and (2)). Exact dictionary hits are never signals —
 * the floor handles them — so digits inside an exact mention and exact customer names are skipped.
 *
 * - `numeric_core`: a standalone digit group (or hyphen-joined run of groups) equal to a numeric core of an
 *   export-controlled part or job ("the 4410 manifold" → GDS-4410-120; see {@link coresOf}). At most one
 *   signal per record per digit chain (the longest matching run).
 * - `near_miss_customer`: a word span at Levenshtein distance exactly 1 (case-insensitive) from a name or
 *   alias (≥ 7 characters) of a customer whose part floor is export_controlled ("Graymor" → Graymoor).
 *   Spans of the target's word count ±1 are compared, so "Gray moor" and "Graymor" both count. Overlapping
 *   hits for the same customer collapse to the longest span.
 */
export function suspicionSignals(text: string, dict: EntityDictionary): SuspicionSignal[] {
  const s = text.normalize("NFC");
  return signalsFor(s, detectEntities(s, dict), dict);
}

/** Mentions, floor and suspicion signals in one pass (what the P3 classifier needs). */
export function analyzeText(
  text: string,
  dict: EntityDictionary,
): { floor: Classification; mentions: EntityMention[]; signals: SuspicionSignal[] } {
  const s = text.normalize("NFC");
  const mentions = detectEntities(s, dict);
  const signals = signalsFor(s, mentions, dict);
  return { floor: maxClass(...mentions.map((m) => m.classification)), mentions, signals };
}

function signalsFor(s: string, mentions: readonly EntityMention[], dict: EntityDictionary): SuspicionSignal[] {
  return [...numericCoreSignals(s, mentions, dict), ...nearMissSignals(s, mentions, dict)].sort(
    (a, b) => a.start - b.start || a.end - b.end || cmp(a.kind, b.kind) || cmp(a.recordId, b.recordId),
  );
}

function numericCoreSignals(s: string, mentions: readonly EntityMention[], dict: EntityDictionary): SuspicionSignal[] {
  if (dict.numericCores.size === 0) return [];
  const signals: SuspicionSignal[] = [];
  for (const chain of s.matchAll(NUMERIC_CHAIN)) {
    const chainStart = chain.index ?? 0;
    const chainEnd = chainStart + chain[0].length;
    if (mentions.some((m) => m.start < chainEnd && chainStart < m.end)) continue;
    const groups = [...chain[0].matchAll(DIGIT_GROUP)].map((g) => ({
      text: g[0],
      start: chainStart + (g.index ?? 0),
      end: chainStart + (g.index ?? 0) + g[0].length,
    }));
    const best = new Map<string, SuspicionSignal>();
    for (let i = 0; i < groups.length; i++) {
      for (let j = i; j < groups.length; j++) {
        // One text group matches a single-group or concatenated core; a run of groups only matches a record
        // with the same group structure (so "2025-12-15" never matches a core "1215").
        const key = groups
          .slice(i, j + 1)
          .map((g) => g.text)
          .join("-");
        const hit = dict.numericCores.get(key);
        if (!hit) continue;
        const start = groups[i].start;
        const end = groups[j].end;
        const prev = best.get(hit.recordId);
        if (prev && prev.end - prev.start >= end - start) continue;
        best.set(hit.recordId, {
          kind: "numeric_core",
          recordId: hit.recordId,
          recordKind: hit.recordKind,
          surface: s.slice(start, end),
          start,
          end,
          classification: hit.classification,
        });
      }
    }
    signals.push(...best.values());
  }
  return signals;
}

function nearMissSignals(s: string, mentions: readonly EntityMention[], dict: EntityDictionary): SuspicionSignal[] {
  if (dict.nearMissTargets.length === 0) return [];
  const tokens = [...s.matchAll(WORD)].map((t) => ({
    lower: t[0].toLowerCase(),
    start: t.index ?? 0,
    end: (t.index ?? 0) + t[0].length,
  }));
  const candidates: SuspicionSignal[] = [];
  for (const target of dict.nearMissTargets) {
    const targetLength = codePointLength(target.normalized);
    for (let n = Math.max(1, target.wordCount - 1); n <= target.wordCount + 1; n++) {
      for (let i = 0; i + n <= tokens.length; i++) {
        let joined = tokens[i].lower;
        let contiguous = true;
        for (let k = i + 1; k < i + n; k++) {
          if (!TOKEN_GAP.test(s.slice(tokens[k - 1].end, tokens[k].start))) {
            contiguous = false;
            break;
          }
          joined += ` ${tokens[k].lower}`;
        }
        if (!contiguous) continue;
        if (Math.abs(codePointLength(joined) - targetLength) > 1) continue;
        if (dict.exactCustomerNames.has(joined) || dict.nearMissIgnore.has(joined)) continue;
        if (!isOneEditAway(joined, target.normalized)) continue;
        const start = tokens[i].start;
        const end = tokens[i + n - 1].end;
        const coveredByMentions = mentions.some((m) => m.start <= start && m.end >= end);
        const overlapsSameCustomer = mentions.some(
          (m) => m.kind === "customer" && m.id === target.customerId && m.start < end && start < m.end,
        );
        if (coveredByMentions || overlapsSameCustomer) continue;
        candidates.push({
          kind: "near_miss_customer",
          recordId: target.customerId,
          recordKind: "customer",
          surface: s.slice(start, end),
          start,
          end,
          classification: target.classification,
        });
      }
    }
  }
  // Collapse overlapping hits for the same customer to the longest span.
  candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const accepted: SuspicionSignal[] = [];
  for (const c of candidates) {
    const overlaps = accepted.some((a) => a.recordId === c.recordId && a.start < c.end && c.start < a.end);
    if (!overlaps) accepted.push(c);
  }
  return accepted;
}

// ---------------------------------------------------------------------------------------------------------
// Helpers (exported where tests or other policy modules benefit)
// ---------------------------------------------------------------------------------------------------------

/** True when `a` and `b` are exactly one insertion, deletion or substitution apart (code-point aware). */
export function isOneEditAway(a: string, b: string): boolean {
  const x = [...a];
  const y = [...b];
  if (Math.abs(x.length - y.length) > 1) return false;
  if (x.length === y.length) {
    let diff = 0;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i] && ++diff > 1) return false;
    return diff === 1;
  }
  const [shorter, longer] = x.length < y.length ? [x, y] : [y, x];
  let i = 0;
  while (i < shorter.length && shorter[i] === longer[i]) i++;
  for (let j = i; j < shorter.length; j++) if (shorter[j] !== longer[j + 1]) return false;
  return true;
}

/**
 * The numeric cores a number contributes before uniqueness and stoplist filtering: every digit group with
 * ≥ {@link NUMERIC_CORE_MIN_DIGITS} digits, plus, for every run of ≥ 2 consecutive digit groups reaching that
 * many digits, its hyphen-joined form and its concatenation ("GDS-4410-120" → "4410", "4410-120",
 * "4410120"; "RJ-26-0310" → "26-0310", "260310", "0310"). A hyphen-joined core only matches text with the
 * same group structure; a concatenated core only matches a single digit group.
 */
export function coresOf(number: string): string[] {
  const groups = number.normalize("NFC").match(DIGIT_GROUP) ?? [];
  const out = new Set<string>();
  for (let i = 0; i < groups.length; i++) {
    for (let j = i; j < groups.length; j++) {
      const run = groups.slice(i, j + 1);
      const concatenated = run.join("");
      if (concatenated.length < NUMERIC_CORE_MIN_DIGITS) continue;
      if (run.length > 1) out.add(run.join("-"));
      out.add(concatenated);
    }
  }
  return [...out];
}

function digitVariants(value: string): string[] {
  const groups = value.normalize("NFC").match(DIGIT_GROUP) ?? [];
  return groups.length > 1 ? [...groups, groups.join("")] : groups;
}

/** NFC, trimmed, internal whitespace collapsed to single spaces. */
function clean(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}

function uniqueClean(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const c = clean(v);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Lower-cased words (letter/digit runs) joined by single spaces: the near-miss comparison form. */
function normalizeWords(value: string): string {
  return (value.normalize("NFC").toLowerCase().match(WORD) ?? []).join(" ");
}

/** Locale-independent string comparison (deterministic ordering on every platform). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function codePointLength(value: string): number {
  return [...value].length;
}

function capitalize(value: string): string {
  const [first = "", ...rest] = [...value];
  return first.toUpperCase() + rest.join("");
}

function escapeChar(ch: string): string {
  return /[.*+?^${}()|[\]\\/]/.test(ch) ? `\\${ch}` : ch;
}

/**
 * A regex source that matches `value` literally: spaces match any whitespace run, straight and curly
 * apostrophes are interchangeable, and letters match either case when `caseInsensitive`.
 */
function literal(value: string, caseInsensitive: boolean): string {
  let out = "";
  for (const ch of value) {
    if (ch === " ") {
      out += "\\s+";
    } else if (ch === "'" || ch === "’") {
      out += "['’]";
    } else if (caseInsensitive && isCaseable(ch)) {
      out += `[${ch.toLowerCase()}${ch.toUpperCase()}]`;
    } else {
      out += escapeChar(ch);
    }
  }
  return out;
}

function isCaseable(ch: string): boolean {
  const lo = ch.toLowerCase();
  const up = ch.toUpperCase();
  return lo !== up && codePointLength(lo) === 1 && codePointLength(up) === 1;
}

/** Separator-optional pattern for a part/job/quote number, or null when it has no letters or digits. */
function numberPattern(number: string, allowRevision: boolean): string | null {
  const groups = number.match(LETTER_OR_DIGIT_RUN);
  if (!groups || groups.length === 0) return null;
  return groups.map((g) => literal(g, true)).join(NUMBER_SEP) + (allowRevision ? REVISION_SUFFIX : "");
}
