/**
 * Public types of the AI gateway (PLAN.md §4.1–§4.2, docs/AI-GATEWAY.md). Type-only plus a few constants.
 *
 * Every model call goes through runAI() (src/lib/ai/gateway.ts; the app uses src/server/ai.ts). Callers pass record
 * REFERENCES (RecordRef), never record bodies or classifications; the gateway loads and classifies them itself
 * (CLAUDE.md hard rule 1). ProviderRequest is exactly what goes over the wire (already redacted for cloud targets).
 *
 * Written by the architect; the gateway builder owns this file afterwards and may add to it. Changing an existing
 * shape needs the contract (docs/AI-GATEWAY.md) updated in the same change.
 */
import type {
  AIMode,
  AuditDecision,
  AuditOutcome,
  AuditTransport,
  CassetteProvenance,
  Classification,
  PayloadStoredForm,
  ProviderKind,
  Role,
  TargetClass,
} from "@/db/schema/enums";
import type { Db } from "@/db/client";
import type { Env } from "@/lib/env";
import type { CrossRegion, GovCloudResult, OllamaLocality } from "@/lib/policy/matrix";
import type {
  AiRoutingSetting,
  BlockReason,
  HoldReason,
  HoldTrigger,
  Notice,
  RenderedNotice,
  RoutingSource,
  WithheldReason,
} from "@/lib/policy/types";
import type { Suspect, TokenKind } from "@/lib/redaction/types";
import type { AIErrorCode } from "./errors";

export type { AIMode, AuditDecision, AuditOutcome, AuditTransport, CassetteProvenance, Classification, ProviderKind, Role, TargetClass };

export type Effort = "low" | "medium" | "high";

// ---------------------------------------------------------------------------------------------------------------
// JSON values (output.jsonSchema, structured results)
// ---------------------------------------------------------------------------------------------------------------

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

// ---------------------------------------------------------------------------------------------------------------
// Providers (PLAN.md §4.1)
// ---------------------------------------------------------------------------------------------------------------

/**
 * How availability was established. "live-probe": a health probe of the real endpoint (cached, see §8 of the
 * contract). "config-only-demo": DEMO_MODE (and not DEMO_LIVE_LOCAL for Ollama): configuration only, ReplayTransport
 * serves the call. "config-only": live mode, a cloud target whose credentials are present but that isn't probed per
 * call (the call itself is the probe).
 */
export type ProviderVerification = "live-probe" | "config-only-demo" | "config-only";

export interface ProviderDescriptor {
  kind: ProviderKind;
  targetClass: TargetClass;
  /** Cloud targets (GovCloud included) are always redacted. */
  isCloud: boolean;
  /** Configured model ID (ANTHROPIC_MODEL / BEDROCK_MODEL_ID / OLLAMA_MODEL). "" when not configured. */
  model: string;
  /** The exact base URL passed to the client (from src/lib/ai/endpoints.ts / policy summary). Never contains userinfo. */
  baseUrl: string;
  /** hostOf(baseUrl): the host shown in the header, checked by the policy and written to the audit. */
  host: string;
  region?: string;
  endpointMode?: "runtime" | "mantle";
  fips?: boolean;
  crossRegion?: CrossRegion;
  /** Requires 30-day retention (src/lib/policy/covered-models.ts). Unknown counts as covered (fail closed). */
  coveredModel: boolean;
  /** Ollama on 127.0.0.0/8, ::1 or localhost. "Nothing leaves this computer" is shown only when true. */
  isLoopback: boolean;
  locality?: OllamaLocality;
  govCloud?: GovCloudResult;
  /** Usable right now (configured, and for live Ollama: probed ready with an allowed model). */
  available: boolean;
  verified: ProviderVerification;
  /** Why not available (a safe sentence naming settings, never values). */
  unavailableReason?: string;
}

export interface ProviderCaps {
  /** First-party Anthropic: true (output_config.format). Bedrock: false (prompt-JSON). Ollama: true (format). */
  nativeJsonSchema: boolean;
  /** output_config.effort (Anthropic, Bedrock). Ollama: false. */
  supportsEffort: boolean;
  maxContextTokens: number;
}

export interface ProviderMessage {
  role: "user" | "assistant";
  /** Text only; photos are never sent in v1. */
  content: string;
}

export type ProviderOutput = { kind: "text" } | { kind: "json"; schemaName: string; jsonSchema: JsonObject };

/**
 * Exactly what goes over the wire (already redacted for cloud targets). The preview shows this object and the audit
 * stores its canonical JSON. Invariants (asserted by the gateway and again by every adapter): messages is non-empty
 * and its LAST message has role "user" (no assistant prefill); no sampling parameters exist on this type on purpose.
 */
