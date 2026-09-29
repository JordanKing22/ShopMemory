/**
 * Knowledge coverage and risk (PLAN.md §6).
 *
 *   C(p,t)      = Σ w(c) over APPROVED cards credited to p and tagged t
 *   f(p,t)      = E = 0 ? 0 : min(1, C / (K·E))
 *   risk(p,t)   = round(100 × (E/3) × (1 − f) × U(p) × T(p) × D(p,t))
 *   Coverage(t) = 100 × Σ_p min(E, C/K) / Σ_p E
 *   SPOF(t)     = the p with E = 3, B ≤ 1, E/ΣE > 0.5 and f < 0.5
 *   Person "deep coverage" = captured share over the topics where E(p,t) = 3
 *
 * Only `approved` cards count. `draft` and `pending_review` cards accumulate into `pendingPoints`
 * (the hatched "pending" increment) and never change coverage or risk. `rejected` and `superseded`
 * cards are ignored entirely.
 *
 * Cells: one per (person, topic) with E > 0. Level-0 pairs are omitted (their risk and captured share
 * are 0 by definition, and cards credited to a person on a topic where they have E = 0 add nothing to
 * coverage), so a missing key in {@link indexCells} means "not a holder".
 *
 * Pure and deterministic: no I/O, no clock, no randomness; output order follows input order
 * (cells by topic order, then person order).
 */
import type { CardStatus, CardType, Confidence } from "@/db/schema/enums";
import {
  K,
  MAX_LEVEL,
  backupDiscount,
  capturedFraction,
  cardWeight,
  isSpof,
  monthsToDeparture,
  riskBand,
  tenureFactor,
  tenureYears,
  urgencyFactor,
  type ExpertiseLevel,
  type RiskBand,
} from "./params";

export { riskBand };
export type { ExpertiseLevel, RiskBand };

/** A holder candidate. Dates are YYYY-MM-DD. */
export interface CoveragePerson {
  id: string;
  hireDate: string;
  /** Planned departure (retirement or other); `null` when none is planned. */
  plannedDepartureDate: string | null;
}

/** A heat-map row. */
export interface CoverageTopic {
  id: string;
}

/** SME-seeded tacit level E(p,t). Missing pairs are treated as level 0. */
export interface CoverageExpertise {
  personId: string;
  topicId: string;
  level: ExpertiseLevel;
}

/** The projection of a knowledge card that coverage needs (no text, no classification). */
export interface CoverageCard {
  id: string;
  /** The expert credited with the card. */
  sourcePersonId: string;
  type: CardType;
  confidence: Confidence;
  status: CardStatus;
  /** Topic tags (at most 3 by seed:check / the gate; duplicates are counted once). */
  topicIds: string[];
}

export interface CoverageInput {
  /** DEMO_TODAY (YYYY-MM-DD); the reference date for months-to-departure and tenure. */
  demoToday: string;
  people: CoveragePerson[];
  topics: CoverageTopic[];
  expertise: CoverageExpertise[];
  cards: CoverageCard[];
}

/** The inputs behind a cell's score, shown on click (U is hidden from machinist/trainee roles by the UI). */
export interface CellFactors {
  /** Urgency from months to departure, 0.25–1. */
  U: number;
  /** Tenure factor, 0.6–1. */
  T: number;
  /** Backup discount, 0.4–1. */
  D: number;
  /** Best backup level among the other people, 0–3. */
  B: number;
}

export interface CellResult {
  personId: string;
  topicId: string;
  /** E(p,t), always > 0 for emitted cells. */
  level: ExpertiseLevel;
  /** C(p,t): weighted points of approved cards. */
  capturedPoints: number;
  /** Weighted points of draft / pending_review cards (display only; never affects scores). */
  pendingPoints: number;
  /** f(p,t), 0..1. */
  captured: number;
  /** Rounded risk, integer 0..100. */
  risk: number;
  /** Unrounded risk (for ranking ties and tests). */
  riskRaw: number;
  /** Band of the rounded risk. */
  band: RiskBand;
  /** True when this person is the topic's single point of failure. */
  spof: boolean;
  factors: CellFactors;
  /** IDs of the approved cards counted in `capturedPoints`, in input order. */
  approvedCardIds: string[];
  /** IDs of the draft / pending_review cards counted in `pendingPoints`, in input order. */
  pendingCardIds: string[];
}

