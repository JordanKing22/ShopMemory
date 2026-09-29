/**
 * Demo invariants checked by seed:check (PLAN.md §6, §7.4, §7.6): the golden coverage numbers before and after
 * Ray approves KC-091…094, the SPOF set, the similar-jobs ranking for Maya's question, and variance clustering.
 * A failure is a "demo invariant" error naming the cell, record or group.
 */
import { PART_FAMILIES, PART_FEATURES } from "@/db/schema/enums";
import type { BundleTables } from "./bundle";
import { computeCoverage, type CoverageCard, type CoverageResult, type ExpertiseLevel } from "@/lib/coverage/compute";
import { parseQueryFeatures } from "@/lib/retrieval/query-features";
import { rankSimilarJobs, type JobForSimilarity } from "@/lib/retrieval/similar-jobs";
import type { AnchorsSeed } from "./parse";
import type { IssueList } from "./source";

export const RAY_ID = "PER-01";
export const VARIANCE_RATIO_MIN = 2.5;
const JUDGMENT_HEAVY = new Set(["thin_wall", "titanium", "inconel"]);

export interface InvariantJob extends JobForSimilarity {
  quotedBy: string | null;
  drivers: string[];
}

export interface InvariantInput {
  demoToday: string;
  anchors: AnchorsSeed;
  people: { id: string; hireDate: string; plannedDepartureDate: string | null }[];
  topics: { id: string }[];
  expertise: { personId: string; topicId: string; level: number }[];
  cards: CoverageCard[];
  scriptedCards: CoverageCard[];
  customers: { id: string; names: string[] }[];
  materials: { id: string; names: string[] }[];
  synonyms: string[][];
  jobs: InvariantJob[];
  issues: IssueList;
}

export interface VarianceGroup {
  group: string;
  jobs: number;
  meanAbsPct: number | null;
}

export interface InvariantReport {
  golden: { key: string; phase: "before" | "after"; expected: number; actual: number | null; ok: boolean }[];
  spofBefore: string[];
  spofAfter: string[];
  similarJobs: { id: string; score: number }[];
  variance: VarianceGroup[];
  varianceRatio: number | null;
}

type BaselineRow = Omit<BundleTables["coverageSnapshots"][number], "takenAt" | "reason">;

const FILE = "demo/anchors.yaml";

