/**
 * Knowledge Risk data layer (src/lib/data/risk.ts) against the real seeded database, plus the heat-map ramp and
 * copy helpers. Golden numbers: PLAN.md §6. Departure gate: PLAN.md §4.8 and docs/DATA-LAYER.md rule 4.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { CELL_RAMP, INK, REFERENCE_STEPS, WHITE, contrastRatio, rampIndex, relativeLuminance, textHex } from "@/components/risk/ramp";
import { cellAriaLabel, explainCell, metricDelta, spofSubline } from "@/components/risk/copy";
import { FOCUS_RING_PX, revealScrollLeft } from "@/components/risk/reveal";
import type { Db } from "@/db/client";
import { riskOverview, shortTopicLabel, tenureLabel, type RiskCellVM, type RiskOverviewVM } from "@/lib/data/risk";
import type { Role } from "@/lib/auth/roles";
import { addDays, demoClockIso } from "@/lib/time";
import { actorFor, seededDb } from "./helpers/seeded-db";

const RAY = "PER-01";
const TI = "t-mat-ti64";
const THIN = "t-thin-wall";
const QUOTING = "t-quoting";

function cellOf(vm: RiskOverviewVM, personId: string, topicId: string): RiskCellVM {
  const c = vm.cells.find((x) => x.personId === personId && x.topicId === topicId);
  if (!c) throw new Error(`no cell ${personId} ${topicId}`);
  return c;
}
function topicOf(vm: RiskOverviewVM, topicId: string) {
  const t = vm.topics.find((x) => x.id === topicId);
  if (!t) throw new Error(`no topic ${topicId}`);
  return t;
}
function spofSet(vm: RiskOverviewVM): string[] {
  return vm.cells.filter((c) => c.spof).map((c) => `${c.personId}|${c.topicId}`).sort();
}

/** Insert a card by copying KC-001's row with overrides, plus its topic tags (the scripted cards aren't seeded). */
function addCard(
  sqlite: Database.Database,
  id: string,
  o: { type: string; confidence: string; status: string; topics: string[]; approvedOn: string | null; personId?: string },
): void {
  const cols = (sqlite.prepare("PRAGMA table_info(knowledge_cards)").all() as { name: string }[]).map((c) => c.name);
  const overrides: Record<string, string | null> = {
    id,
    type: o.type,
    expert_confidence: o.confidence,
    status: o.status,
    approved_on: o.approvedOn,
    source_person_id: o.personId ?? RAY,
    supersedes_id: null,
    script_key: "demo:ray-live",
  };
  const select = cols.map((c) => (c in overrides ? `@${c}` : c)).join(", ");
  sqlite.prepare(`INSERT INTO knowledge_cards (${cols.join(", ")}) SELECT ${select} FROM knowledge_cards WHERE id = 'KC-001'`).run(overrides);
  for (const t of o.topics) sqlite.prepare("INSERT INTO card_topics (card_id, topic_id) VALUES (?, ?)").run(id, t);
}

/** A factor's number when the payload carries one (a bare number or a visible Gated value), else null. */
function factorNumber(x: unknown): number | null {
  if (typeof x === "number") return x;
  if (x && typeof x === "object" && (x as { hidden?: unknown }).hidden === false) {
    const v = (x as { value?: unknown }).value;
    return typeof v === "number" ? v : null;
  }
  return null;
}

/**
 * The range of U a cell's shown numbers allow: risk = round(100 × (E/3) × (1 − f) × U × T × D), so
 * U ∈ [(risk − 0.5), (risk + 0.5)] ÷ (100 × E/3 × (1 − f) × T × D). Null when T or D isn't in the payload (the
 * departure factor can't be solved for). This is the attack a machinist could run against the cell sheet.
 */
function solveU(c: RiskCellVM): [number, number] | null {
  const T = factorNumber(c.factors.T);
  const D = factorNumber(c.factors.D);
  if (T === null || D === null) return null;
  const rest = 100 * (c.level / 3) * (1 - c.capturedPct / 100) * T * D;
  if (!(rest > 0)) return null;
  return [(c.risk - 0.5) / rest, (c.risk + 0.5) / rest];
}

/** Every key path in a JSON value, with the leaf value. */
function walk(value: unknown, path: string[] = [], out: { path: string[]; value: unknown }[] = []) {
  out.push({ path, value });
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...path, String(i)], out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, [...path, k], out);
  return out;
}