export interface ProviderRequest {
  system: string;
  messages: ProviderMessage[];
  maxTokens: number;
  output: ProviderOutput;
  effort?: Effort;
}

export interface CallOptions {
  /** Client disconnect / caller abort. Adapters pass it to the SDK / fetch so the provider call is cancelled. */
  signal?: AbortSignal;
  /** AI_TIMEOUT_MS. */
  timeoutMs: number;
  /** For log correlation only (log.ts fields). */
  requestId: string;
}

export type ProviderStopReason = "end_turn" | "max_tokens" | "refusal" | "stop_sequence" | "other";

export interface ProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ProviderTimings {
  latencyMs: number;
  ttftMs: number | null;
  /** Ollama load_duration / eval_count (recorded in the audit row's timing fields where they fit). */
  loadDurationMs?: number | null;
  evalCount?: number | null;
}

export interface ProviderResponse {
  /** Raw model text (tokenized for cloud targets). Payload: never logged, stored only after redaction. */
  text: string;
  stopReason: ProviderStopReason;
  /** The provider's own stop reason string (enum-like, e.g. "model_context_window_exceeded"); safe to store. */
  rawStopReason: string | null;
  /** stop_details.category on a refusal (enum). The refusal explanation text is payload and is never kept. */
  refusalCategory?: string | null;
  /** response.model (served model); null when unknown. */
  servedModel: string | null;
  usage: ProviderUsage;
  timings: ProviderTimings;
}

/** Text deltas, then exactly one "done" carrying the final response. Failures throw AIError from the iterator. */
export type ProviderStreamEvent = { type: "text"; text: string } | { type: "done"; response: ProviderResponse };

export type ProviderHealthStatus =
  | "ready"
  | "unreachable"
  | "misconfigured"
  | "model_missing"
  | "model_not_allowed"
  | "not_checked"
  | "replay";

/** Never contains secret values, prompts or provider error text. */
export interface ProviderHealth {
  kind: ProviderKind;
  targetClass: TargetClass;
  host: string;
  model: string;
  status: ProviderHealthStatus;
  verified: ProviderVerification;
  /** Real time (ISO) of the probe; null when not probed. */
  checkedAt: string | null;
  deep: boolean;
  /** Safe sentences naming settings or checks, never values. */
  problems: string[];
  anthropic?: { keyPresent: boolean; modelFound: boolean | null };
  bedrock?: {
    region: string | null;
    endpointMode: "runtime" | "mantle";
    fips: boolean;
    crossRegion: CrossRegion;
    govCloudQualified: boolean;
    govCloudFailed: string[];
    coveredModel: boolean;
  };
  ollama?: {
    version: string | null;
    versionOk: boolean | null;
    modelPulled: boolean | null;
    remoteHostEmpty: boolean | null;
    contextLength: number | null;
    warm: boolean | null;
    gpuShare: number | null;
  };
}

export interface LLMProvider {
  readonly descriptor: ProviderDescriptor;
  readonly caps: ProviderCaps;
  complete(req: ProviderRequest, o: CallOptions): Promise<ProviderResponse>;
  stream(req: ProviderRequest, o: CallOptions): AsyncIterable<ProviderStreamEvent>;
  /** deep=false: configuration + cheap reachability. deep=true: Anthropic models.retrieve(model) / Ollama /api/show. No shop data. */
  health(deep?: boolean): Promise<ProviderHealth>;
  /** Ollama only: pre-load the model with the identical options object (POST /api/health/warm). */
  warm?(o: CallOptions): Promise<ProviderHealth>;
}

/** Builds the live adapter for a descriptor (src/lib/ai/providers/factory.ts). Tests inject stubs. */
export type ProviderFactory = (descriptor: ProviderDescriptor) => LLMProvider;

// ---------------------------------------------------------------------------------------------------------------
// Tasks, features, records
// ---------------------------------------------------------------------------------------------------------------

/** Every task name in PLAN.md. Phase 3 implements only "smoke" (others → AIError task_unknown). */
export const TASK_NAMES = [
  "smoke",
  "ask_shop",
  "interview_track",
  "interview_phrase",
  "card_extract",
  "doc_generate",
  "quiz_generate",
  "quiz_grade",
] as const;
export type TaskName = (typeof TASK_NAMES)[number];

/** Card extraction is never scenario-replayed (PLAN.md §11.1): exact match or off-script. */
export const SCENARIO_REPLAY_FORBIDDEN: ReadonlySet<TaskName> = new Set<TaskName>(["card_extract"]);

