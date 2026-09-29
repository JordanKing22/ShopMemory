import { describe, expect, it } from "vitest";
import {
  CoverageInputError,
  cellKey,
  computeCoverage,
  indexCells,
  riskBand,
  round1,
  type CellResult,
  type CoverageCard,
  type CoverageInput,
  type CoverageResult,
} from "@/lib/coverage/compute";
import {
  CONF_WEIGHT,
  K,
  TYPE_WEIGHT,
  backupDiscount,
  capturedFraction,
  cardWeight,
  isSpof,
  monthsToDeparture,
  tenureFactor,
  tenureYears,
  urgencyFactor,
} from "@/lib/coverage/params";
import { CARD_TYPES, CONFIDENCE } from "@/db/schema/enums";
import { addDays } from "@/lib/time";
import {
  BEFORE_CARDS,
  DEMO_TODAY,
  EXPERTISE,
  EXPERTISE_MATRIX,
  LINDA,
  MARV,
  MAYA,
  PEOPLE,
  PERSON_IDS,
  RAY,
  SCRIPTED_CARDS,
  TOMAS,
  TOPIC_IDS,
  appendixAInput,
} from "./fixtures/appendix-a";

const TI = "t-mat-ti64";
const THIN = "t-thin-wall";
const QUOTING = "t-quoting";
const IN718 = "t-mat-in718";

function cell(result: CoverageResult, personId: string, topicId: string): CellResult {
  const c = indexCells(result.cells).get(cellKey(personId, topicId));
  if (!c) throw new Error(`no cell ${personId} ${topicId}`);
  return c;
}
function topic(result: CoverageResult, topicId: string) {
  const t = result.topics.find((x) => x.topicId === topicId);
  if (!t) throw new Error(`no topic ${topicId}`);
  return t;
}
function person(result: CoverageResult, personId: string) {
  const p = result.people.find((x) => x.personId === personId);
  if (!p) throw new Error(`no person ${personId}`);
  return p;
}
function spofSet(result: CoverageResult): string[] {
  return result.cells
    .filter((c) => c.spof)
    .map((c) => cellKey(c.personId, c.topicId))
    .sort();
}
function topRiskTopics(result: CoverageResult, personId: string, n: number): string[] {
  return result.cells
    .filter((c) => c.personId === personId)
    .sort((a, b) => b.riskRaw - a.riskRaw)
    .slice(0, n)
    .map((c) => c.topicId);
}
/** Scores only (drops the pending-only fields), for "pending never changes anything" comparisons. */
function scores(result: CoverageResult) {
  return {
    cells: result.cells.map((c) => ({
      key: cellKey(c.personId, c.topicId),
      capturedPoints: c.capturedPoints,
      captured: c.captured,
      risk: c.risk,
      riskRaw: c.riskRaw,
      band: c.band,
      spof: c.spof,
      factors: c.factors,
      approvedCardIds: c.approvedCardIds,
    })),
    topics: result.topics,
    people: result.people,
  };
}

const before = computeCoverage(appendixAInput());
const after = computeCoverage(appendixAInput(SCRIPTED_CARDS));
const EXPECTED_SPOF = [cellKey(RAY, TI), cellKey(RAY, THIN)].sort();