describe("riskOverview on the seeded database", () => {
  let db: Db;
  let sqlite: Database.Database;
  let owner: RiskOverviewVM;

  beforeAll(() => {
    ({ db, sqlite } = seededDb());
    owner = riskOverview(db, actorFor("owner"));
  });
  afterAll(() => sqlite.close());

  it("reproduces the golden numbers (PLAN.md §6, before step 2)", () => {
    const ti = cellOf(owner, RAY, TI);
    expect(ti.risk).toBe(57);
    expect(ti.band).toBe("high");
    expect(ti.level).toBe(3);
    expect(ti.capturedPct).toBe(15);
    expect(ti.approvedCardIds).toEqual(["KC-001", "KC-002"]);
    expect(ti.factors).toEqual({ U: { hidden: false, value: 0.83 }, T: { hidden: false, value: 1 }, D: { hidden: false, value: 0.8 }, B: 1 });
    const thin = cellOf(owner, RAY, THIN);
    expect(thin.risk).toBe(57);
    expect(thin.band).toBe("high");
    expect(cellOf(owner, RAY, QUOTING).risk).toBe(30);
    expect(topicOf(owner, TI).coverage).toBe(14.0);
    expect(topicOf(owner, THIN).coverage).toBe(13.0);
    expect(owner.people.find((p) => p.id === RAY)!.deepCoveragePct).toBe(18.2);
  });

  it("flags exactly two single points of failure: Ray × Titanium and Ray × Thin-wall", () => {
    expect(spofSet(owner)).toEqual([`${RAY}|${TI}`, `${RAY}|${THIN}`].sort());
    expect(owner.topics.filter((t) => t.spofPersonId !== null).map((t) => t.id).sort()).toEqual([TI, THIN].sort());
    expect(owner.kpis.spof.count).toBe(2);
    expect(owner.kpis.spof.holders.map((h) => [h.personId, h.topics])).toEqual([[RAY, 2]]);
  });

  it("puts both High rows first (highest risk first, ties by topic order) and Ray in the first column", () => {
    expect(owner.riskFirstOrder.slice(0, 2)).toEqual([THIN, TI]);
    expect(owner.riskFirstOrder).toHaveLength(28);
    expect(new Set(owner.riskFirstOrder).size).toBe(28);
    const risks = owner.riskFirstOrder.map((id) => topicOf(owner, id).risk);
    expect(risks).toEqual([...risks].sort((a, b) => b - a));
    expect(owner.topics.filter((t) => t.band === "high").map((t) => t.id).sort()).toEqual([TI, THIN].sort());
    expect(owner.people[0]!.id).toBe(RAY);
    expect(owner.people).toHaveLength(8);
    const contributions = owner.people.map((p) => p.contribution);
    expect(contributions).toEqual([...contributions].sort((a, b) => b - a));
    const sum = owner.cells.filter((c) => c.personId === RAY).reduce((s, c) => s + c.risk, 0);
    expect(owner.people[0]!.contribution).toBe(sum);
  });

  it("builds the KPI row and a baseline with no changes right after a reset", () => {
    expect(owner.kpis.highRisk).toEqual({ count: 2, countBefore: 2, topicIds: [THIN, TI] });
    expect(owner.kpis.departing).toEqual({
      hidden: false,
      value: { count: 1, windowMonths: 24, people: [{ personId: RAY, fullName: "Ray Delgado", months: 20, kind: "retirement" }] },
    });
    expect(owner.kpis.approvedRecent).toEqual({ count: 12, windowDays: 30, since: "2026-08-17" });
    expect(owner.baseline).toEqual({ available: true, hasChanges: false });
    for (const c of owner.cells) {
      expect(c.before, `${c.personId}|${c.topicId}`).toEqual({ risk: c.risk, band: c.band, capturedPct: c.capturedPct });
    }
    for (const t of owner.topics) {
      expect(t.coverageBefore).toBe(t.coverage);
      expect(t.spofPersonIdBefore).toBe(t.spofPersonId);
    }
  });

  it("gives owner and quoter the departure chip data (months and kind)", () => {
    for (const role of ["owner", "quoter"] as const) {
      const vm = role === "owner" ? owner : riskOverview(db, actorFor("quoter", "PER-05"));
      const ray = vm.people.find((p) => p.id === RAY)!;
      expect(ray.departure).toEqual({ hidden: false, value: { months: 20, kind: "retirement" } });
      expect(ray.tenureLabel).toBe("31 yrs");
      expect(vm.people.find((p) => p.id === "PER-02")!.departure).toEqual({ hidden: false, value: null });
      expect(spofSubline(vm.kpis.spof)).toBe("both Ray Delgado, retiring in 20 months");
    }
  });

  it("is plain serializable data and carries a classification on every card it links to", () => {
    expect(JSON.parse(JSON.stringify(owner))).toEqual(owner);
    const linked = new Set(owner.cells.flatMap((c) => c.approvedCardIds));
    expect(Object.keys(owner.cards).sort()).toEqual([...linked].sort());
    for (const card of Object.values(owner.cards)) expect(["general", "internal", "customer_confidential", "export_controlled"]).toContain(card.classification);
  });

  it.each(["machinist", "trainee"] as const)("sends %s no departure date, months, departure kind, U value or retirement chip data", (role: Role) => {
    const vm = riskOverview(db, actorFor(role, role === "machinist" ? "PER-02" : "PER-06"));
    const json = JSON.stringify(vm);
    for (const date of ["2028-05-15", "2029-11-15", "2031-01-15"]) expect(json).not.toContain(date);
    expect(json).not.toMatch(/retire/i);
    expect(json).not.toContain("retirement");
    expect(json).not.toMatch(/"(months|monthsToDeparture|plannedDepartureDate|departureKind|kind|windowMonths)"/);

    // Every gated field is the Hidden shape and nothing else.
    for (const p of vm.people) expect(p.departure).toEqual({ hidden: true, label: `Hidden for ${role === "machinist" ? "Machinist" : "Trainee"} role` });
    for (const h of vm.kpis.spof.holders) expect(h.departure.hidden).toBe(true);
    expect(vm.kpis.departing).toEqual({ hidden: true, label: expect.any(String) });
    // U, and the tenure and backup factors T and D that would reveal it (risk ÷ the others = U), are all hidden.
    const hiddenPill = { hidden: true, label: `Hidden for ${role === "machinist" ? "Machinist" : "Trainee"} role` };
    for (const c of vm.cells) {
      expect(c.factors, `${c.personId}|${c.topicId}`).toEqual({ U: hiddenPill, T: hiddenPill, D: hiddenPill, B: expect.any(Number) });
    }

    // Deep scan: no numeric value lives under a U / T / D factor key or any departure-ish key.
    const GATED_FACTORS = new Set(["U", "T", "D"]);
    for (const { path, value } of walk(vm)) {
      const key = path[path.length - 1] ?? "";
      const underFactor = path.some((seg, i) => i > 0 && path[i - 1] === "factors" && GATED_FACTORS.has(seg));
      if (underFactor || /depart/i.test(path.join("."))) {
        if (key !== "hidden" && key !== "label" && !GATED_FACTORS.has(key) && !/depart/i.test(key)) throw new Error(`leak at ${path.join(".")}`);
        if (typeof value === "number") throw new Error(`numeric value at ${path.join(".")}`);
      }
    }
    // The owner's U for Ray (0.83) never appears as a value.
    expect(json).not.toMatch(/"value":0\.83/);

    // Risk stays visible, and the column order is the same as the owner's (not a hidden-field sort).
    expect(cellOf(vm, RAY, TI).risk).toBe(57);
    expect(vm.people.map((p) => p.id)).toEqual(owner.people.map((p) => p.id));
    expect(vm.riskFirstOrder).toEqual(owner.riskFirstOrder);
    // The SPOF tile keeps the count and the holder, without a departure.
    expect(spofSubline(vm.kpis.spof)).toBe("both Ray Delgado");
  });

  it.each(["machinist", "trainee"] as const)("gives %s no cell from which the departure factor U can be solved", (role: Role) => {
    // Positive control: with the owner's payload the solver pins Ray's exact U (1 − (20 − 12)/48, 20 months out) to
    // a range under 0.02 wide — the leak the finding measured.
    const ownerRange = solveU(cellOf(owner, RAY, TI));
    expect(ownerRange).not.toBeNull();
    expect(ownerRange![0]).toBeLessThanOrEqual(1 - 8 / 48);
    expect(ownerRange![1]).toBeGreaterThanOrEqual(1 - 8 / 48);
    expect(ownerRange![1] - ownerRange![0]).toBeLessThan(0.02);
    expect(owner.cells.every((c) => solveU(c) !== null)).toBe(true);

    const vm = riskOverview(db, actorFor(role, role === "machinist" ? "PER-02" : "PER-06"));
    for (const c of vm.cells) {
      expect(solveU(c), `${c.personId}|${c.topicId}`).toBeNull();
      // No restricted cell carries level, capturedPct, T, D and risk all as numbers.
      const all = [c.level, c.capturedPct, c.factors.T, c.factors.D, c.risk].every((x) => typeof x === "number");
      expect(all, `${c.personId}|${c.topicId}`).toBe(false);
    }
  });
});

