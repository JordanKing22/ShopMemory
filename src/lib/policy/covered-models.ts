/**
 * Covered models (PLAN.md §4.1): models that require 30-day retention (AWS human-review mode on Bedrock; not available
 * under zero data retention on the first-party API). Preflight, Settings and the Privacy page say so, and
 * export_controlled records are denied to a covered model unless COVERED_MODEL_EC=allow (matrix.ts).
 *
 * Matched by family name so every ID form is caught (first-party IDs, Bedrock "anthropic." / "us." / "global." /
 * "us-gov." profiles and ARNs); any other version of these families also counts (fail closed). Pure.
 */

/** The families named by PLAN.md §4.1 (Fable 5.1, Mythos 5.1, Fable 5, Mythos 5 and their Bedrock IDs). */
export const COVERED_MODEL_FAMILIES = ["fable", "mythos"] as const;

const COVERED_RE = new RegExp(`(?:^|[^a-z0-9])(?:${COVERED_MODEL_FAMILIES.join("|")})(?:[^a-z0-9]|$)`, "i");

export function isCoveredModel(modelId: string | undefined): boolean {
  return typeof modelId === "string" && COVERED_RE.test(modelId);
}
