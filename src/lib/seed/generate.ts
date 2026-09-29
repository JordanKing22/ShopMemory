/**
 * Generates the non-anchor parts, quotes and jobs from parts/families.yaml and quotes/quote-model.yaml
 * (PLAN.md §7.3–§7.5). Pure and deterministic: every draw uses subRng(seed, stableKey, stream), where the key
 * identifies the record by its template position (customer, family entry, index), not by its display ID — so
 * adding parts to one family never changes the values of any other record.
 *
 * Generated parts carry no classification: the loader derives it (customer floor + export control).
 */
import type { z } from "zod";
import type { Classification, JudgmentDriver, PartFeature } from "@/db/schema/enums";
import { addDays } from "@/lib/time";
import type { FamiliesFile, JobSeed, PartSeed, QuoteModelFile, QuoteSeed } from "./schemas";
import { intBetween, logUniformInt, normal, pick, pickWeighted, round2, roundHalf, subRng, type Rng } from "./prng";

type PartSeedT = z.infer<typeof PartSeed>;
type QuoteSeedT = z.infer<typeof QuoteSeed>;
type JobSeedT = z.infer<typeof JobSeed>;
type QuoteModel = z.infer<typeof QuoteModelFile>;

export interface GeneratorInput {
  seed: number;
  demoToday: string;
  customers: {
    id: string;
    customer_since: string;
    is_new_customer: boolean;
    part_classification_floor: Classification;
    part_number_pattern: string;
  }[];
  machines: { id: string; kind: string }[];
  /** Material families decide the titanium / inconel judgment drivers. */
  materials: { id: string; family: string }[];
  families: z.infer<typeof FamiliesFile>;
  model: QuoteModel;
  anchorParts: PartSeedT[];
  anchorQuotes: QuoteSeedT[];
  people: { id: string; hire_date: string }[];
  /** The quoter whose jobs get the quoted_by_ray variance multipliers. */
  rayPersonId: string;
  /** Digit groups a part number must never contain (material/spec/machine numbers). */
  stoplistNumbers?: string[];
  targets: {
    generatedParts: number;
    totalQuotes: number;
    wonTotal: number;
    lostTotal: number;
    noBidTotal: number;
    pendingTotal: number;
    inProcessWon: number;
  };
}

export interface VarianceGroupStat {
  group: "routine" | "judgment_ray" | "judgment_non_ray" | "other";
  jobs: number;
  /** Mean |actual − quoted| / quoted, as a fraction; null when the group is empty. */
  meanAbs: number | null;
}

export interface VarianceReport {
  groups: VarianceGroupStat[];
  /** judgment_non_ray ÷ routine (null when either is empty). */
  ratio: number | null;
}

export interface GeneratorOutput {
  parts: PartSeedT[];
  /** Won quotes carry their job. */
  quotes: QuoteSeedT[];
  report: VarianceReport;
}

/** Thrown when the templates can't satisfy the targets (message names the template, never data values). */
export class GeneratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeneratorError";
  }
}

export const DEFAULT_STOPLIST = ["6061", "7075", "718", "9102", "2024", "174", "316"];
const JUDGMENT_HEAVY: ReadonlySet<JudgmentDriver> = new Set(["thin_wall", "titanium", "inconel"]);
const REVISIONS = ["A", "A", "B", "C"] as const;
const LOST_REASONS = [
  { value: "price" as const, weight: 0.6 },
  { value: "lead_time" as const, weight: 0.25 },
  { value: "capability" as const, weight: 0.05 },
  { value: "unknown" as const, weight: 0.1 },
];

/** Judgment drivers of a part (PLAN.md §7.4): its features, its material family and a new customer. */
export function judgmentDrivers(features: readonly PartFeature[], materialFamily: string | undefined, isNewCustomer: boolean): JudgmentDriver[] {
  const out: JudgmentDriver[] = [];
  if (features.includes("thin_wall")) out.push("thin_wall");
  if (materialFamily === "titanium") out.push("titanium");
  if (materialFamily === "nickel_alloy") out.push("inconel");
  if (features.includes("five_axis")) out.push("five_axis");
  if (features.includes("tight_tolerance")) out.push("tight_tolerance");
  if (isNewCustomer) out.push("new_customer");
  if (features.includes("first_article")) out.push("first_article");
  return out;
}

