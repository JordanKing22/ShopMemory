/**
 * P3 — request classification (PLAN.md §4.2, docs/AI-GATEWAY.md §5.2). Pure.
 *
 * floor = max(entities in the user's own text, the session/thread, pinned records, the task's floor). Naming an
 * export-controlled job or part makes the question itself export-controlled. Suspicion signals (numeric core,
 * near-miss customer) come from the same entity detector and mark the request "looks controlled" before anything is
 * sent. Only USER text is classified here: task templates and record bodies never enter `text` (records count through
 * `pinned` and the budget).
 */
import { CLASS_RANK, maxClass, type Classification } from "@/db/schema/enums";
import { analyzeText, type EntityDictionary } from "./entity-detect";
import type { BudgetedRecord, ClassifyRequestInput, RequestClassification } from "./types";

export function classifyRequest(input: ClassifyRequestInput, dict: EntityDictionary): RequestClassification {
  const analysis = analyzeText(input.text.normalize("NFC"), dict);
  const sources = {
    text: analysis.floor,
    session: input.session ?? "general",
    pinned: maxClass(...input.pinned.map((p) => p.classification)),
    task: input.taskFloor,
  };
  return {
    floor: maxClass(sources.text, sources.session, sources.pinned, sources.task),
    sources,
    mentions: analysis.mentions,
    signals: analysis.signals,
    detectorHit: analysis.signals.length > 0,
  };
}

/**
 * The Cloud retrieval signal (PLAN.md §4.2 P3 (3)): the rank-1 hit, or at least half of the budgeted set, is above
 * the target's clearance. False for an empty budget.
 */
export function retrievalSignal(budget: readonly BudgetedRecord[], isCleared: (c: Classification) => boolean): boolean {
  if (budget.length === 0) return false;
  const ranked = [...budget].sort((a, b) => a.rank - b.rank);
  const notCleared = ranked.filter((r) => !isCleared(r.classification)).length;
  return !isCleared(ranked[0].classification) || 2 * notCleared >= ranked.length;
}

/** Highest classification any suspicion signal points to (general when there are none). */
export function signalClassification(req: RequestClassification): Classification {
  return req.signals.reduce<Classification>(
    (acc, s) => (CLASS_RANK[s.classification] > CLASS_RANK[acc] ? s.classification : acc),
    "general",
  );
}