describe("coverage params (PLAN.md §6)", () => {
  it("uses K = 4 and the §6 type and confidence weights", () => {
    expect(K).toBe(4);
    expect(TYPE_WEIGHT).toEqual({
      quoting_rule: 1.0,
      failure_story: 1.0,
      setup_tip: 0.8,
      machine_quirk: 0.8,
      customer_quirk: 0.8,
      inspection_gotcha: 0.8,
    });
    expect(CONF_WEIGHT).toEqual({ always: 1.0, usually: 1.0, sometimes: 0.75, not_stated: 0.75, not_sure: 0.5 });
  });

  it("weighs a card as type × confidence", () => {
    expect(cardWeight("quoting_rule", "usually")).toBe(1.0);
    expect(cardWeight("quoting_rule", "sometimes")).toBe(0.75);
    expect(cardWeight("setup_tip", "always")).toBeCloseTo(0.8, 12);
    expect(cardWeight("setup_tip", "not_stated")).toBeCloseTo(0.6, 12);
    expect(cardWeight("inspection_gotcha", "not_sure")).toBeCloseTo(0.4, 12);
    expect(cardWeight("customer_quirk", "usually")).toBeCloseTo(0.8, 12);
    for (const type of CARD_TYPES) {
      if (type === "failure_story") continue;
      for (const conf of CONFIDENCE) expect(cardWeight(type, conf)).toBeCloseTo(TYPE_WEIGHT[type] * CONF_WEIGHT[conf], 12);
    }
  });

  it("always weighs failure stories 1.0 regardless of confidence", () => {
    for (const conf of CONFIDENCE) expect(cardWeight("failure_story", conf)).toBe(1.0);
  });

  it("computes urgency U from whole months to departure", () => {
    expect(urgencyFactor(null)).toBe(0.25);
    expect(urgencyFactor(20)).toBeCloseTo(1 - 8 / 48, 12);
    expect(urgencyFactor(12)).toBe(1);
    expect(urgencyFactor(0)).toBe(1);
    expect(urgencyFactor(-5)).toBe(1); // already past: clamped to 1
    expect(urgencyFactor(38)).toBeCloseTo(1 - 26 / 48, 12);
    expect(urgencyFactor(48)).toBe(0.25);
    expect(urgencyFactor(52)).toBe(0.25);
    expect(urgencyFactor(600)).toBe(0.25);
    for (let m = -12; m < 120; m++) expect(urgencyFactor(m)).toBeGreaterThanOrEqual(urgencyFactor(m + 1));
  });

  it("derives months to departure with the shared monthsBetween()", () => {
    expect(monthsToDeparture(DEMO_TODAY, "2028-05-15")).toBe(20);
    expect(monthsToDeparture(DEMO_TODAY, "2028-05-14")).toBe(19);
    expect(monthsToDeparture(DEMO_TODAY, null)).toBeNull();
  });

  it("computes tenure T = 0.6 + 0.4·min(1, y/30)", () => {
    expect(tenureFactor(0)).toBe(0.6);
    expect(tenureFactor(15)).toBeCloseTo(0.8, 12);
    expect(tenureFactor(30)).toBe(1);
    expect(tenureFactor(45)).toBe(1);
    expect(tenureFactor(-3)).toBe(0.6);
    expect(tenureYears("1995-06-05", DEMO_TODAY)).toBeGreaterThan(31);
    expect(tenureYears("2027-01-01", DEMO_TODAY)).toBe(0); // future hire floored at 0
  });

  it("computes the backup discount D = 1 − 0.6·min(1, B/E)", () => {
    expect(backupDiscount(1, 3)).toBeCloseTo(0.8, 12);
    expect(backupDiscount(2, 3)).toBeCloseTo(0.6, 12);
    expect(backupDiscount(3, 3)).toBeCloseTo(0.4, 12);
    expect(backupDiscount(3, 2)).toBeCloseTo(0.4, 12);
    expect(backupDiscount(1, 2)).toBeCloseTo(0.7, 12);
    expect(backupDiscount(0, 3)).toBe(1);
    expect(backupDiscount(2, 0)).toBe(1);
  });

  it("computes the captured fraction f = min(1, C/(K·E))", () => {
    expect(capturedFraction(1.8, 3)).toBeCloseTo(0.15, 12);
    expect(capturedFraction(100, 3)).toBe(1);
    expect(capturedFraction(5, 0)).toBe(0);
    expect(capturedFraction(0, 2)).toBe(0);
  });

  it("maps risk to bands: high ≥ 50 · elevated 35–49 · watch 20–34 · low < 20", () => {
    expect(riskBand(100)).toBe("high");
    expect(riskBand(50)).toBe("high");
    expect(riskBand(49)).toBe("elevated");
    expect(riskBand(35)).toBe("elevated");
    expect(riskBand(34)).toBe("watch");
    expect(riskBand(20)).toBe("watch");
    expect(riskBand(19)).toBe("low");
    expect(riskBand(0)).toBe("low");
  });

  it("applies the SPOF rule with strict boundaries", () => {
    const base = { level: 3, bestBackupLevel: 1, topicMass: 5, captured: 0.15 };
    expect(isSpof(base)).toBe(true);
    expect(isSpof({ ...base, level: 2 })).toBe(false);
    expect(isSpof({ ...base, bestBackupLevel: 2 })).toBe(false);
    expect(isSpof({ ...base, bestBackupLevel: 0, topicMass: 3 })).toBe(true);
    expect(isSpof({ ...base, topicMass: 6 })).toBe(false); // share exactly 0.5 is not > 0.5
    expect(isSpof({ ...base, captured: 0.5 })).toBe(false); // f exactly 0.5 is not < 0.5
    expect(isSpof({ ...base, captured: 0.49 })).toBe(true);
    expect(isSpof({ ...base, topicMass: 0 })).toBe(false);
  });
});

