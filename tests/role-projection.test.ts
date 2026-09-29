/**
 * Role projection of the Phase 2 view models (PLAN.md §4.8, §12; docs/DATA-LAYER.md rules 2–4).
 *
 * Every list and detail function in src/lib/data/{risk,cards,people,machines,jobs}.ts is called for every demo
 * persona against the real seed, and each payload is serialized and deep-scanned. For machinist and trainee there
 * must be no price, contact, planned-departure or win/loss value anywhere in the JSON:
 *   - no pricing or contact field names at all (PLAN.md §4.8): a hidden price section is one `financials` slot
 *     holding the fresh `{ hidden, label }` placeholder that the page turns into the "Hidden for {Role} role" pills;
 *   - departure and outcome keys may only carry that placeholder (the key names a slot, never a value);
 *   - no raw `quote_financials` / `customer_accounts` column names;
 *   - no untokenized "$" amount, no seeded price or annual spend, no contact name, email, terms or pricing note;
 *   - no planned departure date (ISO or formatted), no departure kind, no "Retires in N mo" wording;
 *   - no win/loss outcome value (won / lost / no bid / pending), not even as a filter option;
 *   - the outcome filter is ignored and lists are not ordered by a hidden field.
 * Owner and quoters get the values (positive controls, so the scan can't pass vacuously).
 *
 * Modules are loaded with dynamic imports, so one missing module doesn't break the file; the last test asserts that
 * all five exist.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { formatDate } from "@/lib/format";
import { actorFor, seededDb, type SeededDb, type TestActor } from "./helpers/seeded-db";

type RiskMod = typeof import("@/lib/data/risk");
type CardsMod = typeof import("@/lib/data/cards");
type PeopleMod = typeof import("@/lib/data/people");
type MachinesMod = typeof import("@/lib/data/machines");
type JobsMod = typeof import("@/lib/data/jobs");

interface Mods {
  risk?: RiskMod;
  cards?: CardsMod;
  people?: PeopleMod;
  machines?: MachinesMod;
  jobs?: JobsMod;
}

const MODULE_NAMES = ["risk", "cards", "people", "machines", "jobs"] as const;

async function loadModules(): Promise<{ mods: Mods; missing: string[] }> {
  const mods: Mods = {};
  const missing: string[] = [];
  const attempt = async (name: (typeof MODULE_NAMES)[number], load: () => Promise<void>) => {
    try {
      await load();
    } catch (e) {
      missing.push(`${name} (${e instanceof Error ? e.message.split("\n")[0] : "import failed"})`);
    }
  };
  await attempt("risk", async () => void (mods.risk = await import("@/lib/data/risk")));
  await attempt("cards", async () => void (mods.cards = await import("@/lib/data/cards")));
  await attempt("people", async () => void (mods.people = await import("@/lib/data/people")));
  await attempt("machines", async () => void (mods.machines = await import("@/lib/data/machines")));
  await attempt("jobs", async () => void (mods.jobs = await import("@/lib/data/jobs")));
  return { mods, missing };
}

const { mods, missing } = await loadModules();

// ---------------------------------------------------------------------------------------------------------------
// Personas (seed-data/personas.yaml) and the shared database
// ---------------------------------------------------------------------------------------------------------------

const PERSONAS: { name: string; actor: TestActor }[] = [
  { name: "Dana (owner)", actor: actorFor("owner", null) },
  { name: "Ray (quoter)", actor: actorFor("quoter", "PER-01") },
  { name: "Maya (quoter)", actor: actorFor("quoter", "PER-05") },
  { name: "Marv (machinist)", actor: actorFor("machinist", "PER-02") },
  { name: "Devin (trainee)", actor: actorFor("trainee", "PER-06") },
];
const RESTRICTED: readonly Role[] = ["machinist", "trainee"];
const restricted = PERSONAS.filter((p) => RESTRICTED.includes(p.actor.role));
const privileged = PERSONAS.filter((p) => !RESTRICTED.includes(p.actor.role));

const PUBLIC_BASE_URL = "http://127.0.0.1:3000";

let shared: SeededDb | undefined;
function S(): SeededDb {
  shared ??= seededDb();
  return shared;
}
afterAll(() => shared?.sqlite.close());

const ROLE_WORD: Record<Role, string> = { owner: "Owner", quoter: "Quoter", machinist: "Machinist", trainee: "Trainee" };

// ---------------------------------------------------------------------------------------------------------------
// Sensitive vocabulary
// ---------------------------------------------------------------------------------------------------------------

/** quote_financials fields (camelCase view-model names): never a key in a restricted payload, not even as a pill. */
const PRICE_KEYS = [
  "unitPriceUsd",
  "totalPriceUsd",
  "targetMarginPct",
  "shopRateUsdPerHr",
  "materialCostUsd",
  "outsideProcessingUsd",
  "riskAdderHours",
  "scrapAllowancePct",
];
/** customer_accounts fields: never a key in a restricted payload. */
const CONTACT_KEYS = ["contactName", "contactEmail", "paymentTerms", "annualSpendUsd", "pricingNotes", "pricingNotesMd"];
/** Raw column names: never in any view model, for any role. */
const RAW_COLUMN_KEYS = [
  "unit_price_usd",
  "total_price_usd",
  "target_margin_pct",
  "shop_rate_usd_per_hr",
  "material_cost_usd",
  "outside_processing_usd",
  "risk_adder_hours",
  "scrap_allowance_pct",
  "contact_name",
  "contact_email",
  "payment_terms",
  "annual_spend_usd",
  "pricing_notes_md",
  "planned_departure_date",
  "departure_kind",
];
/** Win/loss keys: only a Hidden placeholder or null for restricted roles. */
const OUTCOME_KEYS = ["outcome", "outcomeLabel", "lostReason", "lostReasonLabel", "winRate", "winRatePct", "wonCount", "lostCount"];
/** Departure keys (plus any key containing "departure"/"departing"). */
const DEPARTURE_KEY = /departure|departing|retire/i;
const OUTCOME_VALUES = ["won", "lost", "no_bid", "pending"];