interface GenPart {
  part: PartSeedT;
  key: string;
  machines: string[];
}

interface GenQuote {
  key: string;
  part: GenPart;
  order: number;
  quotedOn: string;
  quotedBy: string;
  machine: string;
  machineKind: string;
  qty: number;
  setup: number;
  cycle: number;
  quotedHours: number;
  leadTime: number;
  drivers: JudgmentDriver[];
  repeat: boolean;
  outcome?: QuoteSeedT["outcome"];
  lostReason?: QuoteSeedT["lost_reason"];
}

export function generateCommerce(input: GeneratorInput): GeneratorOutput {
  const { seed, demoToday, model } = input;
  const rng = (key: string, stream: string): Rng => subRng(seed, key, stream);
  const customers = new Map(input.customers.map((c) => [c.id, c]));
  const machineKind = new Map(input.machines.map((m) => [m.id, m.kind]));
  const materialFamily = new Map(input.materials.map((m) => [m.id, m.family]));
  const hireDate = new Map(input.people.map((p) => [p.id, p.hire_date]));
  const stoplist = new Set(input.stoplistNumbers ?? DEFAULT_STOPLIST);

  // ------------------------------------------------------------------ parts
  const usedNumbers = new Set(input.anchorParts.map((p) => `${p.customer}|${p.part_number}`));
  const usedGroups = new Set(input.anchorParts.flatMap((p) => longGroups(p.part_number)));
  const parts: GenPart[] = [];
  for (const cf of input.families) {
    const cust = customers.get(cf.customer);
    if (!cust) throw new GeneratorError(`families.yaml names unknown customer ${cf.customer}.`);
    const pattern = new RegExp(cust.part_number_pattern);
    cf.families.forEach((fam, fi) => {
      for (let k = 0; k < fam.count; k++) {
        const key = `${cf.customer}|${fi}|${fam.family}|${k}`;
        const reserved = model.reserved_combinations.filter((rc) => rc.customer === cf.customer && rc.family === fam.family);
        const isReserved = (m: string, fs: readonly string[]) => reserved.some((rc) => rc.material === m && fs.includes(rc.feature));
        let material = pick(rng(key, "material"), fam.materials);
        let features = pick(rng(key, "features"), fam.features);
        if (isReserved(material, features)) {
          const okSets = fam.features.filter((fs) => !isReserved(material, fs));
          if (okSets.length > 0) features = pick(rng(key, "features-alt"), okSets);
          else {
            const okMats = fam.materials.filter((m) => fam.features.some((fs) => !isReserved(m, fs)));
            if (okMats.length === 0) throw new GeneratorError(`A ${cf.customer} ${fam.family} template can only produce a reserved combination.`);
            material = pick(rng(key, "material-alt"), okMats);
            features = pick(rng(key, "features-alt"), fam.features.filter((fs) => !isReserved(material, fs)));
          }
        }
        const feats = [...new Set(features)] as PartFeature[];
        const partNumber = makePartNumber(cf.part_number_format, pattern, rng(key, "part_number"), (s) => {
          const groups = s.match(/\d+/g) ?? [];
          return (
            !usedNumbers.has(`${cf.customer}|${s}`) &&
            groups.every((g) => !stoplist.has(g)) &&
            longGroups(s).every((g) => !usedGroups.has(g))
          );
        });
        if (!partNumber) throw new GeneratorError(`Couldn't make a unique part number for ${cf.customer} from "${cf.part_number_format}".`);
        usedNumbers.add(`${cf.customer}|${partNumber}`);
        for (const g of longGroups(partNumber)) usedGroups.add(g);
        const id = `PRT-G${String(parts.length + 1).padStart(2, "0")}`;
        parts.push({
          key,
          machines: fam.machines,
          part: {
            id,
            customer: cf.customer,
            part_number: partNumber,
            revision: pick(rng(key, "revision"), REVISIONS),
            description: fam.descriptions[k % fam.descriptions.length],
            family: fam.family,
            material,
            features: feats,
            min_wall_in: feats.includes("thin_wall") ? Math.round((0.04 + rng(key, "wall")() * 0.04) * 1000) / 1000 : null,
            max_wall_height_in: null,
            tightest_tol_in: feats.includes("tight_tolerance") ? pick(rng(key, "tol"), [0.0005, 0.001]) : pick(rng(key, "tol"), [0.002, 0.003, 0.005]),
            envelope_in: null,
            complexity: pick(rng(key, "complexity"), fam.complexity),
            export_control: fam.export_control,
            notes: "",
          },
        });
      }
    });
  }

  // ------------------------------------------------------------------ quote counts per part (exact total)
  const t = input.targets;
  if (t.wonTotal + t.lostTotal + t.noBidTotal + t.pendingTotal !== t.totalQuotes) {
    throw new GeneratorError("Quote outcome targets don't add up to the total.");
  }
  const need = t.totalQuotes - input.anchorQuotes.length;
  if (need < parts.length) throw new GeneratorError(`Only ${need} generated quotes for ${parts.length} generated parts; every part needs one.`);
  const counts = parts.map((p) => pick(rng(p.key, "nquotes"), model.generated_quotes_per_part));
  const maxPerPart = Math.max(...model.generated_quotes_per_part) + 1;
  const spread = (indices: number[], target: number, label: string) => {
    if (target < indices.length) throw new GeneratorError(`${label}: ${target} generated quotes for ${indices.length} generated parts; every part needs one.`);
    const order = indices
      .map((i) => ({ i, r: rng(parts[i].key, "adjust")() }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.i);
    let sum = indices.reduce((s, i) => s + counts[i], 0);
    for (let guard = 0; sum !== target && guard < 10_000; guard++) {
      const i = order[guard % order.length];
      if (sum < target && counts[i] < maxPerPart) {
        counts[i]++;
        sum++;
      } else if (sum > target && counts[i] > 1) {
        counts[i]--;
        sum--;
      }
    }
    if (sum !== target) throw new GeneratorError(`${label}: couldn't spread ${target} quotes over its generated parts.`);
  };
  const anchorPartCustomer = new Map(input.anchorParts.map((p) => [p.id, p.customer]));
  const perCustomer = input.families.filter((f) => f.quotes !== undefined);
  if (perCustomer.length === input.families.length && perCustomer.length > 0) {
    const sum = perCustomer.reduce((s, f) => s + f.quotes!, 0);
    if (sum !== t.totalQuotes) throw new GeneratorError(`The customers' quote counts add up to ${sum}, not ${t.totalQuotes}.`);
    for (const f of perCustomer) {
      const anchors = input.anchorQuotes.filter((q) => anchorPartCustomer.get(q.part) === f.customer).length;
      spread(parts.flatMap((p, i) => (p.part.customer === f.customer ? [i] : [])), f.quotes! - anchors, f.customer);
    }
  } else {
    spread(parts.map((_, i) => i), need, "All customers");
  }

  // ------------------------------------------------------------------ quotes
  const windowStart = addDays(demoToday, -model.quote_window_days);
  const latest = addDays(demoToday, -5);
  const [leaveStart, leaveEnd] = model.ray_leave;
  const turnedOnly = new Set(model.quoters_turned_only);
  const quotes: GenQuote[] = [];
  parts.forEach((gp, pi) => {
    const cust = customers.get(gp.part.customer!)!;
    const lower = maxDate(windowStart, cust.customer_since);
    const dates = Array.from({ length: counts[pi] }, (_, k) => {
      const d = addDays(demoToday, -intBetween(rng(`${gp.key}#${k}`, "date"), 5, model.quote_window_days));
      return d < lower ? minDate(addDays(lower, intBetween(rng(`${gp.key}#${k}`, "date-shift"), 0, 30)), latest) : d;
    }).sort();
    const machine = pick(rng(gp.key, "machine"), gp.machines);
    const kind = machineKind.get(machine);
    if (!kind) throw new GeneratorError(`families.yaml names unknown machine ${machine}.`);
    const turned = model.turned_families.includes(gp.part.family) || (model.turned_machine_kinds as readonly string[]).includes(kind);
    const drivers = judgmentDrivers(gp.part.features, materialFamily.get(gp.part.material), cust.is_new_customer);
    dates.forEach((quotedOn, order) => {
      const key = `${gp.key}#${order}`;
      const onLeave = quotedOn >= leaveStart && quotedOn <= leaveEnd;
      const eligible = Object.entries(model.quoters)
        .filter(([pid, w]) => w > 0 && (hireDate.get(pid) ?? "9999") <= quotedOn)
        .filter(([pid]) => !(onLeave && pid === input.rayPersonId))
        .filter(([pid]) => turned || !turnedOnly.has(pid));
      const quotedBy = eligible.length > 0 ? pickWeighted(rng(key, "quoter"), eligible.map(([value, weight]) => ({ value, weight }))) : input.rayPersonId;
      const qty = logUniformInt(rng(key, "qty"), model.qty.min, model.qty.max);
      const setup = need0(model.setup_hours_by_machine_kind[kind], `setup_hours_by_machine_kind.${kind}`);
      const cycle =
        need0(model.cycle_minutes_by_family[gp.part.family], `cycle_minutes_by_family.${gp.part.family}`) *
        need0(model.material_time_factor[gp.part.material], `material_time_factor.${gp.part.material}`) *
        need0(model.complexity_factor[String(gp.part.complexity)], `complexity_factor.${gp.part.complexity}`);
      quotes.push({
        key,
        part: gp,
        order,
        quotedOn,
        quotedBy,
        machine,
        machineKind: kind,
        qty,
        setup,
        cycle: round2(cycle),
        quotedHours: Math.max(0.5, roundHalf(setup + (cycle * qty) / 60)),
        leadTime: intBetween(rng(key, "lead"), 10, 45),
        drivers,
        repeat: order > 0,
      });
    });
  });

  // ------------------------------------------------------------------ outcomes (exact totals after the anchors)
  const anchorCount = (o: QuoteSeedT["outcome"]) => input.anchorQuotes.filter((q) => q.outcome === o).length;
  const gen = {
    won: t.wonTotal - anchorCount("won"),
    lost: t.lostTotal - anchorCount("lost"),
    no_bid: t.noBidTotal - anchorCount("no_bid"),
    pending: t.pendingTotal - anchorCount("pending"),
  };
  if (Object.values(gen).some((n) => n < 0)) throw new GeneratorError("The anchor quotes already exceed an outcome target.");
  const byRecency = [...quotes].sort((a, b) => b.quotedOn.localeCompare(a.quotedOn) || a.key.localeCompare(b.key));
  byRecency.slice(0, gen.pending).forEach((q) => (q.outcome = "pending"));
  const open = quotes.filter((q) => !q.outcome);
  const winScore = (q: GenQuote) => {
    const odds = model.win_odds;
    const p =
      odds.base +
      (q.repeat ? odds.repeat_part : 0) +
      (q.drivers.includes("new_customer") ? odds.new_customer : 0) +
      (q.quotedBy === input.rayPersonId && q.drivers.some((d) => JUDGMENT_HEAVY.has(d)) ? odds.ray_judgment_job : 0);
    return rng(q.key, "outcome")() - p;
  };
  const scored = open.map((q) => ({ q, s: winScore(q) })).sort((a, b) => a.s - b.s || a.q.key.localeCompare(b.q.key));
  scored.slice(0, gen.won).forEach(({ q }) => (q.outcome = "won"));
  const rest = scored.slice(gen.won).map((x) => x.q);
  const noBidOrder = rest.map((q) => ({ q, r: rng(q.key, "nobid")() })).sort((a, b) => a.r - b.r || a.q.key.localeCompare(b.q.key));
  noBidOrder.forEach(({ q }, i) => {
    q.outcome = i < gen.no_bid ? "no_bid" : "lost";
    if (q.outcome === "lost") q.lostReason = pickWeighted(rng(q.key, "lost_reason"), LOST_REASONS);
  });

  // ------------------------------------------------------------------ jobs, variance, financials
  const anchorInProcess = input.anchorQuotes.filter((q) => q.job?.status === "in_process").length;
  const genInProcess = t.inProcessWon - anchorInProcess;
  if (genInProcess < 0) throw new GeneratorError("The anchor jobs already exceed the in-process target.");
  const inProcess = new Set(
    quotes
      .filter((q) => q.outcome === "won")
      .sort((a, b) => b.quotedOn.localeCompare(a.quotedOn) || a.key.localeCompare(b.key))
      .slice(0, genInProcess)
      .map((q) => q.key),
  );

  const usedQuoteNumbers = new Set(input.anchorQuotes.map((q) => q.quote_number));
  const usedJobNumbers = new Set(input.anchorQuotes.flatMap((q) => (q.job ? [q.job.job_number] : [])));
  const stats: Record<VarianceGroupStat["group"], number[]> = { routine: [], judgment_ray: [], judgment_non_ray: [], other: [] };
  const driverMean = (d: string) => model.variance.drivers[d]?.mean ?? 0;

  const out: QuoteSeedT[] = quotes.map((q, i) => {
    const n = String(i + 1).padStart(3, "0");
    const id = `Q-G${n}`;
    const quoteNumber = sequenceNumber("RQ", q.quotedOn, usedQuoteNumbers);
    const rate = need0(model.shop_rate_usd_per_hr[q.machineKind], `shop_rate_usd_per_hr.${q.machineKind}`);
    const materialCost = round2(need0(model.material_cost_per_part_usd[q.part.part.material], `material_cost_per_part_usd.${q.part.part.material}`) * q.qty);
    const heavy = q.drivers.some((d) => JUDGMENT_HEAVY.has(d));
    const isRay = q.quotedBy === input.rayPersonId;
    const riskAdder = isRay && heavy ? roundHalf(q.quotedHours * 0.08) : 0;
    const totalCost = q.quotedHours * rate + materialCost;
    const unit = round2(totalCost / (1 - model.target_margin_pct / 100) / q.qty);

    let job: JobSeedT | null = null;
    if (q.outcome === "won") {
      const lead = model.job_leads_by_machine_kind[q.machineKind] ?? null;
      if (inProcess.has(q.key)) {
        const started = minDate(addDays(q.quotedOn, intBetween(rng(q.key, "start"), 3, 10)), addDays(demoToday, -1));
        job = {
          id: `J-G${n}`,
          job_number: sequenceNumber("RJ", started, usedJobNumbers),
          status: "in_process",
          started_on: started,
          shipped_on: null,
          lead: lead && (hireDate.get(lead) ?? "9999") <= started ? lead : null,
          actual_machine: q.machine,
          actual_setup_hours: null,
          actual_run_hours: null,
          actual_hours: null,
          scrap_qty: 0,
          ncr_count: 0,
          on_time: null,
          debrief: "",
        };
      } else {
        let mu = model.variance.base.mean;
        let varSum = model.variance.base.sd ** 2;
        for (const d of q.drivers) {
          const dist = model.variance.drivers[d];
          if (dist) {
            mu += dist.mean;
            varSum += dist.sd ** 2;
          }
        }
        let sigma = Math.sqrt(varSum);
        if (isRay) {
          mu *= model.variance.quoted_by_ray.mean_multiplier;
          sigma *= model.variance.quoted_by_ray.sd_multiplier;
        }
        const [lo, hi] = model.variance.clamp;
        const v = Math.min(hi, Math.max(lo, mu + sigma * normal(rng(q.key, "variance"))));
        const actual = Math.max(0.5, roundHalf(q.quotedHours * (1 + v)));
        const actualSetup = Math.min(actual, Math.max(0.5, roundHalf(actual * (q.setup / q.quotedHours))));
        const realized = (actual - q.quotedHours) / q.quotedHours;
        const group: VarianceGroupStat["group"] = q.drivers.length === 0 ? "routine" : heavy ? (isRay ? "judgment_ray" : "judgment_non_ray") : "other";
        stats[group].push(Math.abs(realized));

        const r = rng(q.key, "job");
        const scrap = realized > 0.2 ? Math.min(q.qty, intBetween(r, 1, 3)) : realized > 0.1 ? intBetween(r, 0, 1) : 0;
        const ncr = scrap > 0 ? intBetween(r, 0, 1) + (realized > 0.3 ? 1 : 0) : 0;
        let started = addDays(q.quotedOn, intBetween(r, 5, 20));
        let shipped = addDays(started, Math.ceil(actual / 7) + intBetween(r, 2, 8));
        const cap = addDays(demoToday, -1);
        if (shipped > cap) shipped = cap;
        if (started > shipped) started = maxDate(q.quotedOn, shipped);
        if (shipped < started) shipped = started;
        const topDriver = [...q.drivers].sort((a, b) => driverMean(b) - driverMean(a) || a.localeCompare(b))[0];
        const pool = Math.abs(realized) >= 0.05 && topDriver && model.debriefs[topDriver] ? model.debriefs[topDriver] : (model.debriefs.routine ?? [""]);
        job = {
          id: `J-G${n}`,
          job_number: sequenceNumber("RJ", started, usedJobNumbers),
          status: "complete",
          started_on: started,
          shipped_on: shipped,
          lead: lead && (hireDate.get(lead) ?? "9999") <= started ? lead : null,
          actual_machine: q.machine,
          actual_setup_hours: actualSetup,
          actual_run_hours: round2(actual - actualSetup),
          actual_hours: actual,
          scrap_qty: scrap,
          ncr_count: ncr,
          on_time: realized <= 0.1 ? true : r() < 0.5,
          debrief: pick(rng(q.key, "debrief"), pool),
        };
      }
    }

    return {
      id,
      quote_number: quoteNumber,
      part: q.part.part.id,
      quoted_on: q.quotedOn,
      quoted_by: q.quotedBy,
      qty: q.qty,
      primary_machine: q.machine,
      secondary_machine: null,
      quoted_setup_hours: q.setup,
      quoted_cycle_minutes: q.cycle,
      quoted_hours: q.quotedHours,
      lead_time_days: q.leadTime,
      outcome: q.outcome!,
      lost_reason: q.outcome === "lost" ? (q.lostReason ?? "unknown") : null,
      notes: "",
      financials: {
        shop_rate_usd_per_hr: rate,
        material_cost_usd: materialCost,
        outside_processing_usd: 0,
        risk_adder_hours: riskAdder,
        scrap_allowance_pct: heavy ? 4 : 0,
        unit_price_usd: unit,
        total_price_usd: round2(unit * q.qty),
        target_margin_pct: model.target_margin_pct,
      },
      job,
    };
  });

  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const groups: VarianceGroupStat[] = (Object.keys(stats) as VarianceGroupStat["group"][]).map((g) => ({ group: g, jobs: stats[g].length, meanAbs: mean(stats[g]) }));
  const routine = mean(stats.routine);
  const heavyNonRay = mean(stats.judgment_non_ray);
  return {
    parts: parts.map((p) => p.part),
    quotes: out,
    report: { groups, ratio: routine && heavyNonRay !== null ? heavyNonRay / routine : null },
  };
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** "AV-{4}-{2}" → "AV-4821-36"; retries until `accept` passes and the customer's pattern matches. */
function makePartNumber(format: string, pattern: RegExp, rng: Rng, accept: (s: string) => boolean): string | null {
  for (let attempt = 0; attempt < 500; attempt++) {
    const s = format.replace(/\{(\d+)\}/g, (_, n: string) => Array.from({ length: Number(n) }, () => String(Math.floor(rng() * 10))).join(""));
    if (pattern.test(s) && accept(s)) return s;
  }
  return null;
}

/** Digit groups of 4+ digits (the numeric cores the entity detector watches). */
function longGroups(partNumber: string): string[] {
  return (partNumber.match(/\d+/g) ?? []).filter((g) => g.length >= 4);
}

/** "RQ-26-0911" style numbers from a date (yy + MMDD), bumped until unused. */
function sequenceNumber(prefix: "RQ" | "RJ", date: string, used: Set<string>): string {
  const yy = date.slice(2, 4);
  let n = Number(date.slice(5, 7) + date.slice(8, 10));
  for (;;) {
    const s = `${prefix}-${yy}-${String(n).padStart(4, "0")}`;
    if (!used.has(s)) {
      used.add(s);
      return s;
    }
    n = (n + 1) % 9000; // 9xxx is reserved for internal work orders
  }
}

function need0(v: number | undefined, what: string): number {
  if (v === undefined) throw new GeneratorError(`quote-model.yaml is missing ${what}.`);
  return v;
}

const maxDate = (a: string, b: string) => (a > b ? a : b);
const minDate = (a: string, b: string) => (a < b ? a : b);