/** The UI surface a call came from (ai_audit_log.feature). */
export const FEATURES = [
  "settings_test",
  "ask_shop",
  "interviewer",
  "card_extraction",
  "quote_log",
  "document_generator",
  "training",
] as const;
export type FeatureName = (typeof FEATURES)[number];

export type RecordKind =
  | "card"
  | "job"
  | "quote"
  | "part"
  | "customer"
  | "machine"
  | "material"
  | "person"
  | "document"
  | "interview"
  | "quote_log"
  | "ask_thread"
  | "quiz";

/** A record reference. IDs are opaque DB IDs (KC-091, J-A06); they never reach a provider (sources get S# keys). */
export interface RecordRef {
  kind: RecordKind;
  id: string;
}

/** "job:J-A06" — the form stored in ai_audit_log.records_sent / records_withheld[].ref. */
export function refKey(ref: RecordRef): string {
  return `${ref.kind}:${ref.id}`;
}

/** Who is acting (from requireActor(); never from the client). */
export interface AIActor {
  personaId: string;
  personId: string | null;
  role: Role;
}

// ---------------------------------------------------------------------------------------------------------------
// runAI() input / output (PLAN.md §4.2)
// ---------------------------------------------------------------------------------------------------------------

export interface AIRequestInput {
  /** Free text the user typed or dictated (question, answer). */
  text?: string;
  /** Prior turns of a conversation, oldest first. */
  turns?: { role: "user" | "assistant"; text: string }[];
}

/** NEVER record bodies or classifications: references and user text only. */
export interface AIRequest {
  task: TaskName;
  feature: FeatureName;
  actor: AIActor;
  input?: AIRequestInput;
  /** Records the user pinned ("Ask the Shop about this job"). */
  pinned?: RecordRef[];
  /** Retrieval query when it differs from input.text. */
  retrievalQuery?: string;
  sessionId?: string;
  threadId?: string;
  /** Consent record for consent-gated tasks (none in Phase 3). */
  consentId?: string;
  /** Hybrid escape hatch ("Ask without the N controlled records"). Server-recomputed; can only narrow. */
  excludeAboveClearance?: boolean;
  /** Held → "It isn't — send anyway". Ignored when a detector hit exists. */
  confirmNotControlled?: boolean;
  /** From a dry run: a real call whose preview token no longer matches is rejected with preview_stale. */
  previewToken?: string;
  /** Demo scenario matching only (replay step 2). Never changes routing or the payload. */
  scenarioHint?: string;
}

/** The POST body of /api/ai/[task] and /api/ai/preview (task comes from the URL / body, actor from the cookie). */
export type AIRequestBody = Omit<AIRequest, "actor" | "task">;

export interface RunOptions {
  signal?: AbortSignal;
}

/** The destination as the client may see it (no secrets). */
export interface PublicTarget {
  kind: ProviderKind;
  targetClass: TargetClass;
  /** "Anthropic API" | "Amazon Bedrock" | "Ollama". */
  providerLabel: string;
  model: string;
  host: string;
  region?: string;
  crossRegion?: CrossRegion;
  fips?: boolean;
  isCloud: boolean;
  isLoopback: boolean;
  /** Cloud: true. Local: false ("Local: not redacted"). */
  redacted: boolean;
  coveredModel: boolean;
  verified: ProviderVerification;
}

export interface PublicDecision {
  kind: AuditDecision;
  reason?: BlockReason | HoldReason;
  mode: AIMode;
  target: PublicTarget | null;
  /** The request's own classification (P3 floor). */
  floor: Classification;
  /** Highest classification of what is sent (max(sent, floor)); null when nothing is sent. */
  maxClassification: Classification | null;
  sentCount: number;
  withheldCount: number;
  holdTriggers?: HoldTrigger[];
  /** Held only: "It isn't — send anyway" may be offered (no detector hit). */
  canSendAnyway: boolean;
  /** Blocked in Hybrid with local down and the floor cleared for the cloud: "Ask without the N controlled records". */
  canExcludeControlled: boolean;
  notice: Notice | null;
  /** Notice rendered for the viewer's role (view-time labels). */
  noticeText: RenderedNotice | null;
}

/** A source in the answer's context (sent) or withheld from it. */
export interface SourceChip {
  /** "S1"… for sent records; null for withheld ones. */
  key: string | null;
  ref: RecordRef;
  /** Role-visible title (shown to this viewer only; never stored in the audit). */
  title: string;
  classification: Classification;
  sent: boolean;
  reason?: WithheldReason;
}