interface Sensitive {
  priceNumbers: Set<number>;
  priceStrings: string[];
  contactStrings: string[];
  departureStrings: string[];
}

const MONEY = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function moneyForms(n: number): string[] {
  const fixed = n.toFixed(2);
  const grouped = MONEY.format(n);
  return [...new Set([fixed, grouped, `$${grouped}`])];
}

/** Values pulled from the seed bundle, so the scan follows the data instead of hard-coding it. */
function sensitiveValues(db: SeededDb): Sensitive {
  const t = db.bundle.tables;
  const priceNumbers = new Set<number>();
  const priceStrings = new Set<string>();
  for (const f of t.quoteFinancials) {
    // Distinctive amounts only (prices with cents, or four digits and up), so hours or counts can't collide.
    for (const n of [f.unitPriceUsd, f.totalPriceUsd, f.materialCostUsd, f.outsideProcessingUsd]) {
      if (typeof n !== "number" || !Number.isFinite(n) || n === 0) continue;
      if (!Number.isInteger(n) || n >= 1000) {
        priceNumbers.add(n);
        for (const s of moneyForms(n)) priceStrings.add(s);
      }
    }
  }
  const contactStrings = new Set<string>();
  for (const a of t.customerAccounts) {
    if (typeof a.annualSpendUsd === "number") {
      priceNumbers.add(a.annualSpendUsd);
      for (const s of moneyForms(a.annualSpendUsd)) priceStrings.add(s);
    }
    // "Morgan Ellery (fictional)" → "Morgan Ellery"; terms such as "Net 45" are distinctive in shop text.
    if (a.contactName) contactStrings.add(a.contactName.replace(/\s*\(fictional\)\s*$/, ""));
    for (const v of [a.contactEmail, a.pricingNotesMd, a.paymentTerms]) if (v) contactStrings.add(v);
  }
  const departureStrings = new Set<string>();
  for (const p of t.people) {
    if (!p.plannedDepartureDate) continue;
    departureStrings.add(p.plannedDepartureDate);
    departureStrings.add(formatDate(p.plannedDepartureDate));
    const long = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
    departureStrings.add(long.format(new Date(`${p.plannedDepartureDate}T00:00:00Z`)));
  }
  return {
    priceNumbers,
    priceStrings: [...priceStrings],
    contactStrings: [...contactStrings],
    departureStrings: [...departureStrings],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The deep scan
// ---------------------------------------------------------------------------------------------------------------

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function isHiddenPlaceholder(v: Json | undefined, role: Role): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v).sort();
  return keys.length === 2 && keys[0] === "hidden" && keys[1] === "label" && v.hidden === true && v.label === `Hidden for ${ROLE_WORD[role]} role`;
}