describe("Appendix A fixture", () => {
  it("encodes a 28 × 8 matrix with the appendix people and topics", () => {
    expect(EXPERTISE_MATRIX).toHaveLength(28);
    expect(new Set(TOPIC_IDS).size).toBe(28);
    expect(PEOPLE.map((p) => p.id)).toEqual([...PERSON_IDS]);
    expect(EXPERTISE).toHaveLength(28 * 8);
    expect(BEFORE_CARDS.map((c) => c.id)).toEqual([
      "KC-001", "KC-002", "KC-003", "KC-004", "KC-005", "KC-006", "KC-007",
      "KC-008", "KC-009", "KC-010", "KC-011", "KC-012", "KC-021", "KC-034",
    ]);
    expect(BEFORE_CARDS.filter((c) => c.status !== "approved").map((c) => c.id)).toEqual(["KC-011", "KC-012"]);
    expect(SCRIPTED_CARDS.map((c) => c.id)).toEqual(["KC-091", "KC-092", "KC-093", "KC-094"]);
    expect(SCRIPTED_CARDS.every((c) => c.status === "approved" && c.sourcePersonId === RAY)).toBe(true);
  });

  it("matches the appendix card weights", () => {
    const weights = Object.fromEntries(
      [...BEFORE_CARDS, ...SCRIPTED_CARDS].map((c) => [c.id, Math.round(cardWeight(c.type, c.confidence) * 100) / 100]),
    );
    expect(weights).toMatchObject({
      "KC-001": 1.0, "KC-002": 0.8, "KC-003": 0.8, "KC-004": 1.0, "KC-005": 1.0, "KC-006": 1.0,
      "KC-007": 0.8, "KC-008": 0.75, "KC-009": 0.8, "KC-010": 1.0, "KC-021": 1.0, "KC-034": 0.8,
      "KC-091": 1.0, "KC-092": 0.8, "KC-093": 0.8, "KC-094": 1.0,
    });
  });

  it("honours the rule that no other approved card covers titanium or thin-wall for a holder", () => {
    const holders = new Set(EXPERTISE.filter((e) => e.level > 0 && (e.topicId === TI || e.topicId === THIN)).map((e) => `${e.personId}|${e.topicId}`));
    const pinned = new Set(["KC-001", "KC-002", "KC-021", "KC-034", "KC-091", "KC-092", "KC-094"]);
    for (const c of [...BEFORE_CARDS, ...SCRIPTED_CARDS]) {
      if (c.status !== "approved" || pinned.has(c.id)) continue;
      for (const t of c.topicIds) expect(holders.has(`${c.sourcePersonId}|${t}`)).toBe(false);
    }
  });
});

