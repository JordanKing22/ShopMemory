/**
 * P4 — the routing decision (PLAN.md §4.4 decide(), docs/AI-GATEWAY.md §5.3). Pure and fail-closed: anything unknown,
 * unavailable or not cleared means nothing is sent there. Never a cloud fallback for data the cloud isn't cleared for.
 *
 *   local  : target = local;  unavailable → blocked(local_unavailable)
 *   cloud  : target = cloud;  unavailable → blocked(provider_unavailable);  floor not cleared → blocked(request_not_cleared)
 *            suspicion signal / retrieval signal → held(looks_controlled) ("send anyway" only without a detector hit)
 *   hybrid : need = max(floor, suspected class, every budgeted record); hybridRoute(need) → cloud / EC target / local,
 *            else blocked(local_unavailable_controlled) — or, if the user asked and only the budget is controlled,
 *            user_excluded_controlled on the cloud with those records withheld (it can only narrow what is sent)
 *   sent = budgeted records cleared for the target; withheld = the rest (no backfill); redact = target is cloud
 */
import { maxClass, type Classification } from "@/db/schema/enums";
import type { RecordRef } from "@/lib/ai/types";
import { allowed, hybridRoute, type RouteTarget } from "./matrix";
import { retrievalSignal, signalClassification } from "./classify-request";
import type {
  BlockedDecision,
  BudgetedRecord,
  Decision,
  DecideInput,
  HeldDecision,
  HoldTrigger,
  Notice,
  PolicyTarget,
  SendDecision,
  WithheldRecord,
} from "./types";

function ok(t: PolicyTarget | null, c: Classification): boolean {
  return t !== null && t.descriptor.available && allowed(c, t.descriptor.targetClass, t.opts);
}

function withheldAll(budget: readonly BudgetedRecord[]): WithheldRecord[] {
  return budget.map((b) => ({ ref: b.ref, classification: b.classification, reason: "not_cleared_for_target" as const }));
}

function hostPort(t: PolicyTarget | null): string {
  if (!t) return "";
  try {
    return new URL(t.descriptor.baseUrl).host || t.descriptor.host;
  } catch {
    return t.descriptor.host;
  }
}

function highest(cs: readonly Classification[]): Classification {
  return maxClass(...cs);
}

function recordKinds(refs: readonly RecordRef[]): string {
  return [...new Set(refs.map((r) => r.kind))].sort().join(",");
}

function blocked(
  reason: BlockedDecision["reason"],
  target: PolicyTarget | null,
  budget: readonly BudgetedRecord[],
  notice: Notice,
  canExcludeControlled = false,
): BlockedDecision {
  return { kind: "blocked", reason, target, withheld: withheldAll(budget), canExcludeControlled, notice };
}

function send(
  target: PolicyTarget,
  budget: readonly BudgetedRecord[],
  cleared: (c: Classification) => boolean,
  opts: { reason: WithheldRecord["reason"]; userExcluded?: boolean; heldOverride?: boolean; triggers?: HoldTrigger[]; mode: string },
): SendDecision {
  const sent = budget.filter((b) => cleared(b.classification));
  const withheld = budget
    .filter((b) => !cleared(b.classification))
    .map((b) => ({ ref: b.ref, classification: b.classification, reason: opts.reason }));
  const kind: SendDecision["kind"] = opts.userExcluded ? "user_excluded_controlled" : withheld.length > 0 ? "withheld_partial" : "allow";
  let notice: Notice | null = null;
  if (opts.userExcluded) {
    notice = { key: "user_excluded_controlled", params: { count: withheld.length } };
  } else if (opts.heldOverride) {
    notice = { key: "sent_after_hold", params: { withheldCount: withheld.length, triggers: (opts.triggers ?? []).join(",") } };
  } else if (withheld.length > 0) {
    notice = {
      key: "withheld_records",
      params: {
        count: withheld.length,
        recordKinds: recordKinds(withheld.map((w) => w.ref)),
        classification: highest(withheld.map((w) => w.classification)),
        mode: opts.mode,
        providerKind: target.descriptor.kind,
        model: target.descriptor.model,
      },
    };
  }
  return { kind, target, sent, withheld, redact: target.descriptor.isCloud, heldOverride: opts.heldOverride === true, notice };
}

function routeTarget(t: PolicyTarget | null, fallback: RouteTarget["targetClass"]): RouteTarget {
  return t
    ? { targetClass: t.descriptor.targetClass, opts: t.opts, available: t.descriptor.available }
    : { targetClass: fallback, available: false };
}