/** Leaks in one serialized payload for a restricted role. Returns "path: problem" strings (empty = clean). */
function scanRestricted(payload: unknown, role: Role, s: Sensitive): string[] {
  const found: string[] = [];
  const json = JSON.parse(JSON.stringify(payload ?? null)) as Json;

  const visit = (v: Json, path: string, key: string | null) => {
    if (key !== null) {
      if (RAW_COLUMN_KEYS.includes(key)) found.push(`${path}: raw column name "${key}"`);
      if (PRICE_KEYS.includes(key) || CONTACT_KEYS.includes(key)) {
        found.push(`${path}: pricing/contact field name "${key}"`);
        return;
      }
      if (key === "financials" && v !== null && !isHiddenPlaceholder(v, role)) {
        found.push(`${path}: "financials" must be the Hidden placeholder or null, got ${JSON.stringify(v).slice(0, 80)}`);
        return;
      }
      // The departure factor U, plus T and D: with risk, E and f visible, either one would let U be solved for.
      const gatedKey = DEPARTURE_KEY.test(key) || /\.factors\.[UTD]$/.test(path);
      if (gatedKey && !isHiddenPlaceholder(v, role)) {
        found.push(`${path}: "${key}" must be the Hidden placeholder, got ${JSON.stringify(v).slice(0, 80)}`);
        return;
      }
      if (OUTCOME_KEYS.includes(key) && v !== null && !isHiddenPlaceholder(v, role)) {
        found.push(`${path}: win/loss "${key}" must be the Hidden placeholder or null, got ${JSON.stringify(v).slice(0, 80)}`);
        return;
      }
      if ((key === "kind" || key === "departureKind") && v === "retirement") found.push(`${path}: departure kind "retirement"`);
    }
    if (typeof v === "string") {
      if (/\$\s?\d/.test(v)) found.push(`${path}: untokenized "$" amount in ${JSON.stringify(v.slice(0, 80))}`);
      if (OUTCOME_VALUES.includes(v)) found.push(`${path}: win/loss value "${v}"`);
      if (/\bretir\w*\s+in\s+\d/i.test(v)) found.push(`${path}: departure wording ${JSON.stringify(v.slice(0, 80))}`);
      for (const x of s.priceStrings) if (v.includes(x)) found.push(`${path}: price/spend value ${x}`);
      for (const x of s.contactStrings) if (v.includes(x)) found.push(`${path}: contact value ${JSON.stringify(x)}`);
      for (const x of s.departureStrings) if (v.includes(x)) found.push(`${path}: planned departure date ${x}`);
    } else if (typeof v === "number") {
      if (s.priceNumbers.has(v)) found.push(`${path}: price/spend number ${v}`);
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => visit(item, `${path}[${i}]`, null));
    } else if (v && typeof v === "object") {
      for (const [k, child] of Object.entries(v)) visit(child, `${path}.${k}`, k);
    }
  };
  visit(json, "$", null);
  return found;
}

// ---------------------------------------------------------------------------------------------------------------
// Payloads: every list/detail function for one actor
// ---------------------------------------------------------------------------------------------------------------

interface Payload {
  label: string;
  vm: unknown;
}

const SEARCHES = ["thin-wall Ti", "quote titanium brackets for Aerovance", "price margin", "Ray retire"];

function ids(db: SeededDb) {
  const t = db.bundle.tables;
  const jobQuoteIds = new Set(t.jobs.map((j) => j.quoteId).filter((q): q is string => !!q));
  return {
    cards: t.knowledgeCards.map((c) => c.id),
    people: t.people.map((p) => p.id),
    machines: t.machines.map((m) => m.id),
    // Every page /jobs/[id] can show: jobs (incl. internal work orders) and quotes without a job, plus quote IDs
    // that resolve to their job's page.
    jobs: [...t.jobs.map((j) => j.id), ...t.quotes.filter((q) => !jobQuoteIds.has(q.id)).map((q) => q.id), "Q-A03", "Q-A10"],
  };
}