export interface TopicResult {
  topicId: string;
  /** Expertise mass Σ_p E(p,t). */
  mass: number;
  /** Coverage(t), 0..100 rounded to 1 decimal; `null` when nobody holds the topic (mass 0). */
  coverage: number | null;
  /** Max cell risk on this topic (0 when there are no holders). */
  risk: number;
  band: RiskBand;
  /** Number of people with E ≥ 2 ("independent, can teach basics" or deeper). */
  benchDepth: number;
  /** The topic's single point of failure, if any (at most one per topic). */
  spofPersonId: string | null;
}

export interface PersonResult {
  personId: string;
  /** Fractional years from hire date to DEMO_TODAY (365.25-day years, floored at 0). */
  tenureYears: number;
  /** Whole months from DEMO_TODAY to the planned departure; `null` when none is planned. */
  monthsToDeparture: number | null;
  /** Captured share over every topic where E > 0, 0..100 rounded to 1 decimal; `null` with no expertise. */
  capturedPct: number | null;
  /** Captured share over the topics where E = 3, 0..100 rounded to 1 decimal; `null` with no level-3 topic. */
  deepCoveragePct: number | null;
  /** Highest rounded cell risk (0 when the person holds no topic). */
  maxRisk: number;
  /** Topic of the highest risk (ties: higher unrounded risk, then earlier topic order); `null` with no cells. */
  maxRiskTopicId: string | null;
}

export interface CoverageResult {
  cells: CellResult[];
  topics: TopicResult[];
  people: PersonResult[];
}

/** Thrown for structurally invalid input (unknown or duplicate IDs, out-of-range levels). Messages carry IDs only. */
export class CoverageInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoverageInputError";
  }
}

/** Stable map key for a (person, topic) cell. */
export function cellKey(personId: string, topicId: string): string {
  return `${personId}|${topicId}`;
}

/** Index cells by {@link cellKey}. A missing key means E = 0 (not a holder). */
export function indexCells(cells: readonly CellResult[]): Map<string, CellResult> {
  const map = new Map<string, CellResult>();
  for (const c of cells) map.set(cellKey(c.personId, c.topicId), c);
  return map;
}

/** Round to one decimal place (display precision for coverage percentages). */
export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

const COUNTED_STATUSES: ReadonlySet<CardStatus> = new Set<CardStatus>(["approved"]);
const PENDING_STATUSES: ReadonlySet<CardStatus> = new Set<CardStatus>(["draft", "pending_review"]);

interface Accum {
  captured: number;
  pending: number;
  approvedIds: string[];
  pendingIds: string[];
}

