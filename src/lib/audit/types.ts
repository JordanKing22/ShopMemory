/**
 * Shared audit types (PLAN.md §4.7, §5.2; docs/AI-GATEWAY.md §7). Type-only plus a few constants. Written by the
 * architect; the audit builder owns this file afterwards and may add to it.
 *
 * ai_audit_log and event_log hold REDACTED text, IDs and enums only — never names, prompts, transcripts, keys or raw
 * errors (CLAUDE.md hard rule 2). Rows are written once (write-ahead or complete) and finalized once; a trigger
 * blocks updates after completion.
 */
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type {
  AIMode,
  AuditOutcome,
  AuditTransport,
  CassetteProvenance,
  Classification,
  EventKind,
  PayloadStoredForm,
  ProviderKind,
  Role,
  TargetClass,
} from "@/db/schema/enums";
import type { aiAuditLog, eventLog } from "@/db/schema/system";
import type { FeatureName, SelectedTransport, TaskName } from "@/lib/ai/types";
import type { AIErrorCode } from "@/lib/ai/errors";
import type { CrossRegion } from "@/lib/policy/matrix";
import type { Notice, SendDecisionKind, WithheldReason } from "@/lib/policy/types";

export type AuditRow = InferSelectModel<typeof aiAuditLog>;
export type AuditInsert = InferInsertModel<typeof aiAuditLog>;
export type EventRow = InferSelectModel<typeof eventLog>;
export type EventInsert = InferInsertModel<typeof eventLog>;

/** ai_audit_log.app_version. Must equal package.json "version" (asserted by tests/audit-writer.test.ts). */
export const APP_VERSION = "0.1.0";

/** Seeded example rows (seed-data/audit/history.yaml) use request IDs "SEED-0001"… and transport "seeded"/"none". */
export const SEEDED_REQUEST_ID_RE = /^SEED-\d{4}$/;

export function isSeededRequestId(requestId: string): boolean {
  return SEEDED_REQUEST_ID_RE.test(requestId);
}

/** UI label for seeded rows; their responses are labelled "scripted (not model output)". */
export const SEEDED_ROW_LABEL = "Seeded example (fictional)";
export const SCRIPTED_LABEL = "scripted (not model output)";

/** Actor IDs only; names are resolved at view time. */
export interface AuditActor {
  personaId: string;
  personId: string | null;
  role: Role;
}

/** Destination columns, copied from the decision's target descriptor. */
export interface AuditTargetFields {
  providerKind: ProviderKind;
  targetClass: TargetClass;
  model: string;
  endpointHost: string;
  region: string | null;
  crossRegion: CrossRegion | null;
  isCloud: boolean;
}

/** records_withheld element. `ref` is refKey() ("job:J-A06"). */
export interface AuditWithheld {
  ref: string;
  classification: Classification;
  reason: WithheldReason;
}

/** Fields common to every row the gateway writes. */
interface AuditBase {
  /** Real time, ISO-8601 UTC (injectable clock). */
  createdAt: string;
  requestId: string;
  actor: AuditActor;
  feature: FeatureName;
  task: TaskName;
  mode: AIMode;
  /** max(floor, sent classifications); blocked/held rows: the request floor. */
  maxClassification: Classification;
  /** Distinct, rank-ordered (general → export_controlled). */
  classificationsIncluded: Classification[];
  recordsWithheld: AuditWithheld[];
  notice: Notice | null;
  /** Distinct tokens produced by redacting this request (cloud: as sent; local: redacted for storage), code-point sorted. */
  tokensUsed: string[];
  /** The user's input text, redacted (cloud: exactly as sent; local: redacted for storage). */
  userInputRedacted: string | null;
  promptVersion: string;
  policyVersion: string;
  appVersion: string;
  demoEpoch: number;
}