function payloadsFor(actor: TestActor): Payload[] {
  const s = S();
  const db = s.db;
  const out: Payload[] = [];
  const all = ids(s);
  const demoToday = s.bundle.demoToday;

  if (mods.risk) out.push({ label: "riskOverview", vm: mods.risk.riskOverview(db, actor) });

  if (mods.cards) {
    const c = mods.cards;
    out.push({ label: "listCards", vm: c.listCards(db, actor) });
    out.push({ label: "libraryPage", vm: c.libraryPage(db, actor, {}) });
    out.push({ label: "libraryPage(person=PER-01)", vm: c.libraryPage(db, actor, { person: "PER-01" }) });
    for (const q of SEARCHES) out.push({ label: `searchCards(${q})`, vm: c.searchCards(db, actor, q) });
    for (const id of all.cards) out.push({ label: `cardDetail(${id})`, vm: c.cardDetail(db, actor, id) });
  }

  if (mods.people) {
    const p = mods.people;
    out.push({ label: "listPeople", vm: p.listPeople(db, actor) });
    for (const id of all.people) out.push({ label: `personProfile(${id})`, vm: p.personProfile(db, actor, id) });
  }

  if (mods.machines) {
    const m = mods.machines;
    out.push({ label: "listMachines", vm: m.listMachines(db, actor, demoToday) });
    out.push({ label: "listMachineLabels", vm: m.listMachineLabels(db, actor, PUBLIC_BASE_URL) });
    for (const id of all.machines) {
      out.push({ label: `machineDetail(${id})`, vm: m.machineDetail(db, actor, id, { demoToday, publicBaseUrl: PUBLIC_BASE_URL }) });
      out.push({ label: `machineLabel(${id})`, vm: m.machineLabel(db, actor, id, PUBLIC_BASE_URL) });
    }
  }

  if (mods.jobs) {
    const j = mods.jobs;
    out.push({ label: "listJobs", vm: j.listJobs(db, actor) });
    out.push({ label: "jobsPage", vm: j.jobsPage(db, actor, {}) });
    for (const outcome of ["won", "lost", "no_bid", "pending"]) {
      out.push({ label: `jobsPage(outcome=${outcome})`, vm: j.jobsPage(db, actor, { outcome }) });
    }
    out.push({ label: "jobsPage(customer=CUS-01)", vm: j.jobsPage(db, actor, { customer: "CUS-01" }) });
    for (const id of all.jobs) out.push({ label: `jobDetail(${id})`, vm: j.jobDetail(db, actor, id) });
  }
  return out;
}

const payloadCache = new Map<string, Payload[]>();
function payloads(p: { name: string; actor: TestActor }): Payload[] {
  let list = payloadCache.get(p.name);
  if (!list) {
    list = payloadsFor(p.actor);
    payloadCache.set(p.name, list);
  }
  return list;
}

// ---------------------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------------------