describe("golden numbers before step 2 (PLAN.md §6)", () => {
  it("scores Ray × Titanium at 57 (High) with 15 % captured", () => {
    const c = cell(before, RAY, TI);
    expect(c.level).toBe(3);
    expect(c.capturedPoints).toBeCloseTo(1.8, 12);
    expect(c.captured).toBeCloseTo(0.15, 12);
    expect(c.risk).toBe(57);
    expect(c.band).toBe("high");
    expect(c.factors.U).toBeCloseTo(1 - 8 / 48, 12);
    expect(c.factors.T).toBe(1);
    expect(c.factors.B).toBe(1);
    expect(c.factors.D).toBeCloseTo(0.8, 12);
    expect(c.approvedCardIds).toEqual(["KC-001", "KC-002"]);
    expect(c.pendingCardIds).toEqual([]);
  });

  it("scores Ray × Thin-wall at 57 (High)", () => {
    const c = cell(before, RAY, THIN);
    expect(c.risk).toBe(57);
    expect(c.band).toBe("high");
    expect(c.captured).toBeCloseTo(0.15, 12);
  });

  it("scores Ray × Quoting at 30 (Watch) with Tomás as a level-2 backup", () => {
    const c = cell(before, RAY, QUOTING);
    expect(c.risk).toBe(30);
    expect(c.band).toBe("watch");
    expect(c.factors.B).toBe(2);
    expect(c.capturedPoints).toBeCloseTo(4.75, 12);
  });

  it("puts titanium coverage at 14.0 and thin-wall at 13.0", () => {
    expect(topic(before, TI).coverage).toBe(14.0);
    expect(topic(before, THIN).coverage).toBe(13.0);
    expect(topic(before, TI).mass).toBe(5);
    expect(topic(before, THIN).mass).toBe(5);
  });

  it("puts Ray's deep coverage at 18.2 %", () => {
    const p = person(before, RAY);
    expect(Math.abs((p.deepCoveragePct ?? NaN) - 18.2)).toBeLessThanOrEqual(0.05);
    expect(p.deepCoveragePct).toBe(18.2);
  });

  it("flags exactly Ray × Titanium and Ray × Thin-wall as SPOF", () => {
    expect(spofSet(before)).toEqual(EXPECTED_SPOF);
    expect(topic(before, TI).spofPersonId).toBe(RAY);
    expect(topic(before, THIN).spofPersonId).toBe(RAY);
    expect(before.topics.filter((t) => t.spofPersonId !== null).map((t) => t.topicId).sort()).toEqual([TI, THIN].sort());
  });

  it("keeps every non-Ray cell below 25 (max is Linda at 24.76)", () => {
    const nonRay = before.cells.filter((c) => c.personId !== RAY);
    const max = Math.max(...nonRay.map((c) => c.riskRaw));
    expect(max).toBeLessThan(25);
    expect(max).toBeCloseTo(24.76, 2);
    const top = nonRay.filter((c) => c.riskRaw === max).map((c) => c.personId);
    expect(new Set(top)).toEqual(new Set([LINDA]));
    expect(cell(before, LINDA, "t-fai-cmm").riskRaw).toBeCloseTo(24.76, 2);
  });

  it("ranks Titanium and Thin-wall as Ray's top two risks", () => {
    expect(new Set(topRiskTopics(before, RAY, 2))).toEqual(new Set([TI, THIN]));
    const p = person(before, RAY);
    expect(p.maxRisk).toBe(57);
    // Exact tie: broken by topic order, and thin-wall is the first row.
    expect(p.maxRiskTopicId).toBe(THIN);
    expect(topic(before, TI).risk).toBe(57);
    expect(topic(before, TI).band).toBe("high");
  });

  it("gives Ray 20 months to departure", () => {
    expect(person(before, RAY).monthsToDeparture).toBe(20);
    expect(person(before, LINDA).monthsToDeparture).toBe(38);
    expect(person(before, TOMAS).monthsToDeparture).toBe(52);
    expect(person(before, MARV).monthsToDeparture).toBeNull();
  });
});

