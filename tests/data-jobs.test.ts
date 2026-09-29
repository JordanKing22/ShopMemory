/**
 * Jobs and quotes data layer (src/lib/data/jobs.ts) against the real schema and seed: list order and filters, the
 * quoted-vs-actual anchors (PLAN.md §7.6), and the role gates (PLAN.md §4.8, docs/DATA-LAYER.md rules 2–4):
 * machinist and trainee view models carry no quote_financials value, no outcome and no lost reason, and
 * quote_financials is never even queried for them.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { jobDetail, jobsHref, jobsPage, listJobs, parseJobFilters, type JobDetailVM } from "@/lib/data/jobs";
import { formatHours, formatSignedPct } from "@/lib/format";
import type { Role } from "@/lib/auth/roles";
import { actorFor, seededDb, type SeededDb } from "./helpers/seeded-db";

let s: SeededDb;
beforeAll(() => {
  s = seededDb();
});
afterAll(() => {
  s.sqlite.close();
});

const owner = actorFor("owner");
const quoter = actorFor("quoter", "PER-05");
const machinist = actorFor("machinist", "PER-02");
const trainee = actorFor("trainee", "PER-06");
const CLEARED: [string, { role: Role; personId: string | null }][] = [
  ["owner", owner],
  ["quoter", quoter],
];
const UNCLEARED: [string, { role: Role; personId: string | null }][] = [
  ["machinist", machinist],
  ["trainee", trainee],
];

const OUTCOME_VALUES = new Set(["won", "lost", "no_bid", "pending"]);
const OUTCOME_KEYS = new Set(["outcomeLabel", "lostReason", "lostReasonLabel"]);

/** Every [key, value] pair anywhere in a JSON-able value. */
function walk(v: unknown, visit: (key: string, value: unknown) => void, key = ""): void {
  visit(key, v);
  if (Array.isArray(v)) v.forEach((x) => walk(x, visit, key));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, visit, k);
}

/** Financial values of a quote, straight from the table (the test may read it; the data layer may not for some roles). */
function financialValues(quoteId: string): number[] {
  const row = s.sqlite
    .prepare(
      "select shop_rate_usd_per_hr a, material_cost_usd b, outside_processing_usd c, risk_adder_hours d, scrap_allowance_pct e, unit_price_usd f, total_price_usd g, target_margin_pct h from quote_financials where quote_id = ?",
    )
    .get(quoteId) as Record<string, number>;
  return Object.values(row);
}

function allPriceStrings(): string[] {
  const rows = s.sqlite.prepare("select unit_price_usd u, total_price_usd t, material_cost_usd m, shop_rate_usd_per_hr r from quote_financials").all() as Record<
    string,
    number
  >[];
  // Distinctive decimal amounts only (small integers such as 22 or 110 also appear as ordinary numbers elsewhere).
  return [...new Set(rows.flatMap((r) => [r.u, r.t]).filter((n) => !Number.isInteger(n)).map(String))];
}

