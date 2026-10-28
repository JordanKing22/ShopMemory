/**
 * Shared policy types (docs/AI-GATEWAY.md §5). Type-only plus a few constants: routing decisions themselves live in
 * decide.ts / classify-request.ts / matrix.ts (CLAUDE.md hard rule 5). Written by the architect; the policy builder
 * owns this file afterwards and may add to it, never change an existing shape without updating the contract.
 */
import type { AIMode, AuditDecision, Classification } from "@/db/schema/enums";
import type { EntityMention, SuspicionSignal } from "@/lib/policy/entity-detect";
import type { PolicyOptions } from "@/lib/policy/matrix";
import type { ProviderDescriptor, RecordRef } from "@/lib/ai/types";

// ---------------------------------------------------------------------------------------------------------------
// Settings precedence (PLAN.md §4.11)
// ---------------------------------------------------------------------------------------------------------------

/** app_settings key of the in-app routing setting. Reset demo deletes it (src/db/reset.ts clears app_settings). */
export const AI_ROUTING_SETTING_KEY = "ai_routing";

export type CloudProviderKind = "anthropic" | "bedrock";

/** The in-app setting written by the setAiRouting Server Action (value of app_settings[ai_routing]). */
export interface AiRoutingSetting {
  mode: AIMode;
  cloudProvider: CloudProviderKind;
}

/**
 * Where the effective mode/provider came from: AI_SETTINGS_LOCKED=true → "locked_env" (env only, the setting is
 * ignored and the picker is disabled); else a valid app_settings[ai_routing] → "setting"; else "env"
 * (LLM_PROVIDER + AI_MODE, whose own defaults give cloud/Anthropic).
 */
export type RoutingSource = "locked_env" | "setting" | "env";