export function runInvariants(input: InvariantInput): { report: InvariantReport; baseline: BaselineRow[] } {
  const { issues } = input;
  const report: InvariantReport = { golden: [], spofBefore: [], spofAfter: [], similarJobs: [], variance: [], varianceRatio: null };

  // ------------------------------------------------------------------ coverage
  const base = {
    demoToday: input.demoToday,
    people: input.people,
    topics: input.topics,
    expertise: input.expertise.map((e) => ({ ...e, level: e.level as ExpertiseLevel })),
  };
  let before: CoverageResult | null = null;
  let after: CoverageResult | null = null;
  try {
    before = computeCoverage({ ...base, cards: input.cards });
    after = computeCoverage({ ...base, cards: [...input.cards, ...input.scriptedCards] });
  } catch (e) {
    issues.error(FILE, `Coverage could not be computed: ${e instanceof Error ? e.message : "invalid input"}.`, "demo_invariant");
  }
  const baseline: BaselineRow[] = [];
  if (before && after) {
    for (const [phase, result, golden] of [
      ["before", before, input.anchors.golden.before],
      ["after", after, input.anchors.golden.after],
    ] as const) {
      for (const [key, expected] of Object.entries(golden)) {
        const actual = goldenValue(result, key);
        if (actual === undefined) {
          issues.error(FILE, `Golden key "${key}" isn't understood (use "PER-01|t-topic", "coverage:t-topic", "deep:PER-01" or "top:PER-01").`, "demo_invariant");
          continue;
        }
        const tolerant = key.startsWith("coverage:") || key.startsWith("deep:");
        const ok = actual !== null && (tolerant ? Math.abs(actual - expected) < 0.05 + 1e-9 : actual === expected);
        report.golden.push({ key, phase, expected, actual, ok });
        if (!ok) {
          issues.error(
            FILE,
            `Demo invariant: ${phase === "before" ? "before the live interview" : "after Ray approves KC-091…094"}, ${key} must be ${expected} (it is ${actual ?? "missing"}). Check the expertise matrix and the cards tagged with that topic.`,
            "demo_invariant",
          );
        }
      }
    }
    report.spofBefore = spofSet(before);
    report.spofAfter = spofSet(after);
    const expectedSpof = [...input.anchors.golden.spof].sort();
    for (const [phase, set] of [
      ["before", report.spofBefore],
      ["after", report.spofAfter],
    ] as const) {
      if (set.join() !== expectedSpof.join()) {
        issues.error(FILE, `Demo invariant: single points of failure ${phase} the interview must be exactly ${expectedSpof.join(", ")} (found ${set.join(", ") || "none"}).`, "demo_invariant");
      }
    }
    for (const c of before.cells) {
      baseline.push({ scope: "cell", topicId: c.topicId, personId: c.personId, coverage: null, capturedPct: Math.round(c.captured * 1000) / 10, risk: c.risk });
    }
    for (const t of before.topics) {
      baseline.push({ scope: "topic", topicId: t.topicId, personId: null, coverage: t.coverage, capturedPct: null, risk: t.risk });
    }
    for (const pr of before.people) {
      baseline.push({ scope: "person", topicId: null, personId: pr.personId, coverage: null, capturedPct: pr.deepCoveragePct, risk: pr.maxRisk });
    }
  }

  // ------------------------------------------------------------------ similar jobs
  const sj = input.anchors.similar_jobs;
  const features = parseQueryFeatures(sj.query, {
    customers: input.customers,
    materials: input.materials,
    features: vocabulary(PART_FEATURES, input.synonyms),
    families: vocabulary(PART_FAMILIES, input.synonyms),
  });
  const ranked = rankSimilarJobs(features, input.jobs, { limit: 6 });
  report.similarJobs = ranked.map((r) => ({ id: r.job.id, score: r.score }));
  const top3 = ranked.slice(0, 3).map((r) => r.job.id).sort();
  if (top3.join() !== [...sj.expected_top3].sort().join()) {
    issues.error(FILE, `Demo invariant: for "${sj.query}" the top 3 similar jobs must be ${sj.expected_top3.join(", ")} (found ${top3.join(", ") || "none"}).`, "demo_invariant");
  }
  if (ranked[3]?.job.id !== sj.expected_rank4) {
    issues.error(FILE, `Demo invariant: for "${sj.query}" job ${sj.expected_rank4} must rank 4th (found ${ranked[3]?.job.id ?? "none"}).`, "demo_invariant");
  }

  // ------------------------------------------------------------------ variance clustering
  const done = input.jobs.filter((j) => j.status === "complete" && j.quotedHours !== null && j.actualHours !== null);
  const v = (j: InvariantJob) => Math.abs((j.actualHours! - j.quotedHours!) / j.quotedHours!) * 100;
  const heavy = (j: InvariantJob) => j.drivers.some((d) => JUDGMENT_HEAVY.has(d));
  const groups: [string, InvariantJob[]][] = [
    ["routine (no judgment drivers)", done.filter((j) => j.drivers.length === 0)],
    ["judgment-heavy, not quoted by Ray", done.filter((j) => heavy(j) && j.quotedBy !== RAY_ID)],
    ["judgment-heavy, quoted by Ray", done.filter((j) => heavy(j) && j.quotedBy === RAY_ID)],
    ["other drivers", done.filter((j) => j.drivers.length > 0 && !heavy(j))],
  ];
  report.variance = groups.map(([group, js]) => ({ group, jobs: js.length, meanAbsPct: js.length ? round1(js.reduce((s, j) => s + v(j), 0) / js.length) : null }));
  const routine = report.variance[0].meanAbsPct;
  const heavyNonRay = report.variance[1].meanAbsPct;
  if (routine === null || heavyNonRay === null) {
    issues.error("quotes/quote-model.yaml", "Variance clustering needs completed routine jobs and judgment-heavy jobs not quoted by Ray.", "demo_invariant");
  } else {
    report.varianceRatio = routine === 0 ? Infinity : round1(heavyNonRay / routine);
    if (heavyNonRay < VARIANCE_RATIO_MIN * routine) {
      issues.error(
        "quotes/quote-model.yaml",
        `Demo invariant: judgment-heavy jobs not quoted by Ray must miss their quote by at least ${VARIANCE_RATIO_MIN}× the routine average (${heavyNonRay}% vs ${routine}%).`,
        "demo_invariant",
      );
    }
  }

  return { report, baseline };
}

function goldenValue(r: CoverageResult, key: string): number | null | undefined {
  const cell = /^(PER-\d{2})\|(t-[a-z0-9-]+)$/.exec(key);
  if (cell) return r.cells.find((c) => c.personId === cell[1] && c.topicId === cell[2])?.risk ?? null;
  const [kind, id] = key.split(":");
  if (kind === "coverage") return r.topics.find((t) => t.topicId === id)?.coverage ?? null;
  if (kind === "deep") return r.people.find((p) => p.personId === id)?.deepCoveragePct ?? null;
  if (kind === "top") return r.people.find((p) => p.personId === id)?.maxRisk ?? null;
  return undefined;
}

function spofSet(r: CoverageResult): string[] {
  return r.cells.filter((c) => c.spof).map((c) => `${c.personId}|${c.topicId}`).sort();
}

/** Phrases for each enum value: "thin_wall" → ["thin wall", "thin-wall", …and its search-synonym group]. */
export function vocabulary(values: readonly string[], synonyms: string[][]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const v of values) {
    const base = [...new Set([v.replace(/_/g, " "), v.replace(/_/g, "-")])];
    const group = synonyms.find((g) => g.some((s) => base.includes(s.toLowerCase())));
    out[v] = [...new Set([...base, ...(group ?? []).map((s) => s.toLowerCase())])];
  }
  return out;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

