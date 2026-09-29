/**
 * Knowledge Library data (PLAN.md §8.3): the card list with facets, FTS search over `cards_fts`, and the card page.
 *
 * Pure and synchronous (better-sqlite3), no Next.js imports, so Vitest and tsx can run it (docs/DATA-LAYER.md).
 * Server wrappers live in src/server/queries/cards.ts; the search Server Action is src/app/actions/library.ts.
 *
 * Role rules (PLAN.md §4.8): cards carry no gated field (no prices, contacts, win/loss or departure data), and every
 * persona may open every card in this demo, export-controlled ones included (the card page shows the banner).
 * Linked jobs and quotes are shown by number only; `quote_financials` and `customer_accounts` are never queried here.
 * The actor is still passed so rows can say which cards are the viewer's own.
 *
 * View models are plain serializable data; dates stay `YYYY-MM-DD` and are formatted at render time.
 * Hidden manual-entry sessions (`INT-M-*`) are provenance only: their IDs never appear in a view model.
 */
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "@/db/client";
import {
  CARD_STATUSES,
  CARD_TYPES,
  CLASSIFICATIONS,
  cardEvidence,
  cardLinks,
  cardTags,
  cardTopics,
  customers,
  interviewTurns,
  interviews,
  jobs,
  knowledgeCards,
  machines,
  materials,
  parts,
  people,
  quotes,
  tags,
  topics,
  type CardStatus,
  type CardType,
  type Classification,
  type Confidence,
  type LinkKind,
  type Threshold,
} from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import { CARD_STATUS_LABEL, CARD_TYPE_LABEL } from "@/lib/card-labels";
import { CLASSIFICATION_LABEL } from "@/lib/classification-labels";
import { buildSearchSynonymIndex } from "@/lib/data/search";
import { toFtsQuery } from "@/lib/retrieval/fts-query";

/** The actor argument every data function takes (an `Actor` from src/server/actor.ts satisfies it). */
export interface LibraryActor {
  role: Role;
  personId: string | null;
}

// ---------------------------------------------------------------------------------------------------------------
// Labels (computed into view models so Client Components never import this module at runtime)
// ---------------------------------------------------------------------------------------------------------------

export { CARD_STATUS_LABEL, CARD_TYPE_LABEL };

export const CONFIDENCE_LABEL: Readonly<Record<Confidence, string>> = {
  always: "Always",
  usually: "Usually",
  sometimes: "Sometimes",
  not_sure: "Not sure",
  not_stated: "Not stated",
};

/** Default list order: approved first, then pending review, draft, rejected, superseded. */
export const LIBRARY_STATUS_ORDER: readonly CardStatus[] = ["approved", "pending_review", "draft", "rejected", "superseded"];

/** The label on evidence from a hidden manual-entry session (never linked). */
export const MANUAL_ENTRY_LABEL = "Entered by hand (binder/manual entry)";

/** "Draft — awaiting Maya Chen" style status line; approved/rejected/superseded carry just the word. */
export function cardStatusLine(status: CardStatus, contributorName: string): string {
  if (status === "draft" || status === "pending_review") return `${CARD_STATUS_LABEL[status]} — awaiting ${contributorName}`;
  return CARD_STATUS_LABEL[status];
}

// ---------------------------------------------------------------------------------------------------------------
// Facets (URL searchParams: they are not free text)
// ---------------------------------------------------------------------------------------------------------------

/** Facet keys, in the order they appear in the filter bar and in URLs. `person` = contributor. */
export const LIBRARY_FACET_KEYS = ["type", "status", "person", "topic", "machine", "material", "customer", "classification"] as const;
export type LibraryFacetKey = (typeof LIBRARY_FACET_KEYS)[number];

export interface LibraryFacets {
  type?: CardType;
  status?: CardStatus;
  person?: string;
  topic?: string;
  machine?: string;
  material?: string;
  customer?: string;
  classification?: Classification;
}

const FACET_LABEL: Readonly<Record<LibraryFacetKey, string>> = {
  type: "Type",
  status: "Status",
  person: "Contributor",
  topic: "Topic",
  machine: "Machine",
  material: "Material",
  customer: "Customer",
  classification: "Classification",
};

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,39}$/;

function firstString(v: unknown): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t === "" ? null : t;
}

function isOneOf<T extends string>(list: readonly T[], v: string): v is T {
  return (list as readonly string[]).includes(v);
}

