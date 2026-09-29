/**
 * Knowledge Risk dashboard data (PLAN.md §6, §8.1). Pure and synchronous: (db, actor) in, a plain serializable view
 * model out (docs/DATA-LAYER.md). The server wrapper is src/server/queries/risk.ts.
 *
 * What the page needs, in one read:
 * - the 8 knowledge holders (heat-map columns, ordered by risk contribution so the biggest exposure is first),
 * - the 28 topics (rows) with coverage, band and SPOF, plus the default "highest risk first" row order,
 * - every (person, topic) cell with E > 0 and the inputs behind its score,
 * - the seeded baseline (coverage_snapshots, reason seed_baseline) for delta mode,
 * - the KPI row.
 *
 * Departure gate (PLAN.md §4.8, DATA-LAYER.md rule 4): the planned departure date is never selected into the view
 * model. Everything derived from it (months to departure, the kind of departure, the departure factor U, the
 * "Retires in N mo" chip, the SPOF tile's "retiring in N months" and the "departing within 24 months" KPI) is built
 * with gated(actor.role, "departure", …), so for machinist and trainee the values don't exist in the payload.
 * The tenure factor T and the backup discount D are gated with U: risk, E and f are visible to every role, so with
 * T and D in the payload U = risk ÷ (100 × E/3 × (1 − f) × T × D) could be solved for (and from U, the months).
 * Risk itself is visible to every role (it is the point of the page), so sorting columns by risk contribution is not
 * a hidden-field sort.
 */
import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  cardTopics,
  coverageSnapshots,
  knowledgeCards,
  people,
  personTopicExpertise,
  shopProfile,
  topics,
  type CardType,
  type Classification,
  type DEPARTURE_KINDS,
  type TOPIC_CATEGORIES,
} from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import {
  cellKey,
  computeCoverage,
  type CoverageCard,
  type CoverageExpertise,
  type ExpertiseLevel,
} from "@/lib/coverage/compute";
import { BAND_THRESHOLDS, isSpof, riskBand, type RiskBand } from "@/lib/coverage/params";
import { gated, type Gated } from "@/lib/data/gate";
import { addDays, monthsBetween } from "@/lib/time";

export type RiskActor = { role: Role; personId: string | null };
export type TopicCategory = (typeof TOPIC_CATEGORIES)[number];
export type DepartureKind = (typeof DEPARTURE_KINDS)[number];

/** The KPI window for "holders departing within N months". */
export const DEPARTING_WINDOW_MONTHS = 24;
/** The KPI window for "cards approved in the last N demo-days". */
export const APPROVED_WINDOW_DAYS = 30;

/** Months to a planned departure and its kind. Only ever inside a Gated<> (owner/quoter). */
export interface RiskDeparture {
  months: number;
  kind: DepartureKind;
}

export interface RiskPersonVM {
  id: string;
  fullName: string;
  /** people.display_name, e.g. "Ray" (used in "Interview Ray"). */
  firstName: string;
  /** Tenure: whole years when ≥ 1 ("31 yrs"), otherwise whole months ("8 mo"). */
  tenureLabel: string;
  /** Σ of this person's rounded cell risks: the column sort key (risk is visible to every role). */
  contribution: number;
  /** Captured share over the topics where E = 3 (PLAN.md §6), 0..100 with one decimal; null with no level-3 topic. */
  deepCoveragePct: number | null;
  /** The same at the seeded baseline; null when there is no baseline row. */
  deepCoveragePctBefore: number | null;
  /** Owner/quoter: months and kind, or null when no departure is planned. Machinist/trainee: hidden. */
  departure: Gated<RiskDeparture | null>;
}

export interface RiskCellFactors {
  /** Departure urgency U (0.25–1), gated like the departure date. */
  U: Gated<number>;
  /** Tenure factor T (0.6–1). Gated with U: it is the complement that would reveal U. */
  T: Gated<number>;
  /** Backup discount D (0.4–1). Gated with U for the same reason. */
  D: Gated<number>;
  /** Best backup level B among the other holders (0–3). Visible: backup names and the SPOF rule need it. */
  B: number;
}

export interface RiskCellBefore {
  risk: number;
  band: RiskBand;
  /** Captured share f × 100 at the baseline, one decimal. */
  capturedPct: number;
}