/** Compute every cell, topic and person score from the §6 formulas. */
export function computeCoverage(input: CoverageInput): CoverageResult {
  const { demoToday, people, topics, expertise, cards } = input;

  // --- Index people and topics (order preserved), reject duplicates.
  const personIds = new Set<string>();
  for (const p of people) {
    if (personIds.has(p.id)) throw new CoverageInputError(`Duplicate person id ${p.id}`);
    personIds.add(p.id);
  }
  const topicIds = new Set<string>();
  for (const t of topics) {
    if (topicIds.has(t.id)) throw new CoverageInputError(`Duplicate topic id ${t.id}`);
    topicIds.add(t.id);
  }

  // --- Expertise levels; missing pairs are 0.
  const levels = new Map<string, number>();
  for (const e of expertise) {
    if (!personIds.has(e.personId)) throw new CoverageInputError(`Expertise for unknown person ${e.personId}`);
    if (!topicIds.has(e.topicId)) throw new CoverageInputError(`Expertise for unknown topic ${e.topicId}`);
    if (!Number.isInteger(e.level) || e.level < 0 || e.level > MAX_LEVEL) {
      throw new CoverageInputError(`Expertise level out of range for ${cellKey(e.personId, e.topicId)}`);
    }
    const key = cellKey(e.personId, e.topicId);
    if (levels.has(key)) throw new CoverageInputError(`Duplicate expertise for ${key}`);
    levels.set(key, e.level);
  }
  const levelOf = (personId: string, topicId: string): number => levels.get(cellKey(personId, topicId)) ?? 0;

  // --- Card points per (person, topic), in card input order.
  const accum = new Map<string, Accum>();
  for (const card of cards) {
    const counted = COUNTED_STATUSES.has(card.status);
    const pending = PENDING_STATUSES.has(card.status);
    if (!counted && !pending) continue;
    const w = cardWeight(card.type, card.confidence);
    for (const topicId of new Set(card.topicIds)) {
      const key = cellKey(card.sourcePersonId, topicId);
      let a = accum.get(key);
      if (!a) {
        a = { captured: 0, pending: 0, approvedIds: [], pendingIds: [] };
        accum.set(key, a);
      }
      if (counted) {
        a.captured += w;
        a.approvedIds.push(card.id);
      } else {
        a.pending += w;
        a.pendingIds.push(card.id);
      }
    }
  }

  // --- Per-person factors.
  const personFactors = new Map<string, { years: number; months: number | null; U: number; T: number }>();
  for (const p of people) {
    const years = tenureYears(p.hireDate, demoToday);
    const months = monthsToDeparture(demoToday, p.plannedDepartureDate);
    personFactors.set(p.id, { years, months, U: urgencyFactor(months), T: tenureFactor(years) });
  }

  // --- Cells and topics.
  const cells: CellResult[] = [];
  const topicResults: TopicResult[] = [];
  for (const topic of topics) {
    const topicLevels = people.map((p) => levelOf(p.id, topic.id));
    const mass = topicLevels.reduce((s, e) => s + e, 0);
    let capturedMass = 0;
    let topicRisk = 0;
    let benchDepth = 0;
    let spofPersonId: string | null = null;

    for (let i = 0; i < people.length; i++) {
      const person = people[i];
      const E = topicLevels[i];
      if (E >= 2) benchDepth += 1;
      if (E <= 0) continue;

      let B = 0;
      for (let j = 0; j < topicLevels.length; j++) {
        if (j !== i && topicLevels[j] > B) B = topicLevels[j];
      }

      const a = accum.get(cellKey(person.id, topic.id));
      const C = a?.captured ?? 0;
      const f = capturedFraction(C, E);
      const { U, T } = personFactors.get(person.id)!;
      const D = backupDiscount(B, E);
      const riskRaw = 100 * (E / MAX_LEVEL) * (1 - f) * U * T * D;
      const risk = Math.round(riskRaw);
      const spof = isSpof({ level: E, bestBackupLevel: B, topicMass: mass, captured: f });

      capturedMass += Math.min(E, C / K);
      if (risk > topicRisk) topicRisk = risk;
      if (spof && spofPersonId === null) spofPersonId = person.id;

      cells.push({
        personId: person.id,
        topicId: topic.id,
        level: E as ExpertiseLevel,
        capturedPoints: C,
        pendingPoints: a?.pending ?? 0,
        captured: f,
        risk,
        riskRaw,
        band: riskBand(risk),
        spof,
        factors: { U, T, D, B },
        approvedCardIds: a ? [...a.approvedIds] : [],
        pendingCardIds: a ? [...a.pendingIds] : [],
      });
    }

    topicResults.push({
      topicId: topic.id,
      mass,
      coverage: mass > 0 ? round1((100 * capturedMass) / mass) : null,
      risk: topicRisk,
      band: riskBand(topicRisk),
      benchDepth,
      spofPersonId,
    });
  }

  // --- People.
  const topicOrder = new Map(topics.map((t, i) => [t.id, i]));
  const personResults: PersonResult[] = people.map((person) => {
    const { years, months } = personFactors.get(person.id)!;
    let massAll = 0;
    let capAll = 0;
    let massDeep = 0;
    let capDeep = 0;
    let best: CellResult | null = null;
    for (const cell of cells) {
      if (cell.personId !== person.id) continue;
      const share = Math.min(cell.level, cell.capturedPoints / K);
      massAll += cell.level;
      capAll += share;
      if (cell.level === MAX_LEVEL) {
        massDeep += cell.level;
        capDeep += share;
      }
      if (
        best === null ||
        cell.riskRaw > best.riskRaw ||
        (cell.riskRaw === best.riskRaw && topicOrder.get(cell.topicId)! < topicOrder.get(best.topicId)!)
      ) {
        best = cell;
      }
    }
    return {
      personId: person.id,
      tenureYears: years,
      monthsToDeparture: months,
      capturedPct: massAll > 0 ? round1((100 * capAll) / massAll) : null,
      deepCoveragePct: massDeep > 0 ? round1((100 * capDeep) / massDeep) : null,
      maxRisk: best?.risk ?? 0,
      maxRiskTopicId: best?.topicId ?? null,
    };
  });

  return { cells, topics: topicResults, people: personResults };
}