describe("golden numbers after Ray approves KC-091…094 (PLAN.md §6)", () => {
  it("drops Ray × Titanium to 41 (Elevated) with 38 % captured", () => {
    const c = cell(after, RAY, TI);
    expect(c.risk).toBe(41);
    expect(c.band).toBe("elevated");
    expect(Math.round(c.captured * 100)).toBe(38);
    expect(c.approvedCardIds).toEqual(["KC-001", "KC-002", "KC-091", "KC-092", "KC-094"]);
  });

  it("drops Ray × Thin-wall to 41 (Elevated) and Ray × Quoting to 26 (Watch)", () => {
    expect(cell(after, RAY, THIN).risk).toBe(41);
    expect(cell(after, RAY, THIN).band).toBe("elevated");
    expect(cell(after, RAY, QUOTING).risk).toBe(26);
    expect(cell(after, RAY, QUOTING).band).toBe("watch");
  });

  it("raises titanium coverage to 28.0 and thin-wall to 27.0 (+14.0 each)", () => {
    expect(topic(after, TI).coverage).toBe(28.0);
    expect(topic(after, THIN).coverage).toBe(27.0);
    expect(round1(topic(after, TI).coverage! - topic(before, TI).coverage!)).toBe(14.0);
    expect(round1(topic(after, THIN).coverage! - topic(before, THIN).coverage!)).toBe(14.0);
  });

  it("raises Ray's deep coverage to 32.2 % (+14.0)", () => {
    const p = person(after, RAY);
    expect(p.deepCoveragePct).toBe(32.2);
    expect(round1(p.deepCoveragePct! - person(before, RAY).deepCoveragePct!)).toBe(14.0);
  });

  it("leaves the SPOF set unchanged", () => {
    expect(spofSet(after)).toEqual(EXPECTED_SPOF);
  });

  it("makes Inconel 718 (46) Ray's top risk: the suggested next interview", () => {
    const p = person(after, RAY);
    expect(p.maxRiskTopicId).toBe(IN718);
    expect(p.maxRisk).toBe(46);
    expect(cell(after, RAY, IN718).risk).toBe(46);
    expect(cell(after, RAY, IN718).band).toBe("elevated");
    expect(topRiskTopics(after, RAY, 1)).toEqual([IN718]);
  });

  it("does not move the Inconel row (the new rule is filed under thin-wall, titanium and quoting)", () => {
    expect(cell(after, RAY, IN718).riskRaw).toBe(cell(before, RAY, IN718).riskRaw);
    expect(topic(after, IN718).coverage).toBe(topic(before, IN718).coverage);
  });
});