export interface RiskCellVM {
  personId: string;
  topicId: string;
  /** Tacit level E (1–3); level-0 pairs have no cell. */
  level: 1 | 2 | 3;
  risk: number;
  band: RiskBand;
  spof: boolean;
  /** Captured share f × 100, one decimal. */
  capturedPct: number;
  /** Approved-card points C (two decimals). */
  capturedPoints: number;
  /** Approved cards credited to this person and tagged with this topic (keys into RiskOverviewVM.cards). */
  approvedCardIds: string[];
  /** Draft and pending-review cards (never counted in the score). */
  pendingCount: number;
  factors: RiskCellFactors;
  /** The seeded baseline for this cell, or null when there is none. */
  before: RiskCellBefore | null;
}

export interface RiskTopicVM {
  id: string;
  label: string;
  /** Label without a trailing parenthetical: "Titanium (Ti-6Al-4V)" → "Titanium" (accessible names, sentences). */
  shortLabel: string;
  category: TopicCategory;
  /** topics.sort_order (ties and the category grouping use it). */
  order: number;
  /** Coverage(t), 0..100 with one decimal; null when nobody holds the topic. */
  coverage: number | null;
  coverageBefore: number | null;
  /** Max cell risk on the topic and its band. */
  risk: number;
  band: RiskBand;
  riskBefore: number | null;
  bandBefore: RiskBand | null;
  spofPersonId: string | null;
  spofPersonIdBefore: string | null;
}

/** An approved card a cell links to (/library/{id}). Carries its own classification (DATA-LAYER.md rule 5). */
export interface RiskCardRef {
  id: string;
  title: string;
  type: CardType;
  classification: Classification;
}

export interface RiskSpofHolder {
  personId: string;
  fullName: string;
  /** Number of SPOF topics this person holds. */
  topics: number;
  departure: Gated<RiskDeparture | null>;
}

export interface RiskKpis {
  highRisk: { count: number; countBefore: number | null; topicIds: string[] };
  spof: { count: number; countBefore: number | null; holders: RiskSpofHolder[] };
  /** Owner/quoter only; the page omits the tile when hidden. */
  departing: Gated<{ count: number; windowMonths: number; people: { personId: string; fullName: string; months: number; kind: DepartureKind }[] }>;
  approvedRecent: { count: number; windowDays: number; since: string };
}

export interface RiskOverviewVM {
  /** Demo "today" (YYYY-MM-DD) from shop_profile. */
  demoToday: string;
  /** Holders, ordered by risk contribution (desc), ties by the seeded order. */
  people: RiskPersonVM[];
  /** Topics in seeded order (the category grouping uses this order). */
  topics: RiskTopicVM[];
  /** Topic IDs, "highest risk first": max cell risk desc, ties by topic order. */
  riskFirstOrder: string[];
  /** Cells with E > 0, by topic order then person order. */
  cells: RiskCellVM[];
  cards: Record<string, RiskCardRef>;
  kpis: RiskKpis;
  baseline: {
    /** True when seed_baseline snapshot rows exist. */
    available: boolean;
    /** True when any cell, topic or person value differs from the baseline. */
    hasChanges: boolean;
  };
  thresholds: { high: number; elevated: number; watch: number };
}

/** "Titanium (Ti-6Al-4V)" → "Titanium"; labels without a trailing parenthetical are unchanged. */
export function shortTopicLabel(label: string): string {
  const s = label.replace(/\s*\([^()]*\)\s*$/, "").trim();
  return s || label;
}

