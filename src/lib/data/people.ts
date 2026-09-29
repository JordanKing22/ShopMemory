/**
 * People data (PLAN.md §9 `/people`, `/people/[id]`): the 8 knowledge holders, their tenure, planned departure
 * (role-gated), the topics they hold, their cards, the interviews they gave and their deep coverage.
 *
 * Pure and synchronous (better-sqlite3), no Next.js imports, so Vitest and tsx can run it (docs/DATA-LAYER.md).
 * Server wrappers live in src/server/queries/people.ts.
 *
 * Departure gate (PLAN.md §4.8, DATA-LAYER.md rule 4): the planned departure date is read because the risk score's
 * urgency factor U depends on it, but it leaves this module only through gated(actor.role, "departure", …). For
 * machinist and trainee the date, the kind ("retirement"), the months-to-departure and even the fact that no
 * departure is planned are absent from the view model. Lists are ordered by `people.sort_order`, never by departure.
 *
 * Coverage numbers come from the one computeCoverage() (PLAN.md §6) over the live database, so the profile's deep
 * coverage matches the Risk page (Ray: 18.2 % before demo step 2). Only approved cards count.
 *
 * Never selected here: quote_financials, customer_accounts, quotes.outcome / lost_reason (jobs and quotes appear as
 * counts only). Hidden manual-entry sessions (INT-M-*) are provenance only: their IDs never reach a view model, only
 * the number of cards entered by hand.
 */
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  cardTopics,
  interviews,
  jobs,
  knowledgeCards,
  people,
  personTopicExpertise,
  quotes,
  shopProfile,
  topics,
  type CardStatus,
  type CardType,
  type Classification,
  type DEPARTMENTS,
  type DEPARTURE_KINDS,
  type INTERVIEW_MODES,
  type TOPIC_CATEGORIES,
} from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import {
  computeCoverage,
  round1,
  type CellResult,
  type CoverageCard,
  type CoverageExpertise,
  type CoverageResult,
  type ExpertiseLevel,
  type RiskBand,
} from "@/lib/coverage/compute";
import { CARD_STATUS_LABEL, CARD_TYPE_LABEL } from "@/lib/card-labels";
import { gated, type Gated } from "@/lib/data/gate";
import { shortTopicLabel, tenureLabel } from "@/lib/data/risk";
import { monthsBetween } from "@/lib/time";

/** The actor argument every data function takes (an `Actor` from src/server/actor.ts satisfies it). */
export interface PeopleActor {
  role: Role;
  personId: string | null;
}

export type Department = (typeof DEPARTMENTS)[number];
export type DepartureKind = (typeof DEPARTURE_KINDS)[number];
export type InterviewMode = (typeof INTERVIEW_MODES)[number];
export type TopicCategory = (typeof TOPIC_CATEGORIES)[number];
export type HeldLevel = 1 | 2 | 3;

/** People, personas, machines and the shop profile are implicitly internal (PLAN.md §4.3). */
export const PERSON_CLASSIFICATION: Classification = "internal";

export const DEPARTMENT_LABEL: Readonly<Record<Department, string>> = {
  quoting: "Quoting",
  machining: "Machining",
  quality: "Quality",
  programming: "Programming",
  management: "Management",
};

export const TOPIC_CATEGORY_LABEL: Readonly<Record<TopicCategory, string>> = {
  process: "Process",
  machine: "Machine",
  material: "Material",
  customer: "Customer",
};

/** PLAN.md §6: 1 working · 2 independent, can teach basics · 3 deep, the go-to person. */
export const LEVEL_LABEL: Readonly<Record<HeldLevel, string>> = {
  3: "Deep: the go-to person",
  2: "Independent: can teach the basics",
  1: "Working knowledge",
};

export const INTERVIEW_MODE_LABEL: Readonly<Record<InterviewMode, string>> = {
  full_interview: "Interview",
  quote_reasoning_log: "Quote Reasoning Log",
  manual_entry: "Manual entry",
};

/** Card status labels and order on the profile (same words as the Knowledge Library). */
export const PERSON_CARD_STATUS_LABEL: Readonly<Record<CardStatus, string>> = CARD_STATUS_LABEL;
export const PERSON_CARD_STATUS_ORDER: readonly CardStatus[] = ["approved", "pending_review", "draft", "rejected", "superseded"];