describe("invariants", () => {
  it("never lets pending cards change coverage or risk", () => {
    const approvedOnly = computeCoverage({ ...appendixAInput(), cards: appendixAInput().cards.filter((c) => c.status === "approved") });
    expect(scores(before)).toEqual(scores(approvedOnly));
    const wedm = cell(before, RAY, "t-m-wedm");
    expect(wedm.pendingPoints).toBeCloseTo(0.8, 12);
    expect(wedm.pendingCardIds).toEqual(["KC-011"]);
    expect(wedm.capturedPoints).toBe(0);
    expect(cell(before, RAY, "t-cus-05").pendingCardIds).toEqual(["KC-012"]);
  });

  it("never lets draft or pending copies of the scripted cards change anything", () => {
    for (const status of ["draft", "pending_review"] as const) {
      const pending = SCRIPTED_CARDS.map((c) => ({ ...c, status }));
      const r = computeCoverage(appendixAInput(pending));
      expect(scores(r)).toEqual(scores(before));
      expect(cell(r, RAY, TI).pendingPoints).toBeCloseTo(2.8, 12);
      expect(cell(r, RAY, TI).pendingCardIds).toEqual(["KC-091", "KC-092", "KC-094"]);
    }
  });

  it("ignores rejected and superseded cards entirely", () => {
    for (const status of ["rejected", "superseded"] as const) {
      const r = computeCoverage(appendixAInput(SCRIPTED_CARDS.map((c) => ({ ...c, status }))));
      expect(r).toEqual(before);
    }
  });

  it("never lowers coverage or raises risk when a card is approved", () => {
    const candidates: CoverageCard[] = [
      ...BEFORE_CARDS.filter((c) => c.status !== "approved"),
      ...SCRIPTED_CARDS.map((c) => ({ ...c, status: "pending_review" as const })),
    ];
    const base = appendixAInput(candidates.filter((c) => !BEFORE_CARDS.includes(c)));
    let prev = computeCoverage(base);
    const cards = base.cards.map((c) => ({ ...c }));
    for (const target of candidates) {
      const idx = cards.findIndex((c) => c.id === target.id);
      cards[idx] = { ...cards[idx], status: "approved" };
      const next = computeCoverage({ ...base, cards: cards.map((c) => ({ ...c })) });
      prev.topics.forEach((t, i) => {
        if (t.coverage !== null) expect(next.topics[i].coverage!).toBeGreaterThanOrEqual(t.coverage);
        expect(next.topics[i].risk).toBeLessThanOrEqual(t.risk);
      });
      prev.cells.forEach((c, i) => {
        expect(next.cells[i].captured).toBeGreaterThanOrEqual(c.captured);
        expect(next.cells[i].riskRaw).toBeLessThanOrEqual(c.riskRaw + 1e-12);
      });
      prev.people.forEach((p, i) => {
        if (p.capturedPct !== null) expect(next.people[i].capturedPct!).toBeGreaterThanOrEqual(p.capturedPct);
        if (p.deepCoveragePct !== null) expect(next.people[i].deepCoveragePct!).toBeGreaterThanOrEqual(p.deepCoveragePct);
      });
      prev = next;
    }
  });

  it("never lowers risk when someone's departure moves earlier", () => {
    for (const who of PERSON_IDS) {
      let later: CoverageResult | null = null;
      // Walk from far future to the past; every earlier date must give risk ≥ the later one.
      for (let d = 3650; d >= -400; d -= 45) {
        const input = appendixAInput(SCRIPTED_CARDS);
        input.people = input.people.map((p) => (p.id === who ? { ...p, plannedDepartureDate: addDays(DEMO_TODAY, d) } : p));
        const r = computeCoverage(input);
        if (later) {
          r.cells.forEach((c, i) => expect(c.riskRaw).toBeGreaterThanOrEqual(later!.cells[i].riskRaw));
        }
        later = r;
      }
      // Any planned date is at least as urgent as no date at all.
      const noDate = appendixAInput(SCRIPTED_CARDS);
      noDate.people = noDate.people.map((p) => (p.id === who ? { ...p, plannedDepartureDate: null } : p));
      const rNone = computeCoverage(noDate);
      rNone.cells.forEach((c, i) => expect(later!.cells[i].riskRaw).toBeGreaterThanOrEqual(c.riskRaw));
    }
  });

  it("moves Ray's retirement earlier and sees Titanium risk rise", () => {
    const input = appendixAInput();
    input.people = input.people.map((p) => (p.id === RAY ? { ...p, plannedDepartureDate: "2027-09-15" } : p));
    const r = computeCoverage(input);
    expect(person(r, RAY).monthsToDeparture).toBe(12);
    expect(cell(r, RAY, TI).risk).toBe(68); // 100 × 1 × 0.85 × 1 × 1 × 0.8
    expect(cell(r, RAY, TI).riskRaw).toBeGreaterThan(cell(before, RAY, TI).riskRaw);
  });

  it("emits one cell per non-zero matrix entry, ordered by topic then person", () => {
    const nonZero = EXPERTISE.filter((e) => e.level > 0);
    expect(before.cells).toHaveLength(nonZero.length);
    expect(before.cells.map((c) => cellKey(c.personId, c.topicId))).toEqual(nonZero.map((e) => cellKey(e.personId, e.topicId)));
    expect(before.cells.every((c) => c.level > 0)).toBe(true);
    expect(indexCells(before.cells).has(cellKey(TOMAS, TI))).toBe(false);
  });

  it("keeps every risk an integer in 0..100 and every capture in 0..1", () => {
    for (const r of [before, after]) {
      for (const c of r.cells) {
        expect(Number.isInteger(c.risk)).toBe(true);
        expect(c.risk).toBeGreaterThanOrEqual(0);
        expect(c.risk).toBeLessThanOrEqual(100);
        expect(c.risk).toBe(Math.round(c.riskRaw));
        expect(c.band).toBe(riskBand(c.risk));
        expect(c.captured).toBeGreaterThanOrEqual(0);
        expect(c.captured).toBeLessThanOrEqual(1);
      }
      for (const t of r.topics) {
        expect(t.coverage).not.toBeNull();
        expect(t.coverage!).toBeGreaterThanOrEqual(0);
        expect(t.coverage!).toBeLessThanOrEqual(100);
        expect(t.coverage).toBe(round1(t.coverage!));
      }
    }
  });

  it("is deterministic and does not mutate its input", () => {
    const input = appendixAInput(SCRIPTED_CARDS);
    const snapshot = JSON.parse(JSON.stringify(input)) as CoverageInput;
    const a = computeCoverage(input);
    const b = computeCoverage(input);
    expect(a).toEqual(b);
    expect(input).toEqual(snapshot);
  });

  it("does not depend on card order for any rounded score", () => {
    const input = appendixAInput(SCRIPTED_CARDS);
    const reversed = computeCoverage({ ...input, cards: [...input.cards].reverse() });
    expect(reversed.topics).toEqual(after.topics);
    expect(reversed.people).toEqual(after.people);
    reversed.cells.forEach((c, i) => {
      expect(c.risk).toBe(after.cells[i].risk);
      expect(c.spof).toBe(after.cells[i].spof);
    });
  });
});