/**
 * Validates the shape of raw facet values (searchParams or FormData entries). Enum facets must be a known value;
 * ID facets must look like an ID. Anything else is dropped (never echoed). Existence is checked by
 * {@link resolveLibraryFacets}.
 */
export function parseLibraryFacets(raw: Readonly<Record<string, unknown>>): LibraryFacets {
  const out: LibraryFacets = {};
  const type = firstString(raw.type);
  if (type && isOneOf(CARD_TYPES, type)) out.type = type;
  const status = firstString(raw.status);
  if (status && isOneOf(CARD_STATUSES, status)) out.status = status;
  const classification = firstString(raw.classification);
  if (classification && isOneOf(CLASSIFICATIONS, classification)) out.classification = classification;
  for (const key of ["person", "topic", "machine", "material", "customer"] as const) {
    const v = firstString(raw[key]);
    if (v && ID_RE.test(v)) out[key] = v;
  }
  return out;
}

/** {@link parseLibraryFacets}, then drops IDs that don't exist, so an unknown value never filters silently. */
export function resolveLibraryFacets(db: Db, raw: Readonly<Record<string, unknown>>): LibraryFacets {
  const f = parseLibraryFacets(raw);
  if (f.person && !db.select({ id: people.id }).from(people).where(eq(people.id, f.person)).get()) delete f.person;
  if (f.topic && !db.select({ id: topics.id }).from(topics).where(eq(topics.id, f.topic)).get()) delete f.topic;
  if (f.machine && !db.select({ id: machines.id }).from(machines).where(eq(machines.id, f.machine)).get()) delete f.machine;
  if (f.material && !db.select({ id: materials.id }).from(materials).where(eq(materials.id, f.material)).get()) delete f.material;
  if (f.customer && !db.select({ id: customers.id }).from(customers).where(eq(customers.id, f.customer)).get()) delete f.customer;
  return f;
}

/** Canonical `key=value&…` string (fixed key order) — the URL query for these facets and a stable comparison key. */
export function libraryFacetsQuery(f: LibraryFacets): string {
  const params = new URLSearchParams();
  for (const key of LIBRARY_FACET_KEYS) {
    const v = f[key];
    if (v) params.set(key, v);
  }
  return params.toString();
}

/** `/library` plus the facet query. */
export function libraryHref(f: LibraryFacets): string {
  const q = libraryFacetsQuery(f);
  return q ? `/library?${q}` : "/library";
}

/**
 * SQL conditions for the facets. Entity facets match a direct link, a topic filed under that entity, or (material and
 * customer) the part/customer behind a linked job, quote or part — so "Customer: Graymoor" also finds a card linked
 * only to a Graymoor job.
 */
function facetConditions(f: LibraryFacets): SQL[] {
  const kc = knowledgeCards.id;
  const c: SQL[] = [];
  if (f.type) c.push(eq(knowledgeCards.type, f.type));
  if (f.status) c.push(eq(knowledgeCards.status, f.status));
  if (f.classification) c.push(eq(knowledgeCards.classification, f.classification));
  if (f.person) c.push(eq(knowledgeCards.sourcePersonId, f.person));
  if (f.topic) c.push(sql`exists (select 1 from card_topics ct where ct.card_id = ${kc} and ct.topic_id = ${f.topic})`);
  if (f.machine) {
    c.push(sql`(exists (select 1 from card_links cl where cl.card_id = ${kc} and cl.machine_id = ${f.machine})
      or exists (select 1 from card_topics ct join topics t on t.id = ct.topic_id where ct.card_id = ${kc} and t.machine_id = ${f.machine}))`);
  }
  if (f.material) {
    c.push(sql`(exists (select 1 from card_links cl
        left join jobs j on j.id = cl.job_id
        left join quotes q on q.id = cl.quote_id
        left join parts p on p.id = coalesce(cl.part_id, j.part_id, q.part_id)
        where cl.card_id = ${kc} and (cl.material_id = ${f.material} or p.material_id = ${f.material}))
      or exists (select 1 from card_topics ct join topics t on t.id = ct.topic_id where ct.card_id = ${kc} and t.material_id = ${f.material}))`);
  }
  if (f.customer) {
    c.push(sql`(exists (select 1 from card_links cl
        left join jobs j on j.id = cl.job_id
        left join quotes q on q.id = coalesce(cl.quote_id, j.quote_id)
        left join parts p on p.id = coalesce(cl.part_id, j.part_id, q.part_id)
        where cl.card_id = ${kc} and (cl.customer_id = ${f.customer} or q.customer_id = ${f.customer} or p.customer_id = ${f.customer}))
      or exists (select 1 from card_topics ct join topics t on t.id = ct.topic_id where ct.card_id = ${kc} and t.customer_id = ${f.customer}))`);
  }
  return c;
}