export { CARD_TYPE_LABEL };

// ---------------------------------------------------------------------------------------------------------------
// View models
// ---------------------------------------------------------------------------------------------------------------

/** A planned departure. Only ever inside a Gated<> (owner/quoter). */
export interface PersonDeparture {
  /** YYYY-MM-DD. */
  date: string;
  /** Whole months from demo "today" (the one monthsBetween()). */
  months: number;
  kind: DepartureKind;
}

export interface PersonTopRiskVM {
  topicId: string;
  topicLabel: string;
  /** Label without a trailing parenthetical: "Titanium (Ti-6Al-4V)" → "Titanium". */
  topicShortLabel: string;
  risk: number;
  band: RiskBand;
  spof: boolean;
}

export interface PersonRowVM {
  id: string;
  fullName: string;
  firstName: string;
  jobTitle: string;
  department: Department;
  departmentLabel: string;
  classification: Classification;
  /** "31 yrs", or "8 mo" under a year. */
  tenureLabel: string;
  /** "31 years" / "8 months" (accessible name for the short label). */
  tenureLongLabel: string;
  /** Owner/quoter: the departure or null when none is planned. Machinist/trainee: hidden, always. */
  departure: Gated<PersonDeparture | null>;
  /** Topics where E = 3. */
  deepTopicCount: number;
  /** Captured share over the E = 3 topics, 0..100 with one decimal; null without a level-3 topic. */
  deepCoveragePct: number | null;
  approvedCardCount: number;
  /** The person's highest-risk cell (risk is visible to every role); null when they hold no topic. */
  topRisk: PersonTopRiskVM | null;
  /** The viewer is this person. */
  isMe: boolean;
}

export interface PeopleListVM {
  demoToday: string;
  /** Knowledge holders by people.sort_order (never by departure). */
  people: PersonRowVM[];
}

export interface PersonTopicVM {
  topicId: string;
  label: string;
  shortLabel: string;
  category: TopicCategory;
  categoryLabel: string;
  level: HeldLevel;
  /** f(p,t) × 100, one decimal. */
  capturedPct: number;
  risk: number;
  band: RiskBand;
  spof: boolean;
  approvedCardCount: number;
  /** Draft and pending-review cards (never counted in the score). */
  pendingCardCount: number;
  /** /library filtered to this person's cards on this topic. */
  libraryHref: string;
}

export interface PersonTopicGroupVM {
  level: HeldLevel;
  label: string;
  /** Highest risk first, ties by topic order. */
  topics: PersonTopicVM[];
}

export interface PersonCardVM {
  id: string;
  title: string;
  type: CardType;
  typeLabel: string;
  status: CardStatus;
  classification: Classification;
  topicLabels: string[];
  /** Demo-clock approval date (YYYY-MM-DD) for approved cards, else null. */
  approvedOn: string | null;
}

export interface PersonCardGroupVM {
  status: CardStatus;
  label: string;
  cards: PersonCardVM[];
}

export interface PersonInterviewVM {
  id: string;
  title: string;
  mode: InterviewMode;
  modeLabel: string;
  /** YYYY-MM-DD. */
  date: string;
  classification: Classification;
  topicLabel: string | null;
  /** Cards drawn from this session (any status). */
  cardCount: number;
}