describe("the leak scanner itself", () => {
  it("flags each kind of leak and passes a clean, placeholder-only payload", () => {
    const s = sensitiveValues(S());
    const hid = { hidden: true, label: "Hidden for Machinist role" };
    const clean = {
      financials: hid,
      departure: hid,
      factors: { U: hid, T: hid, D: hid, B: 1 },
      outcome: null,
      note: "Walls moved after unclamping.",
    };
    expect(scanRestricted(clean, "machinist", s)).toEqual([]);

    const leaks: [string, unknown][] = [
      ["price value", { financials: { hidden: false, value: { unitPriceUsd: 584.94 } } }],
      ["price field name as a pill", { financials: { unitPriceUsd: hid } }],
      ["price field name anywhere", { quote: { totalPriceUsd: hid } }],
      ["price number elsewhere", { total: 7019.23 }],
      ["money text", { text: "quoted at $7,019.23" }],
      ["contact key", { contactEmail: "x" }],
      ["contact value", { note: "Ask Morgan Ellery about it" }],
      ["raw column", { unit_price_usd: 1 }],
      ["departure value", { departure: { hidden: false, value: { date: "2028-05-15", months: 20, kind: "retirement" } } }],
      ["departure date text", { text: "leaves May 15, 2028" }],
      ["departure wording", { chip: "Retires in 20 mo" }],
      ["departure factor", { factors: { U: { hidden: false, value: 1 } } }],
      ["tenure factor (reveals U)", { factors: { T: { hidden: false, value: 0.8 } } }],
      ["backup discount (reveals U)", { factors: { D: 0.8 } }],
      ["outcome value", { outcome: { hidden: false, value: { outcome: "won" } } }],
      ["outcome option", { options: [{ value: "lost", label: "Lost" }] }],
      ["wrong role label", { departure: { hidden: true, label: "Hidden for Trainee role" } }],
      ["placeholder carrying a value", { unitPriceUsd: { hidden: true, label: "Hidden for Machinist role", value: 584.94 } }],
    ];
    for (const [name, payload] of leaks) expect(scanRestricted(payload, "machinist", s), name).not.toEqual([]);
  });

  it("catches the real values: the owner's payloads fail the machinist scan", () => {
    const s = sensitiveValues(S());
    const problems = payloads(PERSONAS[0]).flatMap(({ label, vm }) => scanRestricted(vm, "machinist", s).map((f) => `${label} ${f}`));
    if (mods.jobs) expect(problems.some((f) => f.startsWith("jobDetail(J-A03)") && f.includes("financials"))).toBe(true);
    if (mods.jobs) expect(problems.some((f) => f.includes("win/loss"))).toBe(true);
    if (mods.people) expect(problems.some((f) => f.startsWith("personProfile(PER-01)") && f.includes("departure"))).toBe(true);
    for (const factor of ["U", "T", "D"]) {
      if (mods.risk) expect(problems.some((f) => f.startsWith("riskOverview") && f.includes(`.factors.${factor}:`)), factor).toBe(true);
    }
  });
});

for (const p of restricted) {
  describe(`${p.name}: no hidden values in any payload`, () => {
    it("every list and detail payload is free of prices, contacts, departures and win/loss", () => {
      const s = S();
      const sens = sensitiveValues(s);
      const list = payloads(p);
      const problems: string[] = [];
      for (const { label, vm } of list) for (const f of scanRestricted(vm, p.actor.role, sens)) problems.push(`${label} ${f}`);
      expect(problems.slice(0, 40)).toEqual([]);
    });

    it("the scan is not vacuous: every seeded record produced a payload", () => {
      const s = S();
      const all = ids(s);
      const list = payloads(p);
      const missingVm = list.filter((x) => x.vm === null || x.vm === undefined).map((x) => x.label);
      expect(missingVm).toEqual([]);
      if (mods.jobs) expect(list.filter((x) => x.label.startsWith("jobDetail(")).length).toBe(all.jobs.length);
      if (mods.cards) expect(list.filter((x) => x.label.startsWith("cardDetail(")).length).toBe(all.cards.length);
    });

    it.runIf(!!mods.jobs)("job detail keeps the price section as one visible Hidden pill (and J-A03 hides its outcome)", () => {
      const vm = mods.jobs!.jobDetail(S().db, p.actor, "J-A03");
      expect(vm).not.toBeNull();
      expect(isHiddenPlaceholder(vm!.financials as Json, p.actor.role)).toBe(true);
      expect(isHiddenPlaceholder(vm!.outcome as Json, p.actor.role)).toBe(true);
    });

    it.runIf(!!mods.jobs)("the outcome filter is ignored (never filter by a hidden field)", () => {
      const j = mods.jobs!;
      const db = S().db;
      const base = j.jobsPage(db, p.actor, {}).rows.map((r) => r.id);
      for (const outcome of OUTCOME_VALUES) {
        const page = j.jobsPage(db, p.actor, { outcome });
        expect(page.rows.map((r) => r.id), outcome).toEqual(base);
        expect(JSON.stringify(page.activeFilters), outcome).not.toContain(outcome);
      }
    });

    it.runIf(!!mods.people && !!mods.risk)("lists are not ordered by departure", () => {
      const s = S();
      const bySortOrder = [...s.bundle.tables.people].sort((a, b) => a.sortOrder - b.sortOrder).map((x) => x.id);
      expect(mods.people!.listPeople(s.db, p.actor).people.map((x) => x.id)).toEqual(bySortOrder);
      // Risk columns sort by risk contribution (visible to every role): the same order the owner sees.
      const owner = mods.risk!.riskOverview(s.db, actorFor("owner")).people.map((x) => x.id);
      expect(mods.risk!.riskOverview(s.db, p.actor).people.map((x) => x.id)).toEqual(owner);
    });
  });
}