/** R1: a call that will reach a transport. Inserted with outcome "pending", completed_at null. */
export interface AuditWriteAheadInput extends AuditBase {
  decision: SendDecisionKind;
  target: AuditTargetFields;
  transport: SelectedTransport;
  cassetteProvenance: CassetteProvenance | null;
  /** refKey() of each sent record, in S# order. */
  recordsSent: string[];
  /** Canonical JSON of the ProviderRequest (cloud: as sent; local: redacted for storage). */
  requestPayloadRedacted: string;
  payloadHash: string;
  payloadStoredForm: PayloadStoredForm;
  /** Repair-retry child rows: the parent's audit id, attempt 2. */
  parentId?: number | null;
  attempt?: number;
}

/** R5: completes a write-ahead row (one update; the trigger forbids any later one). */
export interface AuditFinalizeInput {
  completedAt: string;
  outcome: Exclude<AuditOutcome, "pending" | "blocked" | "held">;
  /** Live: response.model. Recorded replay: the cassette's recorded-on model. Hand-authored / fallback: null. */
  servedModel: string | null;
  /** Cloud: the tokenized text as received. Local: the response redacted for storage. null when there is none. */
  responseRedacted: string | null;
  /** Superset of the write-ahead tokens when storage-redacting the response minted more (local targets). */
  tokensUsed?: string[];
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  ttftMs: number | null;
  stopReason: string | null;
  errorCode: AIErrorCode | null;
  citationsValid: number;
  citationsStripped: number;
}

/** Blocked and held decisions: one complete row, nothing sent (transport "none", no payload, completed_at = created_at). */
export interface AuditCompleteInput extends AuditBase {
  decision: "blocked" | "held";
  /** The refused / unavailable target, when one exists. */
  target: AuditTargetFields | null;
}

/** event_log writer input. details: IDs, enums, counts and booleans only. */
export interface EventInput {
  kind: EventKind;
  actor: AuditActor | null;
  subjectKind?: string | null;
  subjectId?: string | null;
  classification?: Classification | null;
  details?: Record<string, string | number | boolean | null>;
}

// ---------------------------------------------------------------------------------------------------------------
// Viewing, Reveal, export
// ---------------------------------------------------------------------------------------------------------------

/**
 * The viewer for audit reads. Owner (capability viewAll) sees every row; everyone else sees only their own rows:
 * actor_person_id = personId when personId is set, else actor_persona_id = personaId.
 */
export interface AuditViewer {
  role: Role;
  personId: string | null;
  personaId: string;
}

export const AUDIT_REPLAY_FILTERS = ["live", "replay", "fallback", "seeded", "not_sent"] as const;
export type AuditReplayFilter = (typeof AUDIT_REPLAY_FILTERS)[number];

/** /audit filters (also the body of POST /api/audit/export). Free text is redacted before matching. */
export interface AuditFilters {
  /** YYYY-MM-DD, inclusive, compared against created_at (UTC). */
  from?: string;
  to?: string;
  personaId?: string;
  role?: Role;
  feature?: FeatureName;
  providerKind?: ProviderKind;
  model?: string;
  mode?: AIMode;
  decision?: AuditRow["decision"];
  classification?: Classification;
  replay?: AuditReplayFilter;
  outcome?: AuditOutcome;
  /** Free text; run through the redactor before matching, so "Aerovance" finds [[CUSTOMER_…]] rows. Never logged. */
  q?: string;
  includeEvents?: boolean;
}

/** One revealed token in a row's Reveal panel. */
export interface RevealEntry {
  token: string;
  /** Real text, or null when withheld for the viewer's role. */
  value: string | null;
  hiddenLabel?: string;
}

export interface RevealResult {
  rowId: number;
  entries: RevealEntry[];
}

export const AUDIT_EXPORT_FORMATS = ["csv", "json"] as const;
export type AuditExportFormat = (typeof AUDIT_EXPORT_FORMATS)[number];

/** Map of transport → whether the row is a replay of any kind (UI REPLAY label). */
export const REPLAY_TRANSPORTS: ReadonlySet<AuditTransport> = new Set<AuditTransport>([
  "demo_replay_exact",
  "demo_replay_scenario",
  "demo_fallback",
]);

/** Text split into plain runs and redaction tokens, so a client component can highlight tokens without the grammar. */
export interface TokenSegment {
  text: string;
  token: boolean;
}
