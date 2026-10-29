/**
 * P5 — user-facing notices (PLAN.md §4.4, docs/AI-GATEWAY.md §5.4). The audit stores only notice_key + params (IDs,
 * enums, counts, hosts); the words are rendered here at view time, for the viewer, with record labels the viewer's
 * role may see. Honest copy (CLAUDE.md hard rule 10): a notice never names a destination the policy didn't use.
 * Pure.
 */
import { CLASSIFICATIONS, type Classification, type ProviderKind, type Role } from "@/db/schema/enums";
import { CLASSIFICATION_LABEL } from "@/lib/classification-labels";
import type { Notice, NoticeAction, RenderedNotice } from "./types";

export interface NoticeContext {
  /** "job RJ-26-0310" for an opaque ID the viewer may see; null → "a record". */
  recordLabel(id: string): string | null;
  role: Role;
}

const PROVIDER_LABEL: Readonly<Record<ProviderKind, string>> = { anthropic: "Anthropic API", bedrock: "Amazon Bedrock", ollama: "Ollama" };
/** As used in "Nothing was sent to …". */
const PROVIDER_SHORT: Readonly<Record<ProviderKind, string>> = { anthropic: "Anthropic", bedrock: "Amazon Bedrock", ollama: "Ollama" };

const KIND_WORD: Readonly<Record<string, [string, string]>> = {
  job: ["related job", "related jobs"],
  card: ["related card", "related cards"],
  quote: ["related quote", "related quotes"],
  part: ["related part", "related parts"],
  document: ["related document", "related documents"],
};

function str(params: Notice["params"], key: string): string {
  const v = params[key];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}
function num(params: Notice["params"], key: string): number {
  const v = params[key];
  return typeof v === "number" ? v : Number.parseInt(String(v ?? "0"), 10) || 0;
}
function providerKind(params: Notice["params"]): ProviderKind {
  const v = str(params, "providerKind");
  return v === "bedrock" || v === "ollama" ? v : "anthropic";
}
function classification(params: Notice["params"]): Classification {
  const v = str(params, "classification");
  return (CLASSIFICATIONS as readonly string[]).includes(v) ? (v as Classification) : "export_controlled";
}
const lower = (c: Classification) => CLASSIFICATION_LABEL[c].toLowerCase();
const MODE_WORD: Readonly<Record<string, string>> = { cloud: "Cloud", local: "Local", hybrid: "Hybrid" };

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export function renderNotice(notice: Notice, ctx: NoticeContext): RenderedNotice {
  const p = notice.params;
  switch (notice.key) {
    case "withheld_records": {
      const count = num(p, "count");
      const kinds = str(p, "recordKinds").split(",").filter(Boolean);
      const words = kinds.length === 1 && KIND_WORD[kinds[0]] ? KIND_WORD[kinds[0]] : (["related record", "related records"] as const);
      const noun = count === 1 ? words[0] : words[1];
      const cls = lower(classification(p));
      const provider = `${PROVIDER_LABEL[providerKind(p)]}${str(p, "model") ? ` · ${str(p, "model")}` : ""}`;
      const mode = MODE_WORD[str(p, "mode")] ?? "This";
      return {
        key: notice.key,
        tone: "info",
        title: `${count} ${noun} ${count === 1 ? "was" : "were"} withheld from this answer.`,
        body: `${count === 1 ? "It is" : "They are"} labeled ${cls}, and ${mode} mode (${provider}) isn't cleared for ${cls} data, so ${count === 1 ? "it was" : "they were"} not sent. Switch to Local or Hybrid to include ${count === 1 ? "it" : "them"}.`,
        actions: ["switch_local"],
      };
    }
    case "blocked_request_controlled": {
      const cls = classification(p);
      const labels = str(p, "recordIds")
        .split(",")
        .filter(Boolean)
        .map((id) => ctx.recordLabel(id) ?? "a record");
      const refers = labels.length > 0 ? `This question refers to ${joinWords([...new Set(labels)])}, which ${labels.length === 1 ? "is" : "are"} labeled ${lower(cls)}.` : `This question is labeled ${lower(cls)}.`;
      const where =
        cls === "export_controlled"
          ? "Export-controlled data can go only to the local model or an allowlisted AWS GovCloud endpoint."
          : `${CLASSIFICATION_LABEL[cls]} data can't go to this provider in the current configuration.`;
      return {
        key: notice.key,
        tone: "blocked",
        title: "Not sent — withheld.",
        body: `${refers} ${where} Nothing was sent to ${PROVIDER_SHORT[providerKind(p)]}.`,
        actions: ["switch_local", "show_matching_records"],
      };
    }
    case "held_looks_controlled": {
      const canSendAnyway = num(p, "canSendAnyway") === 1;
      const actions: NoticeAction[] = canSendAnyway ? ["switch_local", "send_anyway"] : ["switch_local"];
      return {
        key: notice.key,
        tone: "warning",
        title: "Not sent yet.",
        body: "This question looks like it's about export-controlled work (it matches records you can see that are labeled export-controlled).",
        actions,
      };
    }
    case "blocked_hybrid_local_down": {
      const cls = classification(p);
      const target = str(p, "targetKind") === "bedrock" ? "the allowlisted AWS GovCloud endpoint" : "the local model";
      const who = str(p, "targetKind") === "bedrock" ? `the GovCloud endpoint at ${str(p, "host")}` : `Ollama at ${str(p, "host")}`;
      const actions: NoticeAction[] = num(p, "canExclude") === 1 ? ["exclude_controlled"] : [];
      const count = num(p, "count");
      return {
        key: notice.key,
        tone: "blocked",
        title: "Not sent.",
        body: `This request includes ${lower(cls)} records, which must go to ${target}, but ${who} isn't responding. Floorwise never sends controlled data to the cloud as a fallback.${actions.length > 0 ? ` You can ask without the ${count} controlled record${count === 1 ? "" : "s"}.` : ""}`,
        actions,
      };
    }
    case "blocked_local_unavailable":
      return {
        key: notice.key,
        tone: "blocked",
        title: "Not sent.",
        body: `Local mode uses Ollama${str(p, "host") ? ` at ${str(p, "host")}` : ""}, which isn't available right now. Nothing was sent anywhere.`,
        actions: ["open_settings"],
      };
    case "blocked_provider_unavailable":
      return {
        key: notice.key,
        tone: "blocked",
        title: "Not sent.",
        body: `${PROVIDER_LABEL[providerKind(p)]} isn't available with the current configuration. Nothing was sent.`,
        actions: ["open_settings"],
      };
    case "user_excluded_controlled": {
      const count = num(p, "count");
      return {
        key: notice.key,
        tone: "info",
        title: `Sent without ${count} controlled record${count === 1 ? "" : "s"}.`,
        body: "You chose to ask without the records the cloud provider isn't cleared for. They were not sent.",
        actions: [],
      };
    }
    case "sent_after_hold":
      return {
        key: notice.key,
        tone: "warning",
        title: "Sent after you confirmed it isn't export-controlled.",
        body: "This confirmation is recorded in the audit log.",
        actions: [],
      };
    default:
      return { key: notice.key, tone: "info", title: "Notice", body: "", actions: [] };
  }
}

/** Notice params may hold only IDs, enums, counts and hosts: no spaces, no user text. */
export function noticeParamsAreSafe(params: Notice["params"]): boolean {
  return Object.values(params).every((v) => typeof v === "number" || /^[A-Za-z0-9_.:,|/\-[\]]*$/.test(v));
}