export interface PersonProfileVM {
  id: string;
  fullName: string;
  firstName: string;
  jobTitle: string;
  department: Department;
  departmentLabel: string;
  classification: Classification;
  tenureLabel: string;
  tenureLongLabel: string;
  /** YYYY-MM-DD. */
  hireDate: string;
  priorExperienceYears: number;
  departure: Gated<PersonDeparture | null>;
  /** people.bio_md as plain text, with the shop's name marked "(fictional)". */
  bio: string | null;
  isMe: boolean;
  demoToday: string;
  /** Level 3 → 1; groups with no topics are omitted. */
  topicGroups: PersonTopicGroupVM[];
  coverage: {
    deepCoveragePct: number | null;
    /** Captured share over every topic the person holds (E > 0). */
    capturedPct: number | null;
    deepTopicCount: number;
    topicCount: number;
    approvedCardCount: number;
    /** Draft + pending review. */
    pendingCardCount: number;
  };
  topRisk: PersonTopRiskVM | null;
  /** Approved, pending review, draft, rejected, superseded; empty groups omitted. */
  cardGroups: PersonCardGroupVM[];
  /** Visible sessions the person gave, newest first (hidden manual-entry sessions excluded). */
  interviews: PersonInterviewVM[];
  /** Cards whose provenance is a hidden manual-entry session (binder or manual entry). */
  handEnteredCardCount: number;
  work: {
    jobsLed: number;
    quotesPrepared: number;
    /** /jobs filtered by this person (searchParams: an ID, not free text). */
    jobsHref: string;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------

/** "Titanium (Ti-6Al-4V)" → "Titanium"; labels without a trailing parenthetical are unchanged. */
export { shortTopicLabel };

/**
 * Tenure: short "31 yrs" (the same words as the Risk map's column headers) / long "31 years" at a year or more,
 * otherwise "8 mo" / "8 months". Uses the one monthsBetween().
 */
export function tenureLabels(hireDate: string, demoToday: string): { short: string; long: string } {
  const months = Math.max(0, monthsBetween(hireDate, demoToday));
  const short = tenureLabel(hireDate, demoToday);
  if (months < 12) return { short, long: `${months} ${months === 1 ? "month" : "months"}` };
  const years = Math.floor(months / 12);
  return { short, long: `${years} ${years === 1 ? "year" : "years"}` };
}

/** People IDs look like PER-01; anything else is not a person (never echoed, never queried). */
const PERSON_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,39}$/;

export function peopleJobsHref(personId: string): string {
  return `/jobs?person=${encodeURIComponent(personId)}`;
}

export function peopleLibraryHref(personId: string, topicId?: string): string {
  const params = new URLSearchParams({ person: personId });
  if (topicId) params.set("topic", topicId);
  return `/library?${params.toString()}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Marks the first mention of the shop's name in seed prose with "(fictional)" (CLAUDE.md hard rule 10: the
 * brief-mandated shop name collides with real businesses). Matches the full name or its first word, e.g.
 * "31 years at Ridgeline." → "31 years at Ridgeline (fictional)."; text that already says "(fictional)" is left alone.
 */
export function markShopNameFictional(text: string, shopName: string): string {
  const full = shopName.trim();
  if (!full || text.includes("(fictional)")) return text;
  const first = full.split(/\s+/)[0] ?? full;
  const names = first.length >= 4 && first !== full ? [full, first] : [full];
  const re = new RegExp(`\\b(?:${names.map(escapeRegExp).join("|")})\\b`);
  return text.replace(re, (m) => `${m} (fictional)`);
}

function toLevel(n: number): HeldLevel {
  return (n >= 3 ? 3 : n <= 1 ? 1 : 2) as HeldLevel;
}

interface HolderRow {
  id: string;
  fullName: string;
  displayName: string;
  jobTitle: string;
  department: Department;
  hireDate: string;
  priorExperienceYears: number;
  plannedDepartureDate: string | null;
  departureKind: DepartureKind | null;
  bioMd: string | null;
}

interface TopicRow {
  id: string;
  label: string;
  category: TopicCategory;
  sortOrder: number;
}

interface CardRow {
  id: string;
  title: string;
  type: CardType;
  status: CardStatus;
  confidence: CoverageCard["confidence"];
  sourcePersonId: string;
  classification: Classification;
  approvedOn: string | null;
}

interface Loaded {
  demoToday: string;
  shopName: string;
  holders: HolderRow[];
  topicRows: TopicRow[];
  cardRows: CardRow[];
  topicsByCard: Map<string, string[]>;
  result: CoverageResult;
}

function shopOf(db: Db): { demoToday: string; name: string } {
  const shop = db.select({ demoToday: shopProfile.demoToday, name: shopProfile.name }).from(shopProfile).get();
  if (!shop) throw new Error("shop_profile is missing");
  return shop;
}

/** Everything coverage needs, for every holder (B and topic mass depend on the other holders' levels). */
function loadCoverage(db: Db): Loaded {
  const { demoToday, name: shopName } = shopOf(db);
  const holders: HolderRow[] = db
    .select({
      id: people.id,
      fullName: people.fullName,
      displayName: people.displayName,
      jobTitle: people.jobTitle,
      department: people.department,
      hireDate: people.hireDate,
      priorExperienceYears: people.priorExperienceYears,
      plannedDepartureDate: people.plannedDepartureDate,
      departureKind: people.departureKind,
      bioMd: people.bioMd,
    })
    .from(people)
    .where(eq(people.isKnowledgeHolder, true))
    .orderBy(asc(people.sortOrder), asc(people.id))
    .all();
  const holderIds = holders.map((h) => h.id);

  const topicRows: TopicRow[] = db
    .select({ id: topics.id, label: topics.label, category: topics.category, sortOrder: topics.sortOrder })
    .from(topics)
    .orderBy(asc(topics.sortOrder), asc(topics.id))
    .all();

  const expertise: CoverageExpertise[] =
    holderIds.length === 0
      ? []
      : db
          .select({ personId: personTopicExpertise.personId, topicId: personTopicExpertise.topicId, level: personTopicExpertise.tacitLevel })
          .from(personTopicExpertise)
          .where(inArray(personTopicExpertise.personId, holderIds))
          .all()
          .map((e) => ({ ...e, level: e.level as ExpertiseLevel }));

  const cardRows: CardRow[] = db
    .select({
      id: knowledgeCards.id,
      title: knowledgeCards.title,
      type: knowledgeCards.type,
      status: knowledgeCards.status,
      confidence: knowledgeCards.expertConfidence,
      sourcePersonId: knowledgeCards.sourcePersonId,
      classification: knowledgeCards.classification,
      approvedOn: knowledgeCards.approvedOn,
    })
    .from(knowledgeCards)
    .orderBy(asc(knowledgeCards.id))
    .all();

  const topicsByCard = new Map<string, string[]>();
  for (const ct of db
    .select({ cardId: cardTopics.cardId, topicId: cardTopics.topicId })
    .from(cardTopics)
    .innerJoin(topics, eq(topics.id, cardTopics.topicId))
    .orderBy(asc(cardTopics.cardId), asc(topics.sortOrder), asc(topics.id))
    .all()) {
    const list = topicsByCard.get(ct.cardId);
    if (list) list.push(ct.topicId);
    else topicsByCard.set(ct.cardId, [ct.topicId]);
  }

  const holderSet = new Set(holderIds);
  const result = computeCoverage({
    demoToday,
    people: holders.map((h) => ({ id: h.id, hireDate: h.hireDate, plannedDepartureDate: h.plannedDepartureDate })),
    topics: topicRows.map((t) => ({ id: t.id })),
    expertise,
    cards: cardRows
      .filter((c) => holderSet.has(c.sourcePersonId))
      .map((c) => ({
        id: c.id,
        sourcePersonId: c.sourcePersonId,
        type: c.type,
        confidence: c.confidence,
        status: c.status,
        topicIds: topicsByCard.get(c.id) ?? [],
      })),
  });

  return { demoToday, shopName, holders, topicRows, cardRows, topicsByCard, result };
}

/** The gated departure. The raw date never leaves except inside the visible branch (owner/quoter). */
function departureOf(actor: PeopleActor, h: HolderRow, months: number | null): Gated<PersonDeparture | null> {
  const value: PersonDeparture | null =
    h.plannedDepartureDate && months !== null ? { date: h.plannedDepartureDate, months, kind: h.departureKind ?? "other" } : null;
  return gated(actor.role, "departure", value);
}

function topRiskOf(loaded: Loaded, personId: string): PersonTopRiskVM | null {
  const pr = loaded.result.people.find((p) => p.personId === personId);
  if (!pr || pr.maxRiskTopicId === null) return null;
  const cell = loaded.result.cells.find((c) => c.personId === personId && c.topicId === pr.maxRiskTopicId);
  const topic = loaded.topicRows.find((t) => t.id === pr.maxRiskTopicId);
  if (!cell || !topic) return null;
  return {
    topicId: topic.id,
    topicLabel: topic.label,
    topicShortLabel: shortTopicLabel(topic.label),
    risk: cell.risk,
    band: cell.band,
    spof: cell.spof,
  };
}

function cellsOf(loaded: Loaded, personId: string): CellResult[] {
  return loaded.result.cells.filter((c) => c.personId === personId);
}

// ---------------------------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------------------------

/** The knowledge holders for /people, in people.sort_order. */
export function listPeople(db: Db, actor: PeopleActor): PeopleListVM {
  const loaded = loadCoverage(db);
  const approvedBy = new Map<string, number>();
  for (const c of loaded.cardRows) {
    if (c.status === "approved") approvedBy.set(c.sourcePersonId, (approvedBy.get(c.sourcePersonId) ?? 0) + 1);
  }

  const rows: PersonRowVM[] = loaded.holders.map((h) => {
    const pr = loaded.result.people.find((p) => p.personId === h.id);
    const tenure = tenureLabels(h.hireDate, loaded.demoToday);
    return {
      id: h.id,
      fullName: h.fullName,
      firstName: h.displayName,
      jobTitle: h.jobTitle,
      department: h.department,
      departmentLabel: DEPARTMENT_LABEL[h.department],
      classification: PERSON_CLASSIFICATION,
      tenureLabel: tenure.short,
      tenureLongLabel: tenure.long,
      departure: departureOf(actor, h, pr?.monthsToDeparture ?? null),
      deepTopicCount: cellsOf(loaded, h.id).filter((c) => c.level === 3).length,
      deepCoveragePct: pr?.deepCoveragePct ?? null,
      approvedCardCount: approvedBy.get(h.id) ?? 0,
      topRisk: topRiskOf(loaded, h.id),
      isMe: actor.personId !== null && actor.personId === h.id,
    };
  });

  return { demoToday: loaded.demoToday, people: rows };
}

/**
 * One holder's profile, or null for an unknown ID, a malformed ID, the persona-only owner (no people row) or a
 * person who is not a knowledge holder. The page calls notFound() on null.
 */
export function personProfile(db: Db, actor: PeopleActor, id: string): PersonProfileVM | null {
  if (typeof id !== "string" || !PERSON_ID_RE.test(id)) return null;
  const exists = db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, id), eq(people.isKnowledgeHolder, true)))
    .get();
  if (!exists) return null;

  const loaded = loadCoverage(db);
  const h = loaded.holders.find((x) => x.id === id);
  const pr = loaded.result.people.find((p) => p.personId === id);
  if (!h || !pr) return null;

  const topicById = new Map(loaded.topicRows.map((t) => [t.id, t]));
  const topicOrder = new Map(loaded.topicRows.map((t, i) => [t.id, i]));

  // --- Topics held, grouped by level (3 → 1), highest risk first inside a level.
  const mine = cellsOf(loaded, id);
  const topicVMs: PersonTopicVM[] = mine.map((c) => {
    const t = topicById.get(c.topicId)!;
    return {
      topicId: t.id,
      label: t.label,
      shortLabel: shortTopicLabel(t.label),
      category: t.category,
      categoryLabel: TOPIC_CATEGORY_LABEL[t.category],
      level: toLevel(c.level),
      capturedPct: round1(c.captured * 100),
      risk: c.risk,
      band: c.band,
      spof: c.spof,
      approvedCardCount: c.approvedCardIds.length,
      pendingCardCount: c.pendingCardIds.length,
      libraryHref: peopleLibraryHref(id, t.id),
    };
  });
  const topicGroups: PersonTopicGroupVM[] = ([3, 2, 1] as const)
    .map((level) => ({
      level,
      label: LEVEL_LABEL[level],
      topics: topicVMs
        .filter((t) => t.level === level)
        .sort((a, b) => b.risk - a.risk || topicOrder.get(a.topicId)! - topicOrder.get(b.topicId)!),
    }))
    .filter((g) => g.topics.length > 0);

  // --- Cards by status.
  const myCards = loaded.cardRows.filter((c) => c.sourcePersonId === id);
  const cardVM = (c: CardRow): PersonCardVM => ({
    id: c.id,
    title: c.title,
    type: c.type,
    typeLabel: CARD_TYPE_LABEL[c.type],
    status: c.status,
    classification: c.classification,
    topicLabels: (loaded.topicsByCard.get(c.id) ?? []).map((tid) => topicById.get(tid)?.label ?? tid),
    approvedOn: c.status === "approved" ? c.approvedOn : null,
  });
  const cardGroups: PersonCardGroupVM[] = PERSON_CARD_STATUS_ORDER.map((status) => ({
    status,
    label: PERSON_CARD_STATUS_LABEL[status],
    cards: myCards.filter((c) => c.status === status).map(cardVM),
  })).filter((g) => g.cards.length > 0);

  // --- Interviews given (visible sessions only) and the hand-entered count.
  const sessionRows = db
    .select({
      id: interviews.id,
      title: interviews.title,
      mode: interviews.mode,
      startedAt: interviews.startedAt,
      classification: interviews.classification,
      topicLabel: topics.label,
    })
    .from(interviews)
    .leftJoin(topics, eq(topics.id, interviews.topicId))
    .where(and(eq(interviews.expertPersonId, id), eq(interviews.isHidden, false)))
    .orderBy(desc(interviews.startedAt), asc(interviews.id))
    .all();
  const cardsPerSession = new Map<string, number>();
  if (sessionRows.length > 0) {
    for (const r of db
      .select({ interviewId: knowledgeCards.sourceInterviewId, n: count() })
      .from(knowledgeCards)
      .where(
        inArray(
          knowledgeCards.sourceInterviewId,
          sessionRows.map((s) => s.id),
        ),
      )
      .groupBy(knowledgeCards.sourceInterviewId)
      .all()) {
      if (r.interviewId) cardsPerSession.set(r.interviewId, r.n);
    }
  }
  const interviewVMs: PersonInterviewVM[] = sessionRows.map((s) => ({
    id: s.id,
    title: s.title,
    mode: s.mode,
    modeLabel: INTERVIEW_MODE_LABEL[s.mode],
    date: s.startedAt.slice(0, 10),
    classification: s.classification,
    topicLabel: s.topicLabel ?? null,
    cardCount: cardsPerSession.get(s.id) ?? 0,
  }));

  const handEntered =
    db
      .select({ n: count() })
      .from(knowledgeCards)
      .innerJoin(interviews, eq(interviews.id, knowledgeCards.sourceInterviewId))
      .where(and(eq(knowledgeCards.sourcePersonId, id), eq(interviews.isHidden, true)))
      .get()?.n ?? 0;

  // --- Work: counts only (no prices, no outcomes).
  const jobsLed = db.select({ n: count() }).from(jobs).where(eq(jobs.leadPersonId, id)).get()?.n ?? 0;
  const quotesPrepared = db.select({ n: count() }).from(quotes).where(eq(quotes.quotedByPersonId, id)).get()?.n ?? 0;

  const tenure = tenureLabels(h.hireDate, loaded.demoToday);
  const approvedCardCount = myCards.filter((c) => c.status === "approved").length;
  const pendingCardCount = myCards.filter((c) => c.status === "draft" || c.status === "pending_review").length;

  return {
    id: h.id,
    fullName: h.fullName,
    firstName: h.displayName,
    jobTitle: h.jobTitle,
    department: h.department,
    departmentLabel: DEPARTMENT_LABEL[h.department],
    classification: PERSON_CLASSIFICATION,
    tenureLabel: tenure.short,
    tenureLongLabel: tenure.long,
    hireDate: h.hireDate,
    priorExperienceYears: h.priorExperienceYears,
    departure: departureOf(actor, h, pr.monthsToDeparture),
    bio: h.bioMd ? markShopNameFictional(h.bioMd, loaded.shopName) : null,
    isMe: actor.personId !== null && actor.personId === h.id,
    demoToday: loaded.demoToday,
    topicGroups,
    coverage: {
      deepCoveragePct: pr.deepCoveragePct,
      capturedPct: pr.capturedPct,
      deepTopicCount: mine.filter((c) => c.level === 3).length,
      topicCount: mine.length,
      approvedCardCount,
      pendingCardCount,
    },
    topRisk: topRiskOf(loaded, id),
    cardGroups,
    interviews: interviewVMs,
    handEnteredCardCount: handEntered,
    work: { jobsLed, quotesPrepared, jobsHref: peopleJobsHref(id) },
  };
}