export interface FacetOptionVM {
  value: string;
  label: string;
}

export interface FacetGroupVM {
  key: LibraryFacetKey;
  label: string;
  options: FacetOptionVM[];
  /** The applied value, or null. */
  selected: string | null;
}

export interface ActiveFilterVM {
  key: LibraryFacetKey;
  label: string;
  valueLabel: string;
  /** The library URL with this one filter removed. */
  removeHref: string;
}

/** Facet options (same for every role: names and labels only). */
function facetGroups(db: Db, f: LibraryFacets): FacetGroupVM[] {
  const presentStatuses = new Set(
    db.selectDistinct({ status: knowledgeCards.status }).from(knowledgeCards).all().map((r) => r.status),
  );
  const contributors = db
    .select({ value: people.id, label: people.fullName })
    .from(people)
    .where(sql`exists (select 1 from knowledge_cards k where k.source_person_id = ${people.id})`)
    .orderBy(asc(people.sortOrder), asc(people.id))
    .all();
  const options: Record<LibraryFacetKey, FacetOptionVM[]> = {
    type: CARD_TYPES.map((t) => ({ value: t, label: CARD_TYPE_LABEL[t] })),
    status: LIBRARY_STATUS_ORDER.filter((s) => presentStatuses.has(s) || f.status === s).map((s) => ({
      value: s,
      label: CARD_STATUS_LABEL[s],
    })),
    person: contributors,
    topic: db.select({ value: topics.id, label: topics.label }).from(topics).orderBy(asc(topics.sortOrder), asc(topics.id)).all(),
    machine: db.select({ value: machines.id, label: machines.name }).from(machines).orderBy(asc(machines.sortOrder), asc(machines.id)).all(),
    material: db
      .select({ value: materials.id, label: materials.name })
      .from(materials)
      .orderBy(asc(materials.sortOrder), asc(materials.id))
      .all(),
    customer: db
      .select({ value: customers.id, label: customers.name })
      .from(customers)
      .orderBy(asc(customers.sortOrder), asc(customers.id))
      .all(),
    classification: CLASSIFICATIONS.map((c) => ({ value: c, label: CLASSIFICATION_LABEL[c] })),
  };
  return LIBRARY_FACET_KEYS.map((key) => ({ key, label: FACET_LABEL[key], options: options[key], selected: f[key] ?? null }));
}