export interface EffectiveRouting {
  mode: AIMode;
  /** Cloud side for Cloud and Hybrid modes. */
  cloudProvider: CloudProviderKind;
  source: RoutingSource;
  /** AI_SETTINGS_LOCKED=true. */
  locked: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// P3: request classification
// ---------------------------------------------------------------------------------------------------------------

export interface ClassifyRequestInput {
  /**
   * All text the user supplied for this request (input text + user turns), NFC. Never task template text, never
   * record bodies (records contribute through `pinned` and the budget).
   */
  text: string;
  /** The task's own minimum (smoke: internal). */
  taskFloor: Classification;
  /** Classification of the session / thread the request belongs to, if any. */
  session: Classification | null;
  /** Pinned records with their DB classification (loaded by the gateway, never from the client). */
  pinned: readonly { ref: RecordRef; classification: Classification }[];
}

export interface RequestClassification {
  /** max(text entities, session, pinned, task floor). */
  floor: Classification;
  sources: { text: Classification; session: Classification; pinned: Classification; task: Classification };
  mentions: readonly EntityMention[];
  /** Deterministic suspicion signals from the entity detector (numeric core, near-miss customer). */
  signals: readonly SuspicionSignal[];
  /** signals.length > 0. A detector hit means "It isn't — send anyway" is never offered. */
  detectorHit: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// P2/P4: budget and decision
// ---------------------------------------------------------------------------------------------------------------

/** One record of the task's context budget, chosen ignoring classification (PLAN.md §4.2 P2). */
export interface BudgetedRecord {
  ref: RecordRef;
  classification: Classification;
  /** 1-based position in the budget (1 = best hit). */
  rank: number;
}

export const WITHHELD_REASONS = ["not_cleared_for_target", "user_excluded"] as const;
export type WithheldReason = (typeof WITHHELD_REASONS)[number];

export interface WithheldRecord {
  ref: RecordRef;
  classification: Classification;
  reason: WithheldReason;
}

/** A concrete destination plus the policy facts its conditional matrix cells depend on. */
export interface PolicyTarget {
  descriptor: ProviderDescriptor;
  opts: PolicyOptions;
}

export interface PolicyTargets {
  /** The configured cloud provider (Anthropic or Bedrock), even if unavailable; null in Local mode. */
  cloud: PolicyTarget | null;
  /** Local Ollama, even if unavailable; null when not needed by the mode. */
  local: PolicyTarget | null;
  /** Hybrid only: where export_controlled goes (local Ollama, or Bedrock GovCloud when HYBRID_EC_TARGET=govcloud). */
  ecTarget: PolicyTarget | null;
}

export interface DecideInput {
  mode: AIMode;
  request: RequestClassification;
  /** Budget in rank order. Records the role can't see were already dropped (P1) and are never mentioned. */
  budget: readonly BudgetedRecord[];
  targets: PolicyTargets;
  /** Hybrid escape hatch: server-recomputed, can only narrow what is sent. Ignored outside Hybrid. */
  excludeAboveClearance: boolean;
  /** Held → "It isn't — send anyway". Honoured only when there is no detector hit. */
  confirmNotControlled: boolean;
}

export const BLOCK_REASONS = [
  /** Cloud mode: the request floor itself is not cleared for the cloud target (e.g. it names an EC job). */
  "request_not_cleared",
  /** Local mode: Ollama is not available (unreachable, not local-qualified, or a remote_host model). */
  "local_unavailable",
  /** Hybrid: the request needs the local/EC target and it is down. FAIL CLOSED: never a cloud fallback. */
  "local_unavailable_controlled",
  /** Cloud mode: the cloud provider isn't configured/usable (missing key in live mode, missing AWS_REGION…). */
  "provider_unavailable",
] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];

export const HOLD_REASONS = ["looks_controlled"] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

/** What put a request on hold: the two text signals (detector hits) or the Cloud retrieval signal. */
export type HoldTrigger = "numeric_core" | "near_miss_customer" | "retrieval";

export type SendDecisionKind = Extract<AuditDecision, "allow" | "withheld_partial" | "user_excluded_controlled">;

export interface SendDecision {
  kind: SendDecisionKind;
  target: PolicyTarget;
  /** Budget records cleared for the target, in rank order. They get the S# keys. */
  sent: BudgetedRecord[];
  /** Budget records not sent (no backfill). Empty for "allow". */
  withheld: WithheldRecord[];
  /** target.descriptor.isCloud (GovCloud included). */
  redact: boolean;
  /** The user confirmed a held request ("It isn't — send anyway"); audited + possible_controlled_content_sent event. */
  heldOverride: boolean;
  notice: Notice | null;
}

export interface BlockedDecision {
  kind: "blocked";
  reason: BlockReason;
  /** The target that was refused or unavailable (null only when no target could be built at all). */
  target: PolicyTarget | null;
  /** Every budget record (nothing is sent). */
  withheld: WithheldRecord[];
  /** Hybrid + local down + request floor cleared for an available cloud target: offer "Ask without the N controlled records". */
  canExcludeControlled: boolean;
  notice: Notice;
}

export interface HeldDecision {
  kind: "held";
  reason: HoldReason;
  target: PolicyTarget;
  triggers: HoldTrigger[];
  /** true only when no detector hit (retrieval signal alone). */
  canSendAnyway: boolean;
  withheld: WithheldRecord[];
  notice: Notice;
}

export type Decision = SendDecision | BlockedDecision | HeldDecision;

// ---------------------------------------------------------------------------------------------------------------
// P5: notices (stored as notice_key + notice_params; rendered at view time by notices.ts)
// ---------------------------------------------------------------------------------------------------------------

export const NOTICE_KEYS = [
  "withheld_records",
  "blocked_request_controlled",
  "blocked_local_unavailable",
  "blocked_hybrid_local_down",
  "blocked_provider_unavailable",
  "held_looks_controlled",
  "user_excluded_controlled",
  "sent_after_hold",
] as const;
export type NoticeKey = (typeof NOTICE_KEYS)[number];

/**
 * Params hold IDs, enums, counts and hosts only — never names, part/job/quote numbers or user text (the audit
 * stores them; CLAUDE.md hard rule 2). Record IDs are comma-joined opaque DB IDs ("J-A10"); notices.ts resolves
 * display labels at view time for the viewer's role.
 */
export type NoticeParams = Record<string, string | number>;

export interface Notice {
  key: NoticeKey;
  params: NoticeParams;
}

export type NoticeAction = "switch_local" | "show_matching_records" | "send_anyway" | "exclude_controlled" | "open_settings";

export interface RenderedNotice {
  key: NoticeKey;
  tone: "info" | "warning" | "blocked";
  title: string;
  body: string;
  actions: NoticeAction[];
}