describe("topic and person summaries", () => {
  it("reports mass, bench depth and topic risk", () => {
    const q = topic(before, QUOTING);
    expect(q.mass).toBe(7);
    expect(q.benchDepth).toBe(2); // Ray 3, Tomás 2
    expect(q.risk).toBe(30);
    expect(q.spofPersonId).toBeNull();
    expect(topic(before, "t-mat-6061").benchDepth).toBe(3);
    expect(topic(before, TI).benchDepth).toBe(1);
    expect(topic(before, "t-fai-cmm").risk).toBe(25); // Linda's 24.76 rounds to 25 (Watch)
    expect(topic(before, "t-fai-cmm").band).toBe("watch");
  });

  it("reports captured share over all held topics and deep coverage only over level-3 topics", () => {
    const maya = person(before, MAYA);
    expect(maya.deepCoveragePct).toBeNull();
    expect(maya.capturedPct).toBe(0);
    expect(maya.monthsToDeparture).toBeNull();
    expect(person(before, LINDA).deepCoveragePct).toBe(0);
    const ray = person(before, RAY);
    expect(ray.capturedPct).not.toBeNull();
    expect(ray.capturedPct!).toBeGreaterThan(0);
    expect(ray.tenureYears).toBeGreaterThan(31);
  });

  it("builds stable cell keys", () => {
    expect(cellKey("PER-01", "t-mat-ti64")).toBe("PER-01|t-mat-ti64");
    expect(cellKey("PER-01", "t-mat-ti64")).not.toBe(cellKey("PER-02", "t-mat-ti64"));
  });
});