describe("delta mode after Ray approves KC-091…094 (PLAN.md §6 'after' column)", () => {
  let db: Db;
  let sqlite: Database.Database;
  let vm: RiskOverviewVM;

  beforeAll(() => {
    const s = seededDb();
    db = s.db;
    sqlite = s.sqlite;
    // Runtime approvals write the demo clock (PLAN.md §5.1): DEMO_TODAY's date plus the real time of day.
    const approvedOn = demoClockIso(s.bundle.demoToday, new Date("2026-09-29T14:03:12.000Z"));
    addCard(sqlite, "KC-091", { type: "quoting_rule", confidence: "always", status: "approved", topics: [THIN, TI, QUOTING], approvedOn });
    addCard(sqlite, "KC-092", { type: "setup_tip", confidence: "always", status: "approved", topics: [THIN, TI, "t-m-dmu50"], approvedOn });
    addCard(sqlite, "KC-093", { type: "customer_quirk", confidence: "always", status: "approved", topics: ["t-cus-01", "t-fai-cmm"], approvedOn });
    addCard(sqlite, "KC-094", { type: "failure_story", confidence: "not_stated", status: "approved", topics: [THIN, TI, "t-cus-01"], approvedOn });
    vm = riskOverview(db, actorFor("quoter", "PER-05"));
  });
  afterAll(() => sqlite.close());

  it("moves Ray × Titanium 57 → 41 (−16) and coverage 14.0 → 28.0 against the seeded baseline", () => {
    const ti = cellOf(vm, RAY, TI);
    expect(ti.risk).toBe(41);
    expect(ti.band).toBe("elevated");
    expect(ti.before).toMatchObject({ risk: 57, band: "high", capturedPct: 15 });
    expect(metricDelta(ti, "risk")).toBe(-16);
    expect(metricDelta(ti, "expertise")).toBe(0);
    expect(metricDelta(ti, "captured")).toBe(23);
    expect(cellOf(vm, RAY, THIN).risk).toBe(41);
    expect(cellOf(vm, RAY, QUOTING).risk).toBe(26);
    expect(topicOf(vm, TI)).toMatchObject({ coverage: 28.0, coverageBefore: 14.0, band: "elevated", bandBefore: "high" });
    expect(topicOf(vm, THIN)).toMatchObject({ coverage: 27.0, coverageBefore: 13.0 });
    const ray = vm.people.find((p) => p.id === RAY)!;
    expect(ray.deepCoveragePct).toBe(32.2);
    expect(ray.deepCoveragePctBefore).toBe(18.2);
    expect(vm.baseline.hasChanges).toBe(true);
  });

  it("updates the KPIs and keeps the SPOF set (f is still under 50 %)", () => {
    expect(vm.kpis.highRisk).toMatchObject({ count: 0, countBefore: 2 });
    expect(spofSet(vm)).toEqual([`${RAY}|${TI}`, `${RAY}|${THIN}`].sort());
    expect(vm.kpis.approvedRecent.count).toBe(16);
    expect(vm.cards["KC-094"]).toMatchObject({ id: "KC-094", type: "failure_story" });
  });

  it("never lets a pending draft change coverage or risk", () => {
    const before = riskOverview(db, actorFor("owner"));
    addCard(sqlite, "KC-201", { type: "quoting_rule", confidence: "always", status: "pending_review", topics: [TI], approvedOn: null });
    const after = riskOverview(db, actorFor("owner"));
    expect(cellOf(after, RAY, TI).risk).toBe(cellOf(before, RAY, TI).risk);
    expect(topicOf(after, TI).coverage).toBe(topicOf(before, TI).coverage);
    expect(cellOf(after, RAY, TI).pendingCount).toBe(cellOf(before, RAY, TI).pendingCount + 1);
  });
});

