/**
 * Similar-jobs scorer (PLAN.md §8.4, §4.4 panel rule, §7.6 retrieval invariants).
 *
 * One scorer serves both the Ask context (top 4 similar jobs, classification-blind) and the similar-jobs panel
 * (top 3 of those cleared for the active target, plus a collapsed "not sent" row). It is pure and classification-
 * blind by design: routing only decides afterwards which of the budgeted jobs may be *sent*; it never changes the
 * ranking and never backfills a withheld job with a lower-ranked one.
 *
 * Callers pass only role-visible jobs. Query features come from pinned records or from
 * `parseQueryFeatures()` (`query-features.ts`).
 */

import type { Classification } from "@/db/schema/enums";
import type { QueryFeatures } from "./query-features";

/**
 * Weights of the weighted-overlap score. A job scores the sum of every component it matches:
 *
 * | component        | weight | matches when                                                            |
 * |------------------|--------|-------------------------------------------------------------------------|
 * | customer         | 3      | the job's customer is one of the query's customers                       |
 * | material         | 3      | the job's material is one of the query's materials                       |
 * | feature          | 2      | per distinct feature shared by job and query (unless overridden below)   |
 * | featureOverrides | 4      | `thin_wall` counts double                                                |
 * | family           | 2      | the job's part family is one of the query's families                     |
 * | wallBand         | 1      | both sides know a min wall within {@link SIMILARITY_BANDS}`.wallIn`       |
 * | complexityBand   | 0.5    | the query has a complexity within {@link SIMILARITY_BANDS}`.complexity`  |
 */
export const SIMILARITY_WEIGHTS = Object.freeze({
  customer: 3,
  material: 3,
  feature: 2,
  featureOverrides: Object.freeze({ thin_wall: 4 }) as Readonly<Record<string, number>>,
  family: 2,
  wallBand: 1,
  complexityBand: 0.5,
});

/** Half-widths (inclusive) of the wall and complexity bands. */
export const SIMILARITY_BANDS = Object.freeze({
  /** |Δ min wall| ≤ 0.010 in. */
  wallIn: 0.01,
  /** |Δ complexity| ≤ 1 point. */
  complexity: 1,
});

/** Tolerance for comparing band edges, so 0.045 vs 0.035 in counts as exactly 0.010 in apart. */
const BAND_EPSILON = 1e-9;

/** The projection of a job the scorer needs (no pricing, no free text). */
export interface JobForSimilarity {
  id: string;
  status: "scheduled" | "in_process" | "complete";
  customerId: string | null;
  materialId: string;
  /** PartFeature values of the job's part. */
  features: readonly string[];
  /** PartFamily of the job's part. */
  family: string;
  minWallIn: number | null;
  complexity: number;
  classification: Classification;
  quotedHours: number | null;
  actualHours: number | null;
}

/** What a job is compared against: parsed or pinned features plus optional wall/complexity bands. */
export type SimilarityQuery = QueryFeatures & {
  minWallIn?: number | null;
  complexity?: number | null;
};

/** One ranked job and its score. */
export interface RankedJob<J extends JobForSimilarity = JobForSimilarity> {
  job: J;
  score: number;
}

/** The similar-jobs panel split: jobs shown (cleared) and budgeted jobs not sent to the active target. */
export interface SimilarJobsPanel<J extends JobForSimilarity = JobForSimilarity> {
  shown: RankedJob<J>[];
  notSent: RankedJob<J>[];
}

function featureWeight(feature: string): number {
  return SIMILARITY_WEIGHTS.featureOverrides[feature] ?? SIMILARITY_WEIGHTS.feature;
}

function isNum(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Weighted overlap between a query and one job (see {@link SIMILARITY_WEIGHTS}). Status is not considered here. */
export function scoreJob(query: SimilarityQuery, job: JobForSimilarity): number {
  const w = SIMILARITY_WEIGHTS;
  let score = 0;

  if (job.customerId !== null && query.customerIds.includes(job.customerId)) score += w.customer;
  if (query.materialIds.includes(job.materialId)) score += w.material;

  const queryFeatures = new Set(query.features);
  for (const f of new Set(job.features)) if (queryFeatures.has(f)) score += featureWeight(f);

  if (query.families.includes(job.family)) score += w.family;

  if (isNum(query.minWallIn) && isNum(job.minWallIn)) {
    if (Math.abs(query.minWallIn - job.minWallIn) <= SIMILARITY_BANDS.wallIn + BAND_EPSILON) score += w.wallBand;
  }
  if (isNum(query.complexity) && isNum(job.complexity)) {
    if (Math.abs(query.complexity - job.complexity) <= SIMILARITY_BANDS.complexity + BAND_EPSILON) {
      score += w.complexityBand;
    }
  }
  return score;
}

/** Default number of similar jobs in the Ask context budget (PLAN.md §8.4: 8 cards + 4 jobs). */
export const DEFAULT_SIMILAR_JOBS_LIMIT = 4;

/** Default number of jobs the panel shows (PLAN.md §4.4). */
export const DEFAULT_PANEL_SHOWN = 3;

/**
 * Ranks completed jobs (status `complete` with actual hours) by similarity. Jobs scoring 0 are dropped.
 * Order: score descending, then job ID ascending (code-unit order, locale-independent) — fully deterministic.
 * Classification-blind: export-controlled jobs rank like any other.
 */
export function rankSimilarJobs<J extends JobForSimilarity>(
  query: SimilarityQuery,
  jobs: readonly J[],
  opts: { limit?: number } = {},
): RankedJob<J>[] {
  const limit = Math.max(0, Math.floor(opts.limit ?? DEFAULT_SIMILAR_JOBS_LIMIT));
  const ranked: RankedJob<J>[] = [];
  for (const job of jobs) {
    if (job.status !== "complete" || job.actualHours === null) continue;
    const score = scoreJob(query, job);
    if (score > 0) ranked.push({ job, score });
  }
  ranked.sort((a, b) => b.score - a.score || (a.job.id < b.job.id ? -1 : a.job.id > b.job.id ? 1 : 0));
  return ranked.slice(0, limit);
}

/**
 * Splits the budgeted ranking into the panel rows (PLAN.md §4.4).
 *
 * `ranked` must be the budgeted list — the output of {@link rankSimilarJobs} with the same limit the Ask context
 * uses — so the "not sent" row matches what was actually withheld from the model, never the whole match set.
 *
 * - `shown`: the first `limitShown` jobs cleared for the active target, in rank order;
 * - `notSent`: every budgeted job not cleared for the active target, in rank order (shown to the user with a lock
 *   chip, never sent).
 */
export function similarJobsPanel<J extends JobForSimilarity>(
  ranked: readonly RankedJob<J>[],
  cleared: (c: Classification) => boolean,
  limitShown: number = DEFAULT_PANEL_SHOWN,
): SimilarJobsPanel<J> {
  const shown: RankedJob<J>[] = [];
  const notSent: RankedJob<J>[] = [];
  for (const r of ranked) {
    if (cleared(r.job.classification)) {
      if (shown.length < limitShown) shown.push(r);
    } else {
      notSent.push(r);
    }
  }
  return { shown, notSent };
}