describe("listJobs / jobsPage", () => {
  it("lists all 120 quotes plus the 4 internal work orders, newest first", () => {
    const rows = listJobs(s.db, owner);
    expect(rows).toHaveLength(124);
    expect(rows.filter((r) => r.kind === "internal")).toHaveLength(4);
    expect(rows.filter((r) => r.kind === "quote")).toHaveLength(120);
    const dates = rows.map((r) => r.date ?? "");
    expect([...dates].sort().reverse()).toEqual(dates);
    // Row IDs: the job when one exists, else the quote.
    expect(rows.find((r) => r.id === "J-A03")?.quoteId).toBe("Q-A03");
    expect(rows.find((r) => r.id === "Q-A01")?.jobId).toBeNull();
    expect(rows.some((r) => r.id === "Q-A03")).toBe(false);
    expect(new Set(rows.map((r) => r.id)).size).toBe(124);
    for (const r of rows) expect(["general", "internal", "customer_confidential", "export_controlled"]).toContain(r.classification);
  });

  it("shows J-A03's hours and signed variance in the row", () => {
    const row = listJobs(s.db, machinist).find((r) => r.id === "J-A03");
    expect(row).toMatchObject({ quotedHours: 27, actualHours: 41.5, variancePct: 53.7, status: "complete", customerName: "Aerovance" });
    expect(row?.quotedBy).toEqual({ id: "PER-05", name: "Maya Chen" });
    expect(formatSignedPct(row?.variancePct)).toBe("+53.7 %");
  });

  it("never carries prices in the list, for any role", () => {
    const prices = allPriceStrings();
    expect(prices.length).toBeGreaterThan(50);
    for (const actor of [owner, quoter, machinist, trainee]) {
      const vm = jobsPage(s.db, actor, {});
      const json = JSON.stringify(vm);
      for (const p of prices) expect(json).not.toContain(p);
      // No financial field names (the lost-reason label "Price" is a word, not an amount, so check keys).
      walk(vm, (key) => expect(key).not.toMatch(/price|margin|shopRate|materialCost|outsideProcessing|riskAdder|scrapAllowance|financial/i));
    }
  });

  it.each(CLEARED)("%s sees outcomes and can filter by them", (_name, actor) => {
    const vm = jobsPage(s.db, actor, { outcome: "lost" });
    expect(vm.showOutcome).toBe(true);
    expect(vm.outcomeHiddenLabel).toBeNull();
    expect(vm.filterGroups.map((g) => g.key)).toContain("outcome");
    expect(vm.rows).toHaveLength(42);
    for (const r of vm.rows) expect(r.outcome).toMatchObject({ hidden: false, value: { outcome: "lost" } });
    const a01 = listJobs(s.db, actor).find((r) => r.id === "Q-A01");
    expect(a01?.outcome).toEqual({ hidden: false, value: { outcome: "pending", outcomeLabel: "Pending", lostReason: null, lostReasonLabel: null } });
    expect(vm.activeFilters).toEqual([{ key: "outcome", label: "Outcome", valueLabel: "Lost", removeHref: "/jobs" }]);
  });

  it.each(UNCLEARED)("%s: outcome hidden in every row, not offered as a filter, and ignored in the URL", (_name, actor) => {
    const vm = jobsPage(s.db, actor, { outcome: "lost" });
    expect(vm.showOutcome).toBe(false);
    expect(vm.outcomeHiddenLabel).toMatch(/^Hidden for (Machinist|Trainee) role$/);
    expect(vm.filterGroups.map((g) => g.key)).not.toContain("outcome");
    expect(vm.activeFilters).toEqual([]);
    expect(vm.rows).toHaveLength(124);
    for (const r of vm.rows) {
      if (r.kind === "internal") expect(r.outcome).toBeNull();
      else expect(r.outcome).toEqual({ hidden: true, label: vm.outcomeHiddenLabel });
    }
    walk(vm, (key, value) => {
      expect(OUTCOME_KEYS.has(key), `key ${key}`).toBe(false);
      if (typeof value === "string") expect(OUTCOME_VALUES.has(value), `${key}=${value}`).toBe(false);
    });
    expect(parseJobFilters(s.db, actor, { outcome: "won", status: "complete" })).toEqual({ status: "complete" });
  });

  it("status is job-derived: pending, lost and no-bid quotes all read 'No job'", () => {
    const rows = listJobs(s.db, machinist, { status: "no_job" });
    expect(rows).toHaveLength(50); // 42 lost + 5 no-bid + 3 pending
    expect(new Set(rows.map((r) => r.statusLabel))).toEqual(new Set(["No job"]));
    expect(listJobs(s.db, owner, { status: "in_process" })).toHaveLength(4);
  });

  it("filters by customer (incl. internal), person (quoted by or led), machine and classification", () => {
    expect(listJobs(s.db, owner, { customer: "internal" }).map((r) => r.id).sort()).toEqual(["J-I01", "J-I02", "J-I03", "J-I04"]);
    const cus05 = listJobs(s.db, owner, { customer: "CUS-05" });
    expect(cus05.length).toBeGreaterThan(0);
    expect(cus05.every((r) => r.customerName === "Graymoor Defense Systems")).toBe(true);

    const ray = listJobs(s.db, owner, { person: "PER-01" });
    expect(ray.map((r) => r.id)).toEqual(expect.arrayContaining(["Q-A01", "J-A02", "J-A04", "J-A10"]));
    // Marv led J-A03 (quoted by Maya), so it matches his person filter but not Ray's.
    expect(listJobs(s.db, owner, { person: "PER-02" }).map((r) => r.id)).toContain("J-A03");
    expect(ray.map((r) => r.id)).not.toContain("J-A03");

    const dmu = listJobs(s.db, owner, { machine: "m-dmu50" });
    expect(dmu.map((r) => r.id)).toEqual(expect.arrayContaining(["Q-A01", "J-A02", "J-A03", "J-A04"]));

    const ec = listJobs(s.db, owner, { classification: "export_controlled" });
    expect(ec.length).toBe(30);
    expect(ec.every((r) => r.classification === "export_controlled")).toBe(true);
    expect(ec.map((r) => r.id)).toContain("J-A10");
  });

  it("drops unknown filter values and builds stable hrefs", () => {
    expect(parseJobFilters(s.db, owner, { customer: "CUS-99", machine: ["m-dmu50", "m-vf4"], status: "bogus", person: "" })).toEqual({ machine: "m-dmu50" });
    expect(jobsHref({ status: "complete", customer: "CUS-01" })).toBe("/jobs?customer=CUS-01&status=complete");
    expect(jobsHref({})).toBe("/jobs");
    const vm = jobsPage(s.db, owner, { customer: "CUS-01", status: "complete" });
    expect(vm.activeFilters.map((f) => [f.key, f.valueLabel, f.removeHref])).toEqual([
      ["customer", "Aerovance", "/jobs?status=complete"],
      ["status", "Complete", "/jobs?customer=CUS-01"],
    ]);
    expect(vm.totalCount).toBe(124);
  });
});