describe("'Cards approved, last 30 days' KPI", () => {
  it("counts seeded YYYY-MM-DD dates and runtime demo-clock ISO timestamps alike, window edges included", () => {
    const { db, sqlite, bundle } = seededDb();
    try {
      const today = bundle.demoToday;
      const base = riskOverview(db, actorFor("owner")).kpis.approvedRecent;
      expect(base.count).toBe(12);
      const since = base.since;
      const card = (id: string, approvedOn: string) =>
        addCard(sqlite, id, { type: "setup_tip", confidence: "usually", status: "approved", topics: [], approvedOn });
      card("KC-301", today); // bare date, today: counted
      card("KC-302", `${today}T14:03:12.000Z`); // demo-clock ISO, today: counted
      card("KC-303", `${today}T23:59:59.999Z`); // last instant of today: counted
      card("KC-304", `${since}T00:00:00.000Z`); // first day of the window: counted
      card("KC-305", `${addDays(since, -1)}T23:59:59.999Z`); // the day before the window: not counted
      card("KC-306", `${addDays(today, 1)}T00:00:00.000Z`); // after demo today: not counted
      expect(riskOverview(db, actorFor("owner")).kpis.approvedRecent).toEqual({ ...base, count: 16 });
    } finally {
      sqlite.close();
    }
  });
});

