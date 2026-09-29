/**
 * Plain-language routing copy for the header provider badge and its details panel (PLAN.md §4.4, §4.11), reused
 * by Settings and the Privacy page. CLAUDE.md hard rule 10 (honest UI copy): the words never name a destination
 * the policy doesn't actually use. Pure and server-only-free (node-env tests import it):
 * - it never decides routing itself; every "where does X go" answer comes from summary.routes (hybridRoute())
 *   and summary.clearance, so a target that is unusable, or not cleared for a label, is never described as
 *   receiving it;
 * - "on this computer" / "Nothing leaves this computer" only for a loopback target.
 */
import { CLASSIFICATIONS, type Classification } from "@/db/schema/enums";
import { CLASSIFICATION_LABEL } from "@/lib/classification-labels";
import { formatProviderLine } from "@/lib/format";
import type { CrossRegion } from "@/lib/policy/matrix";
import type { RouteDestination, RoutingSummary, RoutingTarget } from "@/lib/policy/summary";

/** The target a destination names; undefined for "blocked" (or a target the summary doesn't carry). */
export function destinationTarget(summary: RoutingSummary, dest: RouteDestination): RoutingTarget | undefined {
  switch (dest) {
    case "primary":
      return summary.primary;
    case "secondary":
      return summary.secondary;
    case "local":
      return summary.local;
    default:
      return undefined;
  }
}

/** Provider name as used in sentences; GovCloud is named so it can't be mistaken for a commercial region. */
export function targetName(t: RoutingTarget): string {
  return t.targetClass === "bedrock_govcloud" ? `${t.providerLabel} in AWS GovCloud` : t.providerLabel;
}

const onThisComputer = (t: RoutingTarget) => (t.isLoopback ? " on this computer" : "");

function joinWords(words: string[], conj: "and" | "or"): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} ${conj} ${words[words.length - 1]}`;
}

const labels = (levels: Classification[]) => levels.map((l) => CLASSIFICATION_LABEL[l]);
const lowerLabels = (levels: Classification[]) => labels(levels).map((w) => w.toLowerCase());

/** Heading of the clearance list and aria-label of the header dots. */
export function clearanceListLabel(summary: RoutingSummary): string {
  return summary.mode === "hybrid" ? "Which labels can be sent in this mode" : "Which labels this provider may receive";
}

/**
 * One sentence per clearance dot (visible in the details panel, sr-only in the header). Hybrid names the real
 * destination of every level: the cloud side, the export-controlled target or the local model.
 */
export function clearanceText(level: Classification, summary: RoutingSummary): string {
  const word = CLASSIFICATION_LABEL[level];
  const dest = summary.routes[level];
  const target = destinationTarget(summary, dest);
  const sent = dest !== "blocked" && target !== undefined && summary.clearance[level];
  if (summary.mode !== "hybrid") {
    return sent ? `${word}: can be sent to this provider` : `${word}: not sent to this provider`;
  }
  if (!sent || !target) return `${word}: not sent in this mode`;
  if (dest === "primary") return `${word}: sent to ${targetName(target)}`;
  return `${word}: sent only to ${targetName(target)}${onThisComputer(target)}`;
}

export const EC_BLOCKED_SENTENCE =
  "Export-controlled requests are blocked until a usable local or allowlisted GovCloud target is set up (see Configuration needs attention). Floorwise never sends them to the cloud as a fallback.";

/** The summary sentence at the top of the details panel. */
export function modeSentence(summary: RoutingSummary): string {
  const p = summary.primary;
  const name = targetName(p);
  const { routes } = summary;

  switch (summary.mode) {
    case "cloud": {
      if (!p.configured) return `Nothing can be sent: ${name} isn't configured (see Configuration needs attention).`;
      const withheld = CLASSIFICATIONS.filter((c) => routes[c] !== "primary");
      return withheld.length === 0
        ? `AI requests go to ${name}.`
        : `AI requests go to ${name}. Records labeled ${joinWords(lowerLabels(withheld), "or")} are not sent to it.`;
    }
    case "local": {
      const where = p.host || "the configured host";
      if (!p.configured) return `Nothing can be sent: ${name} at ${where} isn't a usable local target.`;
      if (p.isLoopback) return `AI requests go to ${name} on this computer. Nothing leaves this computer.`;
      const unencrypted = p.locality === "on_prem_unencrypted" ? ", unencrypted" : "";
      return `AI requests go to ${name} at ${where} (an allowlisted on-prem server${unencrypted}).`;
    }
    case "hybrid": {
      const s = summary.secondary;
      const toPrimary = CLASSIFICATIONS.filter((c) => routes[c] === "primary");
      const toLocal = CLASSIFICATIONS.filter((c) => c !== "export_controlled" && routes[c] === "local");
      const blockedNonEc = CLASSIFICATIONS.filter((c) => c !== "export_controlled" && routes[c] === "blocked");
      const ecOk = Boolean(s) && summary.clearance.export_controlled && routes.export_controlled === "secondary";
      const out: string[] = [];

      if (toPrimary.length > 0 && ecOk && s) {
        out.push(
          `AI requests go to ${name}; anything labeled export-controlled goes to ${targetName(s)}${onThisComputer(s)} instead.`,
        );
      } else {
        out.push(toPrimary.length > 0 ? `AI requests go to ${name}.` : `Nothing is sent to ${name}${p.configured ? "" : " (it isn't configured)"}.`);
        if (ecOk && s) out.push(`Export-controlled records go only to ${targetName(s)}${onThisComputer(s)}.`);
      }
      const local = summary.local;
      if (toLocal.length > 0 && local) {
        out.push(`${joinWords(labels(toLocal), "and")} records go only to ${targetName(local)}${onThisComputer(local)}.`);
      }
      if (blockedNonEc.length > 0) out.push(`${joinWords(labels(blockedNonEc), "and")} records are not sent in this mode.`);
      if (!ecOk) out.push(EC_BLOCKED_SENTENCE);
      return out.join(" ");
    }
    default:
      return `AI requests go to ${name}.`;
  }
}