describe("jobDetail", () => {
  it("J-A03: the job that went sideways, 27 → 41.5 h, +53.7 %", () => {
    const vm = jobDetail(s.db, machinist, "J-A03") as JobDetailVM;
    expect(vm).not.toBeNull();
    expect(vm.kind).toBe("quote_and_job");
    expect(vm.title).toBe("Job RJ-26-0420");
    expect(vm.hours).toMatchObject({ state: "complete", quotedHours: 27, actualHours: 41.5, variancePct: 53.7, deltaHours: 14.5, quotedSetupHours: 4, quotedRunHours: 23, actualSetupHours: 5.5, actualRunHours: 36 });
    expect(`${formatHours(vm.hours.quotedHours)} → ${formatHours(vm.hours.actualHours)}, ${formatSignedPct(vm.hours.variancePct)}`).toBe("27.0 h → 41.5 h, +53.7 %");
    expect(vm.quote?.quotedBy).toEqual({ id: "PER-05", name: "Maya Chen" });
    expect(vm.job).toMatchObject({ jobNumber: "RJ-26-0420", scrapQty: 4, ncrCount: 1, onTime: false, lead: { id: "PER-02", name: "Marv Tollefson" } });
    expect(vm.job?.machine?.id).toBe("m-dmu50");
    expect(vm.part).toMatchObject({ partNumber: "AV-2107-11", materialName: "Ti-6Al-4V (Grade 5)" });
    expect(vm.customer).toMatchObject({ name: "Aerovance", qualityRequirements: expect.stringContaining("AS9102") });
    expect(vm.judgmentDrivers.map((d) => d.key)).toEqual(["thin_wall", "titanium", "five_axis", "first_article"]);
    expect(vm.linkedCards.map((c) => c.id)).toContain("KC-034");
    expect(vm.classification).toBe("customer_confidential");
  });

  it("a quote ID with a job resolves to the same page as the job", () => {
    const byQuote = jobDetail(s.db, owner, "Q-A03");
    const byJob = jobDetail(s.db, owner, "J-A03");
    expect(byQuote?.id).toBe("J-A03");
    expect(byQuote).toEqual(byJob);
  });

  it("Q-A01 (pending, no job) still has a page", () => {
    const vm = jobDetail(s.db, owner, "Q-A01") as JobDetailVM;
    expect(vm.kind).toBe("quote_only");
    expect(vm.id).toBe("Q-A01");
    expect(vm.title).toBe("Quote RQ-26-0911");
    expect(vm.job).toBeNull();
    expect(vm.machineEvents).toEqual([]);
    expect(vm.quote).toMatchObject({ quotedHours: 58, qty: 24, quotedOn: "2026-09-11", quotedBy: { id: "PER-01", name: "Ray Delgado" } });
    expect(vm.quote?.primaryMachine.id).toBe("m-dmu50");
    expect(vm.hours).toMatchObject({ state: "no_job", quotedHours: 58, actualHours: null, variancePct: null, deltaHours: null });
    expect(vm.outcome).toEqual({ hidden: false, value: { outcome: "pending", outcomeLabel: "Pending", lostReason: null, lostReasonLabel: null } });
    expect(vm.part).toMatchObject({ partNumber: "AV-2231-07", revision: "C", minWallIn: 0.035 });
    expect(vm.part.features.map((f) => f.label)).toEqual(["Thin wall", "5-axis", "First article"]);
  });

  it("J-A10 is export-controlled and links its export-controlled cards", () => {
    const vm = jobDetail(s.db, machinist, "J-A10") as JobDetailVM;
    expect(vm.classification).toBe("export_controlled");
    expect(vm.job?.classification).toBe("export_controlled");
    expect(vm.quote?.classification).toBe("export_controlled");
    expect(vm.part).toMatchObject({ exportControl: "itar", exportControlLabel: "ITAR", partNumber: "GDS-4410-120" });
    expect(vm.hours).toMatchObject({ quotedHours: 96, actualHours: 118.5 });
    expect(formatSignedPct(vm.hours.variancePct, 0)).toBe("+23 %");
    expect(vm.linkedCards.map((c) => c.id)).toEqual(["KC-026", "KC-038", "KC-044", "KC-073"]);
    expect(vm.linkedCards.every((c) => c.classification === "export_controlled" && c.href === `/library/${c.id}`)).toBe(true);
  });

  it("internal work orders have no quote, outcome or financials", () => {
    const vm = jobDetail(s.db, owner, "J-I01") as JobDetailVM;
    expect(vm).toMatchObject({ kind: "internal", quote: null, outcome: null, financials: null, customer: null, classification: "internal" });
    expect(vm.title).toBe("Internal work order RJ-26-9001");
    expect(vm.hours).toMatchObject({ state: "internal", quotedHours: null, actualHours: 6, variancePct: null });
  });

  it("returns null for unknown IDs", () => {
    for (const id of ["J-NOPE", "Q-A99", "", "KC-001", "PRT-A01", "x".repeat(200)]) expect(jobDetail(s.db, owner, id)).toBeNull();
  });

  it("includes the quote reasoning log, machine events and related quotes", () => {
    const a02 = jobDetail(s.db, trainee, "J-A02") as JobDetailVM;
    expect(a02.reasoningLogs).toHaveLength(1);
    expect(a02.reasoningLogs[0]).toMatchObject({ id: "QRL-01", person: { id: "PER-01", name: "Ray Delgado" }, confidence1to5: 4, riskBucket: "hours", riskBucketLabel: "Hours" });

    expect(jobDetail(s.db, owner, "J-G004")?.machineEvents.map((e) => e.id)).toEqual(["ME-008"]);

    const repeat = s.sqlite.prepare("select id from quotes where part_id = 'PRT-G05' order by quoted_on desc").all() as { id: string }[];
    expect(repeat).toHaveLength(4);
    const vm = jobDetail(s.db, owner, repeat[0].id) as JobDetailVM;
    expect(vm.relatedQuotes.map((q) => q.quoteId)).toEqual(repeat.slice(1).map((r) => r.id));
    for (const q of vm.relatedQuotes) expect(q.outcome.hidden).toBe(false);
    const hiddenVm = jobDetail(s.db, machinist, repeat[0].id) as JobDetailVM;
    for (const q of hiddenVm.relatedQuotes) expect(q.outcome.hidden).toBe(true);
  });

  it.each(CLEARED)("%s sees every financial value", (_name, actor) => {
    const vm = jobDetail(s.db, actor, "Q-A01") as JobDetailVM;
    expect(vm.financials).toEqual({
      hidden: false,
      value: {
        unitPriceUsd: 620.19,
        totalPriceUsd: 14884.62,
        targetMarginPct: 22,
        shopRateUsdPerHr: 165,
        materialCostUsd: 2040,
        outsideProcessingUsd: 0,
        riskAdderHours: 6,
        scrapAllowancePct: 4,
      },
    });
    expect(vm.quote?.quoterNotes).toMatchObject({ hidden: false, value: expect.stringContaining("Walls drive this one") });
  });

  it.each(UNCLEARED)("%s: no financial value, outcome, lost reason or outcome-revealing note anywhere", (_name, actor) => {
    const label = `Hidden for ${actor.role === "machinist" ? "Machinist" : "Trainee"} role`;
    const allIds = (s.sqlite.prepare("select id from quotes").all() as { id: string }[]).map((r) => r.id);
    // A lost quote whose quoter note says so in prose ("they went with a lower bid").
    const pages = ["Q-A01", "J-A03", "J-A10", "Q-A13", ...allIds.filter((id) => /^Q-G0[0-2]/.test(id))];
    for (const id of pages) {
      const vm = jobDetail(s.db, actor, id) as JobDetailVM;
      expect(vm, id).not.toBeNull();
      const json = JSON.stringify(vm);
      const quoteId = vm.quote?.id as string;
      for (const n of financialValues(quoteId).filter((x) => !Number.isInteger(x) || x >= 1000)) expect(json, `${id} leaks ${n}`).not.toContain(String(n));
      // One Hidden slot: no per-field price names in the payload (PLAN.md §4.8).
      expect(vm.financials, id).toEqual({ hidden: true, label });
      expect(vm.outcome).toEqual({ hidden: true, label });
      if (vm.quote?.quoterNotes) expect(vm.quote.quoterNotes).toEqual({ hidden: true, label });
      walk(vm, (key, value) => {
        expect(OUTCOME_KEYS.has(key), `${id}: key ${key}`).toBe(false);
        if (typeof value === "string") expect(OUTCOME_VALUES.has(value), `${id}: ${key}=${value}`).toBe(false);
      });
    }
    const a01 = JSON.stringify(jobDetail(s.db, actor, "Q-A01"));
    for (const p of ["14884.62", "620.19", "2040", "lower bid"]) expect(a01).not.toContain(p);
    expect(JSON.stringify(jobDetail(s.db, actor, "Q-A13"))).not.toContain("lower bid");
  });

  it.each(UNCLEARED)("%s: quote_financials is never queried", (_name, actor) => {
    const spy = vi.spyOn(s.sqlite, "prepare");
    try {
      jobDetail(s.db, actor, "Q-A01");
      jobDetail(s.db, actor, "J-A10");
      jobsPage(s.db, actor, {});
      const sqls = spy.mock.calls.map((c) => String(c[0]));
      expect(sqls.length).toBeGreaterThan(0);
      expect(sqls.filter((q) => /quote_financials|customer_accounts/.test(q))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("owner queries quote_financials for the detail page but never customer_accounts", () => {
    const spy = vi.spyOn(s.sqlite, "prepare");
    try {
      jobDetail(s.db, owner, "Q-A01");
      jobsPage(s.db, owner, {});
      const sqls = spy.mock.calls.map((c) => String(c[0]));
      expect(sqls.some((q) => q.includes("quote_financials"))).toBe(true);
      expect(sqls.filter((q) => q.includes("customer_accounts"))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("view models are plain serializable data", () => {
    for (const actor of [owner, machinist]) {
      for (const id of ["J-A03", "Q-A01", "J-A10", "J-I01", "J-A02"]) {
        const vm = jobDetail(s.db, actor, id);
        expect(JSON.parse(JSON.stringify(vm))).toEqual(vm);
      }
      const page = jobsPage(s.db, actor, { customer: "CUS-01" });
      expect(JSON.parse(JSON.stringify(page))).toEqual(page);
    }
  });
});

describe("docs/DATA-LAYER.md job-detail example (the pattern other areas copy)", () => {
  // Regression: the example declared `unitPriceUsd: Gated<number>` built with `gated(..., price ?? 0)`, i.e. a pricing
  // field name in the restricted payload (rule 3) and a made-up $0.00 when there is no quote_financials row.
  const doc = fs.readFileSync(path.join(process.cwd(), "docs", "DATA-LAYER.md"), "utf8");
  const start = doc.indexOf("## Example: a job detail");
  const example = doc.slice(start, doc.indexOf("\n## ", start + 1));
  const vmBody = /export interface JobDetailVM \{([\s\S]*?)\n\}/.exec(example)?.[1] ?? "";

  it("gates prices as one financials slot, like jobDetail()", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(vmBody).toMatch(/\bfinancials: Gated<FinancialValues \| null>/);
    // No per-field price slot at the top level of the view model.
    expect(vmBody).not.toMatch(/\b\w*(Price|Margin|Cost|Rate)\w*\s*:\s*Gated</);
    // Restricted roles get a Hidden object built without the values, and a missing row stays null (never ?? 0).
    expect(example).toMatch(/canSee\(actor\.role, "prices"\)/);
    expect(example).toMatch(/\{ hidden: true, label: hiddenLabel\(actor\.role\) \}/);
    expect(example).not.toMatch(/\?\?\s*0\b/);
  });

  it("matches the real view model shape: one financials slot, Hidden for machinist/trainee", () => {
    const shown = jobDetail(s.db, owner, "J-A03") as JobDetailVM;
    const hidden = jobDetail(s.db, machinist, "J-A03") as JobDetailVM;
    expect(Object.keys(shown)).toContain("financials");
    expect(Object.keys(shown).filter((k) => /price/i.test(k))).toEqual([]);
    expect(hidden.financials).toEqual({ hidden: true, label: "Hidden for Machinist role" });
  });
});