/** Tenure for column headers: "31 yrs", "1 yr", or "8 mo" under a year. */
export function tenureLabel(hireDate: string, demoToday: string): string {
  const months = Math.max(0, monthsBetween(hireDate, demoToday));
  if (months < 12) return `${months} mo`;
  const years = Math.floor(months / 12);
  return `${years} ${years === 1 ? "yr" : "yrs"}`;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function toLevel(n: number): 1 | 2 | 3 {
  return (n >= 3 ? 3 : n <= 1 ? 1 : 2) as 1 | 2 | 3;
}

/** The whole Knowledge Risk view model for one actor. */
export function riskOverview(db: Db, actor: RiskActor): RiskOverviewVM {
  const shop = db.select({ demoToday: shopProfile.demoToday }).from(shopProfile).get();
  if (!shop) throw new Error("shop_profile is missing");
  const demoToday = shop.demoToday;

  // --- Holders (not the persona-only owner). The planned departure is read because U depends on it; it leaves this
  // function only through gated(actor.role, "departure", …), never as a raw field.
  const personRows = db
    .select({
      id: people.id,
      fullName: people.fullName,
      displayName: people.displayName,
      hireDate: people.hireDate,
      sortOrder: people.sortOrder,
      plannedDepartureDate: people.plannedDepartureDate,
      departureKind: people.departureKind,
    })
    .from(people)
    .where(eq(people.isKnowledgeHolder, true))
    .orderBy(asc(people.sortOrder), asc(people.id))
    .all();
  const personIds = personRows.map((p) => p.id);

  const topicRows = db
    .select({ id: topics.id, label: topics.label, category: topics.category, sortOrder: topics.sortOrder })
    .from(topics)
    .orderBy(asc(topics.sortOrder), asc(topics.id))
    .all();

  const expertise: CoverageExpertise[] = db
    .select({ personId: personTopicExpertise.personId, topicId: personTopicExpertise.topicId, level: personTopicExpertise.tacitLevel })
    .from(personTopicExpertise)
    .where(personIds.length > 0 ? inArray(personTopicExpertise.personId, personIds) : undefined)
    .all()
    .map((e) => ({ ...e, level: e.level as ExpertiseLevel }));

  const cardRows = db
    .select({
      id: knowledgeCards.id,
      title: knowledgeCards.title,
      type: knowledgeCards.type,
      confidence: knowledgeCards.expertConfidence,
      status: knowledgeCards.status,
      sourcePersonId: knowledgeCards.sourcePersonId,
      approvedOn: knowledgeCards.approvedOn,
      classification: knowledgeCards.classification,
    })
    .from(knowledgeCards)
    .orderBy(asc(knowledgeCards.id))
    .all();
  const topicsByCard = new Map<string, string[]>();
  for (const ct of db.select({ cardId: cardTopics.cardId, topicId: cardTopics.topicId }).from(cardTopics).orderBy(asc(cardTopics.cardId), asc(cardTopics.topicId)).all()) {
    const list = topicsByCard.get(ct.cardId);
    if (list) list.push(ct.topicId);
    else topicsByCard.set(ct.cardId, [ct.topicId]);
  }
  const holderSet = new Set(personIds);
  const coverageCards: CoverageCard[] = cardRows
    .filter((c) => holderSet.has(c.sourcePersonId))
    .map((c) => ({
      id: c.id,
      sourcePersonId: c.sourcePersonId,
      type: c.type,
      confidence: c.confidence,
      status: c.status,
      topicIds: topicsByCard.get(c.id) ?? [],
    }));

  const result = computeCoverage({
    demoToday,
    people: personRows.map((p) => ({ id: p.id, hireDate: p.hireDate, plannedDepartureDate: p.plannedDepartureDate })),
    topics: topicRows.map((t) => ({ id: t.id })),
    expertise,
    cards: coverageCards,
  });

  // --- Baseline (seed_baseline snapshot rows written by the reset).
  const snaps = db
    .select({
      scope: coverageSnapshots.scope,
      topicId: coverageSnapshots.topicId,
      personId: coverageSnapshots.personId,
      coverage: coverageSnapshots.coverage,
      capturedPct: coverageSnapshots.capturedPct,
      risk: coverageSnapshots.risk,
    })
    .from(coverageSnapshots)
    .where(eq(coverageSnapshots.reason, "seed_baseline"))
    .orderBy(asc(coverageSnapshots.id))
    .all();
  const cellBefore = new Map<string, { risk: number; capturedPct: number }>();
  const topicBefore = new Map<string, { coverage: number | null; risk: number | null }>();
  const personBefore = new Map<string, number | null>();
  for (const s of snaps) {
    if (s.scope === "cell" && s.personId && s.topicId && s.risk !== null && s.capturedPct !== null) {
      cellBefore.set(cellKey(s.personId, s.topicId), { risk: s.risk, capturedPct: s.capturedPct });
    } else if (s.scope === "topic" && s.topicId) {
      topicBefore.set(s.topicId, { coverage: s.coverage, risk: s.risk });
    } else if (s.scope === "person" && s.personId) {
      personBefore.set(s.personId, s.capturedPct);
    }
  }
  const baselineAvailable = snaps.length > 0;

  // --- Gated departure per person (months from the one shared monthsBetween(), via computeCoverage).
  const monthsOf = new Map(result.people.map((p) => [p.personId, p.monthsToDeparture]));
  const departureOf = (personId: string): Gated<RiskDeparture | null> => {
    const p = personRows.find((r) => r.id === personId);
    const months = monthsOf.get(personId) ?? null;
    const value: RiskDeparture | null = p?.plannedDepartureDate && months !== null ? { months, kind: p.departureKind ?? "other" } : null;
    return gated(actor.role, "departure", value);
  };

  // --- Cells.
  const massByTopic = new Map(result.topics.map((t) => [t.topicId, t.mass]));
  const approvedIdsInUse = new Set<string>();
  let changed = false;
  const cells: RiskCellVM[] = result.cells.map((c) => {
    for (const id of c.approvedCardIds) approvedIdsInUse.add(id);
    // Same expression the seed baseline uses (src/lib/seed/invariants.ts), so an untouched cell always compares equal.
    const capturedPct = Math.round(c.captured * 1000) / 10;
    const b = cellBefore.get(cellKey(c.personId, c.topicId));
    const before: RiskCellBefore | null = b ? { risk: b.risk, band: riskBand(b.risk), capturedPct: b.capturedPct } : null;
    if (before && (before.risk !== c.risk || before.capturedPct !== capturedPct)) changed = true;
    return {
      personId: c.personId,
      topicId: c.topicId,
      level: toLevel(c.level),
      risk: c.risk,
      band: c.band,
      spof: c.spof,
      capturedPct,
      capturedPoints: round2(c.capturedPoints),
      approvedCardIds: [...c.approvedCardIds],
      pendingCount: c.pendingCardIds.length,
      // T and D are gated with U (see the header): gated() builds a fresh Hidden object, so no number reaches the
      // payload for machinist and trainee.
      factors: {
        U: gated(actor.role, "departure", round2(c.factors.U)),
        T: gated(actor.role, "departure", round2(c.factors.T)),
        D: gated(actor.role, "departure", round2(c.factors.D)),
        B: c.factors.B,
      },
      before,
    };
  });

  // SPOF at the baseline, recomputed from the baseline capture (levels and backups don't change at runtime).
  const spofBeforeByTopic = new Map<string, string>();
  for (const c of cells) {
    if (!c.before) continue;
    const spofThen = isSpof({ level: c.level, bestBackupLevel: c.factors.B, topicMass: massByTopic.get(c.topicId) ?? 0, captured: c.before.capturedPct / 100 });
    if (spofThen && !spofBeforeByTopic.has(c.topicId)) spofBeforeByTopic.set(c.topicId, c.personId);
  }

  // --- Topics.
  const topicVMs: RiskTopicVM[] = topicRows.map((t) => {
    const r = result.topics.find((x) => x.topicId === t.id)!;
    const b = topicBefore.get(t.id);
    const riskBefore = b?.risk ?? null;
    if (b && (b.coverage !== r.coverage || b.risk !== r.risk)) changed = true;
    return {
      id: t.id,
      label: t.label,
      shortLabel: shortTopicLabel(t.label),
      category: t.category,
      order: t.sortOrder,
      coverage: r.coverage,
      coverageBefore: b ? b.coverage : null,
      risk: r.risk,
      band: r.band,
      riskBefore,
      bandBefore: riskBefore === null ? null : riskBand(riskBefore),
      spofPersonId: r.spofPersonId,
      spofPersonIdBefore: baselineAvailable ? (spofBeforeByTopic.get(t.id) ?? null) : null,
    };
  });
  const orderIndex = new Map(topicVMs.map((t, i) => [t.id, i]));
  const riskFirstOrder = [...topicVMs]
    .sort((a, b) => b.risk - a.risk || orderIndex.get(a.id)! - orderIndex.get(b.id)!)
    .map((t) => t.id);

  // --- People, by risk contribution.
  const contribution = new Map<string, number>(personIds.map((id) => [id, 0]));
  for (const c of cells) contribution.set(c.personId, (contribution.get(c.personId) ?? 0) + c.risk);
  const personOrder = new Map(personRows.map((p, i) => [p.id, i]));
  const peopleVMs: RiskPersonVM[] = personRows
    .map((p) => {
      const pr = result.people.find((x) => x.personId === p.id)!;
      const deepBefore = personBefore.has(p.id) ? (personBefore.get(p.id) ?? null) : null;
      if (personBefore.has(p.id) && deepBefore !== pr.deepCoveragePct) changed = true;
      return {
        id: p.id,
        fullName: p.fullName,
        firstName: p.displayName,
        tenureLabel: tenureLabel(p.hireDate, demoToday),
        contribution: contribution.get(p.id) ?? 0,
        deepCoveragePct: pr.deepCoveragePct,
        deepCoveragePctBefore: deepBefore,
        departure: departureOf(p.id),
      };
    })
    .sort((a, b) => b.contribution - a.contribution || personOrder.get(a.id)! - personOrder.get(b.id)!);

  // --- Cards the cells link to.
  const cards: Record<string, RiskCardRef> = {};
  for (const c of cardRows) {
    if (approvedIdsInUse.has(c.id)) cards[c.id] = { id: c.id, title: c.title, type: c.type, classification: c.classification };
  }

  // --- KPIs.
  const highNow = topicVMs.filter((t) => t.band === "high");
  const highBefore = baselineAvailable ? topicVMs.filter((t) => t.bandBefore === "high").length : null;
  const spofTopics = topicVMs.filter((t) => t.spofPersonId !== null);
  const spofBefore = baselineAvailable ? topicVMs.filter((t) => t.spofPersonIdBefore !== null).length : null;
  const holderCounts = new Map<string, number>();
  for (const t of spofTopics) holderCounts.set(t.spofPersonId!, (holderCounts.get(t.spofPersonId!) ?? 0) + 1);
  const nameOf = new Map(personRows.map((p) => [p.id, p.fullName]));
  const holders: RiskSpofHolder[] = [...holderCounts.entries()]
    .sort((a, b) => b[1] - a[1] || personOrder.get(a[0])! - personOrder.get(b[0])!)
    .map(([personId, n]) => ({ personId, fullName: nameOf.get(personId) ?? personId, topics: n, departure: departureOf(personId) }));

  const departingPeople: { personId: string; fullName: string; months: number; kind: DepartureKind }[] = [];
  for (const p of personRows) {
    const d = departureOf(p.id);
    if (!d.hidden && d.value && d.value.months >= 0 && d.value.months <= DEPARTING_WINDOW_MONTHS) {
      departingPeople.push({ personId: p.id, fullName: p.fullName, months: d.value.months, kind: d.value.kind });
    }
  }
  departingPeople.sort((a, b) => a.months - b.months || personOrder.get(a.personId)! - personOrder.get(b.personId)!);

  // The last N demo-days, today included: [today − (N − 1), today]. approved_on is either a seeded YYYY-MM-DD or a
  // runtime demo-clock ISO timestamp (PLAN.md §5.1, demoClockIso()), so compare the date part only.
  const since = addDays(demoToday, -(APPROVED_WINDOW_DAYS - 1));
  const approvedRecent = cardRows.filter((c) => {
    const day = c.status === "approved" ? c.approvedOn?.slice(0, 10) : undefined;
    return day !== undefined && day >= since && day <= demoToday;
  }).length;

  return {
    demoToday,
    people: peopleVMs,
    topics: topicVMs,
    riskFirstOrder,
    cells,
    cards,
    kpis: {
      highRisk: { count: highNow.length, countBefore: highBefore, topicIds: highNow.map((t) => t.id).sort((a, b) => riskFirstOrder.indexOf(a) - riskFirstOrder.indexOf(b)) },
      spof: { count: spofTopics.length, countBefore: spofBefore, holders },
      departing: gated(actor.role, "departure", { count: departingPeople.length, windowMonths: DEPARTING_WINDOW_MONTHS, people: departingPeople }),
      approvedRecent: { count: approvedRecent, windowDays: APPROVED_WINDOW_DAYS, since },
    },
    baseline: { available: baselineAvailable, hasChanges: baselineAvailable && changed },
    thresholds: { ...BAND_THRESHOLDS },
  };
}