for (const p of privileged) {
  describe(`${p.name}: gated values are present`, () => {
    it.runIf(!!mods.jobs)("job detail carries every price and the outcome (J-A03 = Q-A03's financials, won)", () => {
      const s = S();
      const fin = s.bundle.tables.quoteFinancials.find((f) => f.quoteId === "Q-A03");
      expect(fin).toBeDefined();
      const vm = mods.jobs!.jobDetail(s.db, p.actor, "J-A03");
      expect(vm?.financials).toMatchObject({ hidden: false });
      const f = vm!.financials!.hidden ? null : vm!.financials!.value;
      expect(f).not.toBeNull();
      for (const key of PRICE_KEYS) {
        expect((f as unknown as Record<string, number>)[key], key).toEqual((fin as unknown as Record<string, number>)[key]);
      }
      expect(vm!.outcome).toMatchObject({ hidden: false, value: { outcome: "won" } });
    });

    it.runIf(!!mods.jobs)("every quote page shows its unit and total price", () => {
      const s = S();
      const jobByQuote = new Map(s.bundle.tables.jobs.filter((j) => j.quoteId).map((j) => [j.quoteId as string, j.id]));
      for (const fin of s.bundle.tables.quoteFinancials) {
        const vm = mods.jobs!.jobDetail(s.db, p.actor, jobByQuote.get(fin.quoteId) ?? fin.quoteId);
        expect(vm?.financials, fin.quoteId).toMatchObject({
          hidden: false,
          value: { unitPriceUsd: fin.unitPriceUsd, totalPriceUsd: fin.totalPriceUsd },
        });
      }
    });

    it.runIf(!!mods.jobs)("the outcome filter narrows the list", () => {
      const j = mods.jobs!;
      const db = S().db;
      const all = j.jobsPage(db, p.actor, {});
      const lost = j.jobsPage(db, p.actor, { outcome: "lost" });
      expect(lost.rows.length).toBeGreaterThan(0);
      expect(lost.rows.length).toBeLessThan(all.rows.length);
    });

    it.runIf(!!mods.people && !!mods.risk)("Ray's planned departure is visible (profile, list, risk column and KPI)", () => {
      const db = S().db;
      const profile = mods.people!.personProfile(db, p.actor, "PER-01");
      expect(profile?.departure).toMatchObject({ hidden: false, value: { date: "2028-05-15", kind: "retirement" } });
      const row = mods.people!.listPeople(db, p.actor).people.find((x) => x.id === "PER-01");
      expect(row?.departure).toMatchObject({ hidden: false, value: { date: "2028-05-15" } });
      const risk = mods.risk!.riskOverview(db, p.actor);
      expect(risk.people.find((x) => x.id === "PER-01")?.departure).toMatchObject({ hidden: false, value: { kind: "retirement" } });
      expect(risk.kpis.departing.hidden).toBe(false);
      const cell = risk.cells.find((c) => c.personId === "PER-01" && c.topicId === "t-mat-ti64");
      expect(cell?.factors).toMatchObject({ U: { hidden: false }, T: { hidden: false }, D: { hidden: false } });
    });

    it("payloads are plain serializable data", () => {
      for (const { label, vm } of payloads(p)) expect(JSON.parse(JSON.stringify(vm ?? null)), label).toEqual(vm ?? null);
    });
  });
}

describe("module inventory", () => {
  it("all five Phase 2 data modules exist and load", () => {
    expect(missing).toEqual([]);
    for (const name of MODULE_NAMES) expect(mods[name], name).toBeDefined();
  });
});