/** The per-request "Routed to …" chip and replay label. */
export interface RoutedBadge {
  /** "Anthropic API · claude-sonnet-5-5", "Ollama · qwen3.5:4b · this computer". */
  text: string;
  /** none = live; replay = REPLAY; scripted = "REPLAY · scripted (not model output)"; fallback = offline fallback (scripted). */
  replay: "none" | "replay" | "scripted" | "fallback";
  /** A replay recorded on a different model than the configured one: "recorded on {model}". */
  recordedOnModel: string | null;
}

/** A token legend row in the preview, filtered by the viewer's role. */
export interface TokenLegendEntry {
  token: string;
  kind: TokenKind;
  /** The real text, or null when the viewer's role may not see it. */
  display: string | null;
  hiddenLabel?: string;
}

/** runAI(..., { dryRun: true }): "What will be sent", byte-identical to the real call's payload. */
export interface AIPreview {
  requestId: string;
  decision: PublicDecision;
  sources: SourceChip[];
  /** Exactly what would be sent (redacted for cloud); null when blocked or held. */
  request: ProviderRequest | null;
  payloadHash: string | null;
  /** sha256(payloadHash | targetClass | host | model); null when nothing would be sent. */
  previewToken: string | null;
  storedForm: PayloadStoredForm | null;
  tokenLegend: TokenLegendEntry[];
  suspects: Suspect[];
}

/** NDJSON events of POST /api/ai/[task] (one JSON object per line). `meta` is always first. */
export type AIStreamEvent =
  | { t: "meta"; requestId: string; decision: PublicDecision; sources: SourceChip[]; badge: RoutedBadge }
  | { t: "text"; d: string }
  | { t: "result"; data: unknown }
  | {
      t: "done";
      auditId: number | null;
      outcome: AuditOutcome;
      transport: AuditTransport;
      provenance: CassetteProvenance | null;
      latencyMs: number;
      citationsValid: number;
      citationsStripped: number;
    }
  | { t: "error"; code: AIErrorCode; message: string };

export type MetaEvent = Extract<AIStreamEvent, { t: "meta" }>;
export type DoneEvent = Extract<AIStreamEvent, { t: "done" }>;
export type ErrorEvent = Extract<AIStreamEvent, { t: "error" }>;

/** Drained run (tests, scripts). `text` is the restored text the client would have seen. */
export interface AIRunResult {
  requestId: string;
  events: AIStreamEvent[];
  meta: MetaEvent | null;
  text: string;
  data: unknown;
  done: DoneEvent | null;
  error: ErrorEvent | null;
}

/**
 * A real call. Nothing runs until `events` is iterated (or collect() is called); breaking out of the iteration or
 * aborting RunOptions.signal aborts the provider call and finalizes the audit row as aborted.
 */
export interface AIRun {
  requestId: string;
  events: AsyncIterable<AIStreamEvent>;
  collect(): Promise<AIRunResult>;
}

// ---------------------------------------------------------------------------------------------------------------
// Transport selection (R2) and replay (PLAN.md §11.1)
// ---------------------------------------------------------------------------------------------------------------

export interface ScenarioContext {
  /** AIRequest.scenarioHint. */
  hint: string;
  /** Interview tracker/phrase tasks. */
  turnIndex?: number;
  /** Ask/doc tasks: the TOKENIZED, normalized question used for Jaccard ≥ 0.6 matching. */
  question?: string;
}

/** Everything replay lookup may key on. Host and model are deliberately absent (PLAN.md §11.1). */
export interface ReplayKeyInput {
  task: TaskName;
  targetClass: TargetClass;
  promptVersion: string;
  payloadHash: string;
}

export interface TransportLookup extends ReplayKeyInput {
  descriptor: ProviderDescriptor;
  scenario: ScenarioContext | null;
  /** Fingerprints of the sources actually sent ("card:KC-091@<16 hex>"). */
  sentFingerprints: readonly string[];
}

export interface TransportPolicy {
  demoMode: boolean;
  demoMiss: "offline" | "live";
  demoLiveLocal: boolean;
  replaySpeed: "realistic" | "fast" | "instant";
}

/** A task's deterministic offline answer (labelled "scripted (not model output)"; audited demo_fallback). */
export interface OfflineFallback {
  text: string;
  data?: unknown;
}