export function decide(input: DecideInput): Decision {
  const { mode, request, budget, targets } = input;
  const floor = request.floor;
  const budgetClasses = budget.map((b) => b.classification);

  if (mode === "local") {
    const t = targets.local;
    const need = highest([floor, ...budgetClasses]);
    if (!ok(t, need)) {
      return blocked("local_unavailable", t, budget, {
        key: "blocked_local_unavailable",
        params: { host: hostPort(t), model: t?.descriptor.model ?? "" },
      });
    }
    return send(t!, budget, () => true, { reason: "not_cleared_for_target", mode });
  }

  if (mode === "cloud") {
    const t = targets.cloud;
    if (!t || !t.descriptor.available) {
      return blocked("provider_unavailable", t, budget, {
        key: "blocked_provider_unavailable",
        params: { providerKind: t?.descriptor.kind ?? "anthropic" },
      });
    }
    const cleared = (c: Classification) => ok(t, c);
    if (!cleared(floor)) {
      const ids = [
        ...request.mentions.filter((m) => !cleared(m.classification)).map((m) => m.id),
        ...(input.pinned ?? []).filter((p) => !cleared(p.classification)).map((p) => p.ref.id),
      ];
      return blocked("request_not_cleared", t, budget, {
        key: "blocked_request_controlled",
        params: {
          recordIds: [...new Set(ids)].join(","),
          classification: floor,
          providerKind: t.descriptor.kind,
          model: t.descriptor.model,
        },
      });
    }
    const triggers: HoldTrigger[] = [];
    for (const kind of ["numeric_core", "near_miss_customer"] as const) {
      if (request.signals.some((s) => s.kind === kind)) triggers.push(kind);
    }
    if (retrievalSignal(budget, cleared)) triggers.push("retrieval");
    let heldOverride = false;
    if (triggers.length > 0) {
      const canSendAnyway = !request.detectorHit;
      if (request.detectorHit || !input.confirmNotControlled) {
        const held: HeldDecision = {
          kind: "held",
          reason: "looks_controlled",
          target: t,
          triggers,
          canSendAnyway,
          withheld: withheldAll(budget),
          notice: {
            key: "held_looks_controlled",
            params: { triggers: triggers.join(","), canSendAnyway: canSendAnyway ? 1 : 0, providerKind: t.descriptor.kind },
          },
        };
        return held;
      }
      heldOverride = true;
    }
    return send(t, budget, cleared, { reason: "not_cleared_for_target", heldOverride, triggers, mode });
  }

  // Hybrid: a suspected-controlled request is routed like the class it is suspected of (fail closed).
  const need = highest([floor, request.detectorHit ? signalClassification(request) : "general", ...budgetClasses]);
  const route = hybridRoute(need, {
    cloud: routeTarget(targets.cloud, "anthropic"),
    ecTarget: routeTarget(targets.ecTarget, "ollama_local"),
    local: routeTarget(targets.local, "ollama_local"),
  });
  if (route.to === "cloud") return send(targets.cloud!, budget, () => true, { reason: "not_cleared_for_target", mode });
  if (route.to === "ec_target") return send(targets.ecTarget!, budget, () => true, { reason: "not_cleared_for_target", mode });
  if (route.to === "local") return send(targets.local!, budget, () => true, { reason: "not_cleared_for_target", mode });

  const cloud = targets.cloud;
  const cloudCleared = (c: Classification) => ok(cloud, c);
  const floorClearedForCloud = cloudCleared(floor) && !request.detectorHit;
  const controlled = budget.filter((b) => !cloudCleared(b.classification));
  if (input.excludeAboveClearance && floorClearedForCloud && cloud) {
    return send(cloud, budget, cloudCleared, { reason: "user_excluded", userExcluded: true, mode });
  }
  const waiting = targets.ecTarget ?? targets.local;
  const canExclude = floorClearedForCloud && controlled.length > 0;
  return blocked(
    "local_unavailable_controlled",
    waiting,
    budget,
    {
      key: "blocked_hybrid_local_down",
      params: {
        host: hostPort(waiting),
        count: controlled.length,
        classification: need,
        canExclude: canExclude ? 1 : 0,
        targetKind: waiting?.descriptor.kind ?? "ollama",
      },
    },
    canExclude,
  );
}