describe("heat-map focus reveal (cells never land under the sticky Topic column)", () => {
  it("scrolls a cell hidden under the sticky column back into view, clear of its focus ring", () => {
    // Measured at 390×844: Linda × 6061 spans x 68–151 at scrollLeft 228; the sticky column ends at 141.
    const next = revealScrollLeft({ scrollLeft: 228, cellLeft: 68, cellRight: 151, stickyRight: 141, viewRight: 373 });
    expect(next).not.toBeNull();
    expect(68 + (228 - next!)).toBeGreaterThanOrEqual(141 + FOCUS_RING_PX);
    expect(151 + (228 - next!)).toBeLessThanOrEqual(373 - FOCUS_RING_PX);
  });

  it("scrolls a cell past the right edge into view", () => {
    const next = revealScrollLeft({ scrollLeft: 0, cellLeft: 340, cellRight: 423, stickyRight: 141, viewRight: 373 });
    expect(next).toBe(423 - (373 - FOCUS_RING_PX));
  });

  it("leaves a fully visible cell alone", () => {
    expect(revealScrollLeft({ scrollLeft: 50, cellLeft: 150, cellRight: 233, stickyRight: 141, viewRight: 373 })).toBeNull();
    expect(revealScrollLeft({ scrollLeft: 0, cellLeft: 145, cellRight: 369, stickyRight: 141, viewRight: 373 })).toBeNull();
  });

  it("rounds away from the obscured side (device-pixel snapping can't leave the cell a fraction under) and never goes below 0", () => {
    const left = revealScrollLeft({ scrollLeft: 228.4, cellLeft: 67.6, cellRight: 150.6, stickyRight: 141.3, viewRight: 373 })!;
    expect(Number.isInteger(left)).toBe(true);
    expect(67.6 + (228.4 - left)).toBeGreaterThanOrEqual(141.3 + FOCUS_RING_PX);
    const right = revealScrollLeft({ scrollLeft: 10.2, cellLeft: 300.5, cellRight: 383.5, stickyRight: 141, viewRight: 373.3 })!;
    expect(Number.isInteger(right)).toBe(true);
    expect(383.5 - (right - 10.2)).toBeLessThanOrEqual(373.3 - FOCUS_RING_PX);
    // Revealing the first column from a small offset returns all the way to 0.
    expect(revealScrollLeft({ scrollLeft: 3, cellLeft: 143, cellRight: 226, stickyRight: 141, viewRight: 373 })).toBe(0);
    expect(revealScrollLeft({ scrollLeft: 400, cellLeft: -300, cellRight: -217, stickyRight: 141, viewRight: 373 })).toBe(0);
  });
});