/** The header's second line in Hybrid: where export-controlled records go, or "EC → blocked". null otherwise. */
export function ecHeaderLabel(summary: RoutingSummary): string | null {
  if (summary.mode !== "hybrid" || !summary.secondary) return null;
  const ecOk = summary.clearance.export_controlled && summary.routes.export_controlled === "secondary";
  return ecOk ? `EC → ${formatProviderLine(summary.secondary)}` : "EC → blocked";
}

/** Heading of the export-controlled target block in the details panel. */
export function ecTargetHeading(summary: RoutingSummary): string {
  return summary.clearance.export_controlled ? "Export-controlled requests" : "Export-controlled target (blocked)";
}

/**
 * Hybrid with a GovCloud EC target: show the local model as its own block when some label is routed to it
 * (with a local EC target it is the same target as the EC block).
 */
export function showLocalTarget(summary: RoutingSummary): boolean {
  return (
    summary.mode === "hybrid" &&
    summary.local !== undefined &&
    summary.secondary?.targetClass !== "ollama_local" &&
    CLASSIFICATIONS.some((c) => summary.routes[c] === "local")
  );
}

/** Details-panel "Where" row. */
export function whereText(t: RoutingTarget): string {
  if (!t.configured) return "Not configured: nothing can be sent here";
  if (t.isCloud) return t.targetClass === "bedrock_govcloud" ? "AWS GovCloud (allowlisted endpoint)" : "Cloud service";
  if (t.isLoopback) return "This computer";
  switch (t.locality) {
    case "on_prem":
      return "On-prem server on your network (https)";
    case "on_prem_unencrypted":
      return "On-prem server on your network (unencrypted)";
    default:
      return "Not a local host";
  }
}

/** Details-panel "Cross-region" row for Bedrock targets. */
export const CROSS_REGION_TEXT: Readonly<Record<CrossRegion, string>> = {
  global: "Global profile: may run in commercial AWS regions worldwide",
  geo: "Geography profile: runs in AWS regions within one geography",
  none: "In-region only",
  unknown: "Cross-region scope unknown (treated as global)",
};

/** Details-panel "Retention" row (PLAN.md §4.1 covered models). */
export const COVERED_MODEL_TEXT = "Covered model: requires 30-day retention";