export interface TransportContext {
  policy: TransportPolicy;
  /** A provider that can REALLY be called (credentials configured / Ollama reachable); null when none. */
  live: LLMProvider | null;
  fallback: () => OfflineFallback;
  /** Local replays only: tokens → dictionary text (emulates what a live Ollama returns). */
  detokenize: (text: string) => string;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export type SelectedTransport = Exclude<AuditTransport, "none" | "seeded">;

/** The one thing R2 calls. Selection is synchronous and egress-free, so it happens before the write-ahead (R1). */
export interface ResolvedTransport {
  transport: SelectedTransport;
  provenance: CassetteProvenance | null;
  /** Recorded cassettes: the model they were recorded on. */
  recordedOnModel: string | null;
  /** "smoke.cloud#P-OWNER" for replays; null otherwise. */
  cassetteEntry: string | null;
  complete(req: ProviderRequest, o: CallOptions): Promise<ProviderResponse>;
  stream(req: ProviderRequest, o: CallOptions): AsyncIterable<ProviderStreamEvent>;
}

export interface TransportResolver {
  resolve(lookup: TransportLookup, ctx: TransportContext): ResolvedTransport;
}

// Cassettes (in-memory shape; the YAML on disk is snake_case, see docs/AI-GATEWAY.md §11) ---------------------------

export interface CassetteSourceRef {
  key: string;
  fingerprint: string;
}

export interface CassetteResponse {
  /** TOKENIZED text (cloud and local alike). No cassette ever contains a seed name. */
  text: string;
  data: unknown;
  stopReason: ProviderStopReason;
  usage: ProviderUsage;
  ttftMs: number | null;
  latencyMs: number | null;
}

export interface CassetteEntry {
  /** Unique within the file, e.g. "P-OWNER". */
  id: string;
  payloadHash: string;
  scenario: string | null;
  turnIndex: number | null;
  question: string | null;
  /** Sources the response cites (subset of what was sent). */
  sources: CassetteSourceRef[];
  response: CassetteResponse;
  note: string | null;
}

export interface CassetteFile {
  format: 1;
  /** "smoke.cloud" (= file name without .yaml). */
  id: string;
  task: TaskName;
  targetClass: TargetClass;
  promptVersion: string;
  provenance: CassetteProvenance;
  /** null for hand_authored. */
  recordedOn: { providerKind: ProviderKind; model: string; date: string } | null;
  entries: CassetteEntry[];
}

/** One scripted request demo:verify replays (seed-data/demo-cache/manifest.yaml). */
export interface ManifestRequest {
  /** Unique, e.g. "smoke.cloud.owner". */
  id: string;
  phase: number;
  /** Expected cassette + entry: "smoke.cloud#P-OWNER". */
  expect: string;
  personaId: string;
  mode: AIMode;
  cloudProvider: "anthropic" | "bedrock";
  task: TaskName;
  feature: FeatureName;
  input?: AIRequestInput;
  pinned?: RecordRef[];
  scenarioHint?: string;
}

export interface CassetteStore {
  files(): readonly CassetteFile[];
}

// ---------------------------------------------------------------------------------------------------------------
// Gateway dependencies (injectable so tests and scripts run without Next.js)
// ---------------------------------------------------------------------------------------------------------------

export interface HealthSource {
  /** Cached health (TTL in the contract §8); null when never probed. */
  get(kind: ProviderKind): ProviderHealth | null;
  refresh(kind: ProviderKind, deep?: boolean): Promise<ProviderHealth>;
}

export interface GatewayDeps {
  db: Db;
  env: Env;
  /** Real time: audit/event timestamps and latency only. */
  now: () => Date;
  /** "req_" + UUID in production; deterministic in tests. */
  newRequestId: () => string;
  providers: ProviderFactory;
  health: HealthSource;
  transports: TransportResolver;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /**
   * Scripts and tests only (demo:record applies its --target as the global mode; demo:verify replays each manifest
   * request in its own mode). Replaces the effective routing for this gateway instance; decide() still runs.
   */
  routingOverride?: AiRoutingSetting;
  /** Scripts and tests only: e.g. demo:verify forces { demoMode: true, demoMiss: "offline", replaySpeed: "instant" }. */
  transportPolicyOverride?: Partial<TransportPolicy>;
}

/** GET /api/health (and ?deep=1). Names of settings only; never values, prompts or provider error text. */
export interface HealthReport {
  ok: boolean;
  /** Real time (ISO). */
  checkedAt: string;
  deep: boolean;
  demoMode: boolean;
  demoLiveLocal: boolean;
  mode: AIMode;
  cloudProvider: "anthropic" | "bedrock";
  routingSource: RoutingSource;
  /** The providers the effective mode uses. */
  providers: ProviderHealth[];
  /** Setting names that need attention (from the routing summary). */
  configProblems: string[];
  /** Names of SDK environment variables that are set and overridden/ignored (src/lib/env.ts sdkEnvOverridesPresent()). */
  sdkEnvOverrides: string[];
}