describe("heat-map ramp", () => {
  it("uses the 13 dataviz reference steps and skips 450 for cell fills", () => {
    expect(REFERENCE_STEPS.map((s) => s.hex)).toEqual([
      "#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b",
    ]);
    expect(CELL_RAMP).toHaveLength(12);
    expect(CELL_RAMP.map((s) => s.step)).not.toContain(450);
    // Why 450 is skipped: neither text color reaches 4.5:1 on it.
    expect(contrastRatio(INK, "#2a78d6")).toBeLessThan(4.5);
    expect(contrastRatio(WHITE, "#2a78d6")).toBeLessThan(4.5);
    for (const s of CELL_RAMP) expect(REFERENCE_STEPS.find((r) => r.step === s.step)?.hex).toBe(s.hex);
  });

  it("prints every cell number at ≥ 4.5:1 (ink or white chosen per step)", () => {
    for (const s of CELL_RAMP) {
      const ratio = contrastRatio(textHex(s), s.hex);
      expect(ratio, `step ${s.step} ${s.text}`).toBeGreaterThanOrEqual(4.5);
      // The chosen color is the better of the two.
      expect(ratio).toBeGreaterThanOrEqual(contrastRatio(s.text === "ink" ? WHITE : INK, s.hex));
    }
  });

  it("is monotone: lighter to darker, and higher values never map to a lighter step", () => {
    const lum = CELL_RAMP.map((s) => relativeLuminance(s.hex));
    for (let i = 1; i < lum.length; i++) expect(lum[i]).toBeLessThan(lum[i - 1]!);
    let prev = -1;
    for (let v = 0; v <= 100; v++) {
      const i = rampIndex(v, 100);
      expect(i).toBeGreaterThanOrEqual(prev);
      prev = i;
    }
    expect(rampIndex(0, 100)).toBe(0);
    expect(rampIndex(100, 100)).toBe(11);
    expect(rampIndex(3, 3)).toBe(11);
    expect(rampIndex(-5, 100)).toBe(0);
    expect(rampIndex(Number.NaN, 100)).toBe(0);
  });
});

describe("risk copy helpers", () => {
  it("explains a cell without departure information", () => {
    expect(explainCell("Ray", "Titanium", { level: 3, approvedCardIds: ["KC-001", "KC-002"], capturedPct: 15 })).toBe(
      "Ray holds deep knowledge of Titanium · 2 approved cards · 15 % captured",
    );
    expect(explainCell("Marv", "Titanium", { level: 1, approvedCardIds: ["KC-021"], capturedPct: 25 })).toBe(
      "Marv has working knowledge of Titanium · 1 approved card · 25 % captured",
    );
  });

  it("names cells for assistive tech: person, topic, metric value and band", () => {
    const cell: RiskCellVM = {
      personId: RAY,
      topicId: TI,
      level: 3,
      risk: 41,
      band: "elevated",
      spof: true,
      capturedPct: 38.3,
      capturedPoints: 4.6,
      approvedCardIds: [],
      pendingCount: 0,
      factors: {
        U: { hidden: true, label: "Hidden for Machinist role" },
        T: { hidden: true, label: "Hidden for Machinist role" },
        D: { hidden: true, label: "Hidden for Machinist role" },
        B: 1,
      },
      before: { risk: 57, band: "high", capturedPct: 15 },
    };
    const base = { personName: "Ray Delgado", topicShortLabel: "Titanium", cell };
    expect(cellAriaLabel({ ...base, metric: "risk", view: "before", showDelta: false })).toBe("Ray Delgado, Titanium: risk 57, High");
    expect(cellAriaLabel({ ...base, metric: "risk", view: "now", showDelta: true })).toBe("Ray Delgado, Titanium: risk 41, Elevated, down 16 since the last reset");
    expect(cellAriaLabel({ ...base, metric: "expertise", view: "now", showDelta: true })).toBe("Ray Delgado, Titanium: expertise level 3 (deep)");
    expect(cellAriaLabel({ ...base, metric: "captured", view: "now", showDelta: false })).toBe("Ray Delgado, Titanium: 38 % captured");
  });

  it("formats labels: short topic names and tenure", () => {
    expect(shortTopicLabel("Titanium (Ti-6Al-4V)")).toBe("Titanium");
    expect(shortTopicLabel("First article (AS9102) & CMM inspection")).toBe("First article (AS9102) & CMM inspection");
    expect(shortTopicLabel("Thin-wall & low-rigidity parts")).toBe("Thin-wall & low-rigidity parts");
    expect(tenureLabel("1995-06-05", "2026-09-15")).toBe("31 yrs");
    expect(tenureLabel("2025-07-14", "2026-09-15")).toBe("1 yr");
    expect(tenureLabel("2026-01-12", "2026-09-15")).toBe("8 mo");
  });
});