describe("edge cases and input validation", () => {
  const people = [
    { id: "PER-A", hireDate: "2000-01-01", plannedDepartureDate: "2027-01-01" },
    { id: "PER-B", hireDate: "2020-01-01", plannedDepartureDate: null },
  ];

  it("returns null coverage and zero risk for a topic nobody holds", () => {
    const r = computeCoverage({
      demoToday: DEMO_TODAY,
      people,
      topics: [{ id: "t-x" }, { id: "t-empty" }],
      expertise: [{ personId: "PER-A", topicId: "t-x", level: 2 }],
      cards: [],
    });
    const empty = topic(r, "t-empty");
    expect(empty.coverage).toBeNull();
    expect(empty.mass).toBe(0);
    expect(empty.risk).toBe(0);
    expect(empty.band).toBe("low");
    expect(empty.benchDepth).toBe(0);
    const b = person(r, "PER-B");
    expect(b.capturedPct).toBeNull();
    expect(b.deepCoveragePct).toBeNull();
    expect(b.maxRisk).toBe(0);
    expect(b.maxRiskTopicId).toBeNull();
    expect(r.cells).toHaveLength(1);
  });

  it("caps capture at E and ignores cards credited to non-holders or unknown topics", () => {
    const many: CoverageCard[] = Array.from({ length: 20 }, (_, i) => ({
      id: `KC-${900 + i}`,
      sourcePersonId: "PER-A",
      type: "quoting_rule",
      confidence: "always",
      status: "approved",
      topicIds: ["t-x", "t-x", "t-unknown"],
    }));
    const r = computeCoverage({
      demoToday: DEMO_TODAY,
      people,
      topics: [{ id: "t-x" }],
      expertise: [
        { personId: "PER-A", topicId: "t-x", level: 1 },
        { personId: "PER-B", topicId: "t-x", level: 0 },
      ],
      cards: [
        ...many,
        { id: "KC-999", sourcePersonId: "PER-B", type: "setup_tip", confidence: "always", status: "approved", topicIds: ["t-x"] },
      ],
    });
    const c = cell(r, "PER-A", "t-x");
    expect(c.capturedPoints).toBe(20); // duplicate tag counted once per card
    expect(c.captured).toBe(1);
    expect(c.risk).toBe(0);
    expect(topic(r, "t-x").coverage).toBe(100);
    expect(r.cells).toHaveLength(1);
  });

  it("rejects duplicate or unknown IDs and out-of-range levels", () => {
    const base: CoverageInput = { demoToday: DEMO_TODAY, people, topics: [{ id: "t-x" }], expertise: [], cards: [] };
    expect(() => computeCoverage({ ...base, people: [...people, people[0]] })).toThrow(CoverageInputError);
    expect(() => computeCoverage({ ...base, topics: [{ id: "t-x" }, { id: "t-x" }] })).toThrow(CoverageInputError);
    expect(() =>
      computeCoverage({ ...base, expertise: [{ personId: "PER-Z", topicId: "t-x", level: 1 }] }),
    ).toThrow(/unknown person PER-Z/);
    expect(() =>
      computeCoverage({ ...base, expertise: [{ personId: "PER-A", topicId: "t-nope", level: 1 }] }),
    ).toThrow(/unknown topic t-nope/);
    expect(() =>
      computeCoverage({
        ...base,
        expertise: [
          { personId: "PER-A", topicId: "t-x", level: 1 },
          { personId: "PER-A", topicId: "t-x", level: 2 },
        ],
      }),
    ).toThrow(/Duplicate expertise/);
    expect(() =>
      computeCoverage({ ...base, expertise: [{ personId: "PER-A", topicId: "t-x", level: 4 as 3 }] }),
    ).toThrow(/out of range/);
  });
});