function activeFilters(groups: FacetGroupVM[], f: LibraryFacets): ActiveFilterVM[] {
  const out: ActiveFilterVM[] = [];
  for (const g of groups) {
    if (!g.selected) continue;
    const rest: LibraryFacets = { ...f };
    delete rest[g.key];
    out.push({
      key: g.key,
      label: g.label,
      valueLabel: g.options.find((o) => o.value === g.selected)?.label ?? g.selected,
      removeHref: libraryHref(rest),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// List rows
// ---------------------------------------------------------------------------------------------------------------

export interface TopicRefVM {
  id: string;
  label: string;
}

export interface CardRowVM {
  id: string;
  title: string;
  type: CardType;
  typeLabel: string;
  status: CardStatus;
  /** "Approved", or "Draft — awaiting Maya Chen" for cards still waiting on their contributor. */
  statusLabel: string;
  contributor: { id: string; name: string };
  confidence: Confidence;
  confidenceLabel: string;
  topics: TopicRefVM[];
  classification: Classification;
  /** The viewer is this card's contributor. */
  isMine: boolean;
}

interface RowBase {
  id: string;
  title: string;
  type: CardType;
  status: CardStatus;
  classification: Classification;
  expertConfidence: Confidence;
  sourcePersonId: string;
  contributorName: string;
}

function selectRows(db: Db, where: SQL | undefined): RowBase[] {
  return db
    .select({
      id: knowledgeCards.id,
      title: knowledgeCards.title,
      type: knowledgeCards.type,
      status: knowledgeCards.status,
      classification: knowledgeCards.classification,
      expertConfidence: knowledgeCards.expertConfidence,
      sourcePersonId: knowledgeCards.sourcePersonId,
      contributorName: people.fullName,
    })
    .from(knowledgeCards)
    .innerJoin(people, eq(people.id, knowledgeCards.sourcePersonId))
    .where(where)
    .all();
}

function topicsByCard(db: Db, ids: string[]): Map<string, TopicRefVM[]> {
  const map = new Map<string, TopicRefVM[]>();
  if (ids.length === 0) return map;
  const rows = db
    .select({ cardId: cardTopics.cardId, id: topics.id, label: topics.label })
    .from(cardTopics)
    .innerJoin(topics, eq(topics.id, cardTopics.topicId))
    .where(inArray(cardTopics.cardId, ids))
    .orderBy(asc(topics.sortOrder), asc(topics.id))
    .all();
  for (const r of rows) {
    const list = map.get(r.cardId) ?? [];
    list.push({ id: r.id, label: r.label });
    map.set(r.cardId, list);
  }
  return map;
}

function toRows(db: Db, actor: LibraryActor, base: RowBase[]): CardRowVM[] {
  const topicMap = topicsByCard(
    db,
    base.map((r) => r.id),
  );
  return base.map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    typeLabel: CARD_TYPE_LABEL[r.type],
    status: r.status,
    statusLabel: cardStatusLine(r.status, r.contributorName),
    contributor: { id: r.sourcePersonId, name: r.contributorName },
    confidence: r.expertConfidence,
    confidenceLabel: CONFIDENCE_LABEL[r.expertConfidence],
    topics: topicMap.get(r.id) ?? [],
    classification: r.classification,
    isMine: actor.personId !== null && actor.personId === r.sourcePersonId,
  }));
}

const statusRank = (s: CardStatus) => LIBRARY_STATUS_ORDER.indexOf(s);
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Cards matching the facets, approved first, then pending review, draft, rejected, superseded; by ID within a status. */
export function listCards(db: Db, actor: LibraryActor, facets: LibraryFacets = {}): CardRowVM[] {
  const conds = facetConditions(facets);
  const base = selectRows(db, conds.length ? and(...conds) : undefined);
  base.sort((a, b) => statusRank(a.status) - statusRank(b.status) || byId(a.id, b.id));
  return toRows(db, actor, base);
}

// ---------------------------------------------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------------------------------------------

/** Upper bound on search text (the Server Action rejects longer input before calling in). */
export const LIBRARY_QUERY_MAX = 200;
/** FTS hits considered (the library has ~100 cards; this only bounds a pathological index). */
const SEARCH_HIT_LIMIT = 500;

export interface CardSearchResult {
  /** false when the text had no searchable word (empty, stopwords only): `rows` is then the default list. */
  searched: boolean;
  rows: CardRowVM[];
}

/**
 * Full-text search over `cards_fts`. User text goes through `toFtsQuery()` (sanitized, stopwords dropped, synonyms
 * from `buildSearchSynonymIndex()`), ranked by `bm25(cards_fts, 0, 10, 1, 5)` (title 10, body 1, tags 5), then
 * narrowed by the facets. Ties keep the default status order.
 */
export function searchCards(db: Db, actor: LibraryActor, query: string, facets: LibraryFacets = {}): CardSearchResult {
  const text = query.slice(0, LIBRARY_QUERY_MAX);
  const match = toFtsQuery(text, { synonyms: buildSearchSynonymIndex(db) });
  if (match === null) return { searched: false, rows: listCards(db, actor, facets) };

  const hits = db.all<{ card_id: string; rank: number }>(
    sql`select card_id, bm25(cards_fts, 0, 10, 1, 5) as rank from cards_fts where cards_fts match ${match} order by rank limit ${SEARCH_HIT_LIMIT}`,
  );
  if (hits.length === 0) return { searched: true, rows: [] };

  const rank = new Map<string, number>();
  hits.forEach((h, i) => {
    if (!rank.has(h.card_id)) rank.set(h.card_id, i);
  });
  const conds = [inArray(knowledgeCards.id, [...rank.keys()]), ...facetConditions(facets)];
  const base = selectRows(db, and(...conds));
  base.sort(
    (a, b) =>
      (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0) || statusRank(a.status) - statusRank(b.status) || byId(a.id, b.id),
  );
  return { searched: true, rows: toRows(db, actor, base) };
}

// ---------------------------------------------------------------------------------------------------------------
// The /library page
// ---------------------------------------------------------------------------------------------------------------

export interface LibraryPageVM {
  facets: LibraryFacets;
  /** Canonical facet query (`libraryFacetsQuery`), also the key the search form compares results against. */
  facetsKey: string;
  facetGroups: FacetGroupVM[];
  activeFilters: ActiveFilterVM[];
  rows: CardRowVM[];
  /** All cards in the library, ignoring facets. */
  totalCards: number;
}

/** Everything the list page renders, for raw searchParams. */
export function libraryPage(db: Db, actor: LibraryActor, rawFacets: Readonly<Record<string, unknown>>): LibraryPageVM {
  const facets = resolveLibraryFacets(db, rawFacets);
  const groups = facetGroups(db, facets);
  const total = db.select({ n: sql<number>`count(*)` }).from(knowledgeCards).get()?.n ?? 0;
  return {
    facets,
    facetsKey: libraryFacetsQuery(facets),
    facetGroups: groups,
    activeFilters: activeFilters(groups, facets),
    rows: listCards(db, actor, facets),
    totalCards: total,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------------------------------------------

const COMPARATOR_SYMBOL: Readonly<Record<Threshold["comparator"], string>> = {
  "<": "<",
  "<=": "≤",
  "=": "=",
  ">=": "≥",
  ">": ">",
  between: "",
  approx: "≈",
};

/** Plain decimal text without float noise: trims trailing zeros (0.0400 → "0.04"), never exponent notation. */
function plainNumber(n: number): string {
  const fixed = n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return fixed === "-0" ? "0" : fixed;
}

/** Inches under 1 read in thousandths (0.04 → "0.040", 0.0004 → "0.0004"); everything else is trimmed. */
function formatThresholdNumber(n: number, unit: string | null): string {
  const plain = plainNumber(n);
  if (unit !== "in" || Math.abs(n) >= 1) return plain;
  const decimals = plain.includes(".") ? plain.split(".")[1]!.length : 0;
  return decimals >= 3 ? plain : n.toFixed(3);
}

function withUnit(value: string, unit: string | null): string {
  if (!unit) return value;
  if (unit === "x") return `${value}×`;
  return `${value} ${unit}`;
}

/**
 * The normalized form shown next to the expert's words: "under forty thou" → "< 0.040 in",
 * "about three hours" → "≈ 3 h", "about ten times the wall" → "> 10×". Null when the threshold has no value.
 */
export function formatThreshold(t: Pick<Threshold, "comparator" | "value" | "value_max" | "unit">): string | null {
  if (t.value === null || !Number.isFinite(t.value)) return null;
  const lo = formatThresholdNumber(t.value, t.unit);
  if (t.comparator === "between") {
    if (t.value_max === null || !Number.isFinite(t.value_max)) return withUnit(lo, t.unit);
    return withUnit(`${lo}–${formatThresholdNumber(t.value_max, t.unit)}`, t.unit);
  }
  return `${COMPARATOR_SYMBOL[t.comparator]} ${withUnit(lo, t.unit)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The card page
// ---------------------------------------------------------------------------------------------------------------

export interface ThresholdVM {
  quantity: string;
  /** The expert's words, verbatim. */
  verbatim: string;
  /** e.g. "< 0.040 in"; null when the threshold has no value. */
  normalized: string | null;
}

export type EvidenceSourceVM =
  | { kind: "interview"; interviewId: string; title: string; turnSeq: number; date: string }
  | { kind: "manual"; label: string; date: string };

export interface EvidenceVM {
  id: number;
  /** Exact substring of the turn. */
  quote: string;
  /** Stored span offsets into the turn text. */
  startChar: number;
  endChar: number;
  /** The whole turn split around the quoted span; null if the quote can't be located in the turn. */
  context: { before: string; match: string; after: string } | null;
  source: EvidenceSourceVM;
  /** This span is what supports the stated expert confidence. */
  supportsConfidence: boolean;
}

export interface CardLinkVM {
  kind: LinkKind;
  id: string;
  /** Job or quote number, part number + revision, or the name (the UI shows the kind next to it). */
  label: string;
  /** Secondary text (part description, asset tag, job title). */
  detail: string | null;
  /** App route for records with a page; null for parts, materials and customers (no page yet). */
  href: string | null;
  /** The linked record's own classification (jobs, quotes, parts, customers); null for reference entities. */
  classification: Classification | null;
  /** The expert's words that pointed at this record, when the link came from a mention. */
  mention: string | null;
}

export type TimelineEventVM =
  | { kind: "created"; date: string; text: string }
  | { kind: "approved"; date: string | null; text: string }
  | { kind: "awaiting"; text: string }
  | { kind: "rejected"; text: string; notes: string | null }
  | { kind: "superseded"; text: string };

export interface CardDetailVM {
  id: string;
  version: number;
  supersedesId: string | null;
  title: string;
  type: CardType;
  typeLabel: string;
  status: CardStatus;
  statusLabel: string;
  classification: Classification;
  /** Set when the classification was overridden (up or down) by hand, with its logged reason. */
  classificationOverride: { direction: "up" | "down"; reason: string | null } | null;
  statement: string;
  rationale: string | null;
  commonMistake: string | null;
  appliesWhen: string[];
  doesNotApplyWhen: string[];
  cues: string[];
  actions: string[];
  thresholds: ThresholdVM[];
  openQuestions: string[];
  confidence: Confidence;
  confidenceLabel: string;
  contributor: { id: string; name: string; jobTitle: string };
  isMine: boolean;
  timeline: TimelineEventVM[];
  topics: TopicRefVM[];
  tags: string[];
  evidence: EvidenceVM[];
  links: CardLinkVM[];
}

const LINK_ORDER: readonly LinkKind[] = ["customer", "quote", "job", "part", "machine", "material", "person"];

function sourceSentence(sourceKind: string): string {
  switch (sourceKind) {
    case "interview":
      return "Captured in an interview";
    case "quote_log":
      return "Captured in a Quote Reasoning Log";
    case "seed_binder":
      return "Entered by hand from the binder";
    default:
      return "Entered by hand";
  }
}

function locate(text: string, quote: string, start: number, end: number): EvidenceVM["context"] {
  let s = start;
  let e = end;
  if (!(s >= 0 && e <= text.length && s < e && text.slice(s, e) === quote)) {
    s = quote ? text.indexOf(quote) : -1;
    if (s < 0) return null;
    e = s + quote.length;
  }
  return { before: text.slice(0, s), match: text.slice(s, e), after: text.slice(e) };
}

function loadEvidence(db: Db, cardId: string): EvidenceVM[] {
  const rows = db
    .select({
      id: cardEvidence.id,
      quote: cardEvidence.quote,
      startChar: cardEvidence.startChar,
      endChar: cardEvidence.endChar,
      confidenceEvidence: cardEvidence.confidenceEvidence,
      turnText: interviewTurns.text,
      turnSeq: interviewTurns.seq,
      turnCreatedAt: interviewTurns.createdAt,
      interviewId: interviews.id,
      interviewTitle: interviews.title,
      interviewMode: interviews.mode,
      interviewHidden: interviews.isHidden,
    })
    .from(cardEvidence)
    .innerJoin(interviewTurns, eq(interviewTurns.id, cardEvidence.turnId))
    .innerJoin(interviews, eq(interviews.id, interviewTurns.interviewId))
    .where(eq(cardEvidence.cardId, cardId))
    .orderBy(asc(cardEvidence.id))
    .all();
  return rows.map((r) => {
    const date = r.turnCreatedAt.slice(0, 10);
    const manual = r.interviewHidden || r.interviewMode === "manual_entry";
    const source: EvidenceSourceVM = manual
      ? { kind: "manual", label: MANUAL_ENTRY_LABEL, date }
      : { kind: "interview", interviewId: r.interviewId, title: r.interviewTitle, turnSeq: r.turnSeq, date };
    return {
      id: r.id,
      quote: r.quote,
      startChar: r.startChar,
      endChar: r.endChar,
      context: locate(r.turnText, r.quote, r.startChar, r.endChar),
      source,
      supportsConfidence: r.confidenceEvidence,
    };
  });
}

function loadLinks(db: Db, cardId: string): CardLinkVM[] {
  const rows = db.select().from(cardLinks).where(eq(cardLinks.cardId, cardId)).orderBy(asc(cardLinks.id)).all();
  const ids = (pick: (r: (typeof rows)[number]) => string | null) =>
    [...new Set(rows.map(pick).filter((v): v is string => v !== null))];

  const jobIds = ids((r) => r.jobId);
  const quoteIds = ids((r) => r.quoteId);
  const partIds = ids((r) => r.partId);
  const machineIds = ids((r) => r.machineId);
  const materialIds = ids((r) => r.materialId);
  const customerIds = ids((r) => r.customerId);
  const personIds = ids((r) => r.personId);

  const jobPart = alias(parts, "job_part");
  const quotePart = alias(parts, "quote_part");
  const jobMap = new Map(
    (jobIds.length
      ? db
          .select({ id: jobs.id, number: jobs.jobNumber, classification: jobs.classification, pn: jobPart.partNumber, desc: jobPart.description })
          .from(jobs)
          .innerJoin(jobPart, eq(jobPart.id, jobs.partId))
          .where(inArray(jobs.id, jobIds))
          .all()
      : []
    ).map((r) => [r.id, r]),
  );
  const quoteMap = new Map(
    (quoteIds.length
      ? db
          .select({ id: quotes.id, number: quotes.quoteNumber, classification: quotes.classification, pn: quotePart.partNumber, desc: quotePart.description })
          .from(quotes)
          .innerJoin(quotePart, eq(quotePart.id, quotes.partId))
          .where(inArray(quotes.id, quoteIds))
          .all()
      : []
    ).map((r) => [r.id, r]),
  );
  const partMap = new Map(
    (partIds.length
      ? db
          .select({ id: parts.id, pn: parts.partNumber, rev: parts.revision, desc: parts.description, classification: parts.classification })
          .from(parts)
          .where(inArray(parts.id, partIds))
          .all()
      : []
    ).map((r) => [r.id, r]),
  );
  const machineMap = new Map(
    (machineIds.length
      ? db.select({ id: machines.id, name: machines.name, tag: machines.assetTag }).from(machines).where(inArray(machines.id, machineIds)).all()
      : []
    ).map((r) => [r.id, r]),
  );
  const materialMap = new Map(
    (materialIds.length
      ? db.select({ id: materials.id, name: materials.name }).from(materials).where(inArray(materials.id, materialIds)).all()
      : []
    ).map((r) => [r.id, r]),
  );
  // Customer names only: customer_accounts (contacts, terms) is never read here.
  const customerMap = new Map(
    (customerIds.length
      ? db
          .select({ id: customers.id, name: customers.name, classification: customers.classification })
          .from(customers)
          .where(inArray(customers.id, customerIds))
          .all()
      : []
    ).map((r) => [r.id, r]),
  );
  const personMap = new Map(
    (personIds.length
      ? db.select({ id: people.id, name: people.fullName, title: people.jobTitle }).from(people).where(inArray(people.id, personIds)).all()
      : []
    ).map((r) => [r.id, r]),
  );

  const out: CardLinkVM[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    let vm: CardLinkVM | null = null;
    const base = { mention: r.mention };
    if (r.kind === "job" && r.jobId) {
      const j = jobMap.get(r.jobId);
      if (j) vm = { ...base, kind: "job", id: j.id, label: j.number, detail: `${j.pn} · ${j.desc}`, href: `/jobs/${j.id}`, classification: j.classification };
    } else if (r.kind === "quote" && r.quoteId) {
      const q = quoteMap.get(r.quoteId);
      if (q) vm = { ...base, kind: "quote", id: q.id, label: q.number, detail: `${q.pn} · ${q.desc}`, href: `/jobs/${q.id}`, classification: q.classification };
    } else if (r.kind === "part" && r.partId) {
      const p = partMap.get(r.partId);
      if (p) vm = { ...base, kind: "part", id: p.id, label: `${p.pn} rev ${p.rev}`, detail: p.desc, href: null, classification: p.classification };
    } else if (r.kind === "machine" && r.machineId) {
      const m = machineMap.get(r.machineId);
      if (m) vm = { ...base, kind: "machine", id: m.id, label: m.name, detail: m.tag, href: `/machines/${m.id}`, classification: null };
    } else if (r.kind === "material" && r.materialId) {
      const m = materialMap.get(r.materialId);
      if (m) vm = { ...base, kind: "material", id: m.id, label: m.name, detail: null, href: null, classification: null };
    } else if (r.kind === "customer" && r.customerId) {
      const c = customerMap.get(r.customerId);
      if (c) vm = { ...base, kind: "customer", id: c.id, label: c.name, detail: null, href: null, classification: c.classification };
    } else if (r.kind === "person" && r.personId) {
      const p = personMap.get(r.personId);
      if (p) vm = { ...base, kind: "person", id: p.id, label: p.name, detail: p.title, href: `/people/${p.id}`, classification: null };
    }
    if (vm && !seen.has(`${vm.kind}:${vm.id}`)) {
      seen.add(`${vm.kind}:${vm.id}`);
      out.push(vm);
    }
  }
  return out.sort((a, b) => LINK_ORDER.indexOf(a.kind) - LINK_ORDER.indexOf(b.kind));
}

/** The card page view model, or null for an unknown ID. */
export function cardDetail(db: Db, actor: LibraryActor, id: string): CardDetailVM | null {
  if (typeof id !== "string" || !ID_RE.test(id)) return null;
  const approver = alias(people, "approver");
  const row = db
    .select({
      card: knowledgeCards,
      contributorName: people.fullName,
      contributorTitle: people.jobTitle,
      approverName: approver.fullName,
    })
    .from(knowledgeCards)
    .innerJoin(people, eq(people.id, knowledgeCards.sourcePersonId))
    .leftJoin(approver, eq(approver.id, knowledgeCards.approvedByPersonId))
    .where(eq(knowledgeCards.id, id))
    .get();
  if (!row) return null;
  const c = row.card;

  const timeline: TimelineEventVM[] = [{ kind: "created", date: c.createdOn, text: sourceSentence(c.sourceKind) }];
  if (c.status === "approved" || c.status === "superseded") {
    if (c.approvedOn || c.approvedByPersonId) {
      const by = row.approverName ?? null;
      const text =
        c.approvalMode === "on_behalf"
          ? `Approved on behalf of ${row.contributorName}${by ? ` by ${by}` : ""}`
          : `Approved by ${by ?? row.contributorName}`;
      timeline.push({ kind: "approved", date: c.approvedOn, text });
    }
    if (c.status === "superseded") timeline.push({ kind: "superseded", text: "Superseded by a newer version" });
  } else if (c.status === "draft" || c.status === "pending_review") {
    timeline.push({ kind: "awaiting", text: cardStatusLine(c.status, row.contributorName) });
  } else if (c.status === "rejected") {
    timeline.push({ kind: "rejected", text: "Rejected", notes: c.reviewNotes });
  }

  const cardTopicRows = topicsByCard(db, [c.id]).get(c.id) ?? [];
  const tagRows = db
    .select({ label: tags.label })
    .from(cardTags)
    .innerJoin(tags, eq(tags.id, cardTags.tagId))
    .where(eq(cardTags.cardId, c.id))
    .orderBy(asc(tags.id))
    .all();

  return {
    id: c.id,
    version: c.version,
    supersedesId: c.supersedesId,
    title: c.title,
    type: c.type,
    typeLabel: CARD_TYPE_LABEL[c.type],
    status: c.status,
    statusLabel: cardStatusLine(c.status, row.contributorName),
    classification: c.classification,
    classificationOverride:
      c.classificationSource === "derived"
        ? null
        : { direction: c.classificationSource === "override_up" ? "up" : "down", reason: c.classificationReason },
    statement: c.statement,
    rationale: c.rationale,
    commonMistake: c.commonMistake,
    appliesWhen: [...c.appliesWhen],
    doesNotApplyWhen: [...c.doesNotApplyWhen],
    cues: [...c.cues],
    actions: [...c.actions],
    thresholds: c.thresholds.map((t) => ({ quantity: t.quantity, verbatim: t.verbatim, normalized: formatThreshold(t) })),
    openQuestions: [...c.openQuestions],
    confidence: c.expertConfidence,
    confidenceLabel: CONFIDENCE_LABEL[c.expertConfidence],
    contributor: { id: c.sourcePersonId, name: row.contributorName, jobTitle: row.contributorTitle },
    isMine: actor.personId !== null && actor.personId === c.sourcePersonId,
    timeline,
    topics: cardTopicRows,
    tags: tagRows.map((t) => t.label),
    evidence: loadEvidence(db, c.id),
    links: loadLinks(db, c.id),
  };
}
