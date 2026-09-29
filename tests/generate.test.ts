import { beforeAll, describe, expect, it } from "vitest";
import { generateCommerce, type GeneratorInput, type GeneratorOutput } from "@/lib/seed/generate";
import { readSeedSources } from "@/lib/seed/files";
import { parseSeedSources, type ParsedSeed } from "@/lib/seed/parse";
import { IssueList } from "@/lib/seed/source";

const TARGETS = { generatedParts: 44, totalQuotes: 120, wonTotal: 70, lostTotal: 42, noBidTotal: 5, pendingTotal: 3, inProcessWon: 4 };

let parsed: ParsedSeed;
let input: GeneratorInput;
let out: GeneratorOutput;

function inputFrom(p: ParsedSeed): GeneratorInput {
  return {
    seed: p.shop!.seed,
    demoToday: p.shop!.demo_today,
    customers: p.customers.map(({ value: c }) => ({
      id: c.id,
      customer_since: c.customer_since,
      is_new_customer: c.is_new_customer,
      part_classification_floor: c.part_classification_floor,
      part_number_pattern: c.part_number_pattern,
    })),
    machines: p.machines.map(({ value: m }) => ({ id: m.id, kind: m.kind })),
    materials: p.materials.map(({ value: m }) => ({ id: m.id, family: m.family })),
    families: p.families!,
    model: p.quoteModel!,
    anchorParts: p.anchorParts.map((x) => x.value),
    anchorQuotes: p.anchorQuotes.map((x) => x.value),
    people: p.people.map(({ value: pe }) => ({ id: pe.id, hire_date: pe.hire_date })),
    rayPersonId: "PER-01",
    targets: TARGETS,
  };
}

beforeAll(() => {
  const issues = new IssueList();
  parsed = parseSeedSources(readSeedSources(), issues);
  expect(issues.errorCount).toBe(0);
  input = inputFrom(parsed);
  out = generateCommerce(input);
});

describe("generateCommerce", () => {
  it("is deterministic", () => {
    expect(JSON.stringify(generateCommerce(inputFrom(parsed)))).toBe(JSON.stringify(out));
  });

  it("hits the part, quote, outcome and in-process targets exactly", () => {
    expect(out.parts).toHaveLength(44);
    const all = [...input.anchorQuotes, ...out.quotes];
    expect(all).toHaveLength(120);
    const n = (o: string) => all.filter((q) => q.outcome === o).length;
    expect([n("won"), n("lost"), n("no_bid"), n("pending")]).toEqual([70, 42, 5, 3]);
    expect(all.filter((q) => q.job?.status === "in_process")).toHaveLength(4);
    for (const q of all) expect(q.outcome === "won").toBe(q.job !== null);
  });

  it("hits each customer's quote count", () => {
    const partCustomer = new Map([...input.anchorParts, ...out.parts].map((p) => [p.id, p.customer]));
    for (const f of input.families) {
      const count = [...input.anchorQuotes, ...out.quotes].filter((q) => partCustomer.get(q.part) === f.customer).length;
      expect(count, f.customer).toBe(f.quotes);
    }
  });

  it("makes valid, unique part numbers with unique numeric cores", () => {
    const pattern = new Map(input.customers.map((c) => [c.id, new RegExp(c.part_number_pattern)]));
    const all = [...input.anchorParts, ...out.parts];
    expect(new Set(all.map((p) => `${p.customer}|${p.part_number}`)).size).toBe(all.length);
    const cores = all.flatMap((p) => (p.part_number.match(/\d+/g) ?? []).filter((g) => g.length >= 4));
    expect(new Set(cores).size).toBe(cores.length);
    for (const p of out.parts) {
      expect(pattern.get(p.customer!)!.test(p.part_number), p.part_number).toBe(true);
      for (const g of p.part_number.match(/\d+/g) ?? []) expect(["6061", "7075", "718", "9102", "2024"]).not.toContain(g);
      expect(p.classification).toBeUndefined();
    }
  });

  it("never generates a reserved combination", () => {
    for (const rc of input.model.reserved_combinations) {
      const hit = out.parts.find((p) => p.customer === rc.customer && p.material === rc.material && p.family === rc.family && p.features.includes(rc.feature));
      expect(hit).toBeUndefined();
    }
  });

  it("respects hire dates, Ray's leave, turned-only quoters and customer start dates", () => {
    const hire = new Map(input.people.map((p) => [p.id, p.hire_date]));
    const since = new Map(input.customers.map((c) => [c.id, c.customer_since]));
    const parts = new Map(out.parts.map((p) => [p.id, p]));
    const kind = new Map(input.machines.map((m) => [m.id, m.kind]));
    const [leaveStart, leaveEnd] = input.model.ray_leave;
    for (const q of out.quotes) {
      const part = parts.get(q.part)!;
      expect(q.quoted_on >= hire.get(q.quoted_by)!).toBe(true);
      expect(q.quoted_on >= since.get(part.customer!)!).toBe(true);
      expect(q.quoted_on <= input.demoToday).toBe(true);
      if (q.quoted_by === "PER-01") expect(q.quoted_on >= leaveStart && q.quoted_on <= leaveEnd).toBe(false);
      if (input.model.quoters_turned_only.includes(q.quoted_by)) {
        const turned = input.model.turned_families.includes(part.family) || (input.model.turned_machine_kinds as string[]).includes(kind.get(q.primary_machine)!);
        expect(turned, q.id).toBe(true);
      }
    }
  });

  it("gives complete jobs consistent actuals and dates", () => {
    for (const q of out.quotes) {
      const j = q.job;
      if (!j) continue;
      expect(j.started_on! >= q.quoted_on).toBe(true);
      if (j.status === "complete") {
        expect(j.actual_hours).not.toBeNull();
        expect(j.shipped_on! <= input.demoToday).toBe(true);
        expect(j.shipped_on! >= j.started_on!).toBe(true);
        expect(Math.abs(j.actual_setup_hours! + j.actual_run_hours! - j.actual_hours!)).toBeLessThan(0.011);
      } else {
        expect(j.actual_hours).toBeNull();
        expect(j.shipped_on).toBeNull();
      }
    }
  });

  it("keeps other records unchanged when one family grows (sub-seed isolation)", () => {
    const families = structuredClone(input.families);
    const last = families[families.length - 1];
    last.families[last.families.length - 1].count += 1;
    last.quotes = (last.quotes ?? 0) + 1;
    const grown = generateCommerce({ ...input, families, targets: { ...TARGETS, totalQuotes: 121, lostTotal: 43 } });
    const firstCustomer = families[0].customer;
    const pick = (o: GeneratorOutput) => o.parts.filter((p) => p.customer === firstCustomer);
    expect(pick(grown)).toEqual(pick(out));
    const quoteFacts = (o: GeneratorOutput) =>
      o.quotes.filter((q) => pick(o).some((p) => p.id === q.part)).map((q) => [q.part, q.quoted_on, q.quoted_by, q.qty, q.quoted_hours]);
    expect(quoteFacts(grown)).toEqual(quoteFacts(out));
  });

  it("clusters variance where judgment matters", () => {
    // Everyone but Ray quotes, so judgment-heavy jobs show their full variance.
    const people = input.people.map((p) => (p.id === "PER-05" ? { ...p, hire_date: "2000-01-01" } : p));
    const r = generateCommerce({ ...input, people, model: { ...input.model, quoters: { "PER-05": 1 } } }).report;
    const g = Object.fromEntries(r.groups.map((x) => [x.group, x]));
    expect(g.judgment_non_ray.jobs).toBeGreaterThan(5);
    expect(r.ratio!).toBeGreaterThanOrEqual(2.5);
  });
});
