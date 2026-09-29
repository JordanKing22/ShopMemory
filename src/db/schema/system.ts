import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { classificationCheck, classificationColumns } from "./_shared";
import { machines } from "./assets";
import { knowledgeCards } from "./cards";
import { jobs } from "./commerce";
import {
  AI_MODES,
  AUDIT_DECISIONS,
  AUDIT_OUTCOMES,
  AUDIT_TRANSPORTS,
  CASSETTE_PROVENANCE,
  CLASSIFICATIONS,
  EVENT_KINDS,
  PAYLOAD_STORED_FORMS,
  PROVIDER_KINDS,
  ROLES,
  SNAPSHOT_REASONS,
  SNAPSHOT_SCOPES,
  TARGET_CLASSES,
  TOKEN_KINDS,
  type Classification,
} from "./enums";
import { interviews } from "./interviews";
import { people, personas } from "./shop";
import { topics } from "./taxonomy";

/**
 * Every AI call, including blocked and held ones (PLAN.md §4.7). Actor IDs only — names are resolved at view time.
 * Payload columns hold REDACTED text only. A trigger (custom migration) blocks updates after completion.
 */
export const aiAuditLog = sqliteTable(
  "ai_audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    createdAt: text("created_at").notNull(), // real time
    completedAt: text("completed_at"),
    requestId: text("request_id").notNull(),
    parentId: integer("parent_id"),
    attempt: integer("attempt").notNull().default(1),
    actorPersonId: text("actor_person_id").references(() => people.id),
    actorPersonaId: text("actor_persona_id").references(() => personas.id),
    actorRole: text("actor_role", { enum: ROLES }).notNull(),
    feature: text("feature").notNull(),
    task: text("task").notNull(),
    mode: text("mode", { enum: AI_MODES }).notNull(),
    decision: text("decision", { enum: AUDIT_DECISIONS }).notNull(),
    providerKind: text("provider_kind", { enum: PROVIDER_KINDS }),
    targetClass: text("target_class", { enum: TARGET_CLASSES }),
    model: text("model"),
    servedModel: text("served_model"),
    endpointHost: text("endpoint_host"),
    region: text("region"),
    crossRegion: text("cross_region"),
    isCloud: integer("is_cloud", { mode: "boolean" }),
    transport: text("transport", { enum: AUDIT_TRANSPORTS }).notNull(),
    cassetteProvenance: text("cassette_provenance", { enum: CASSETTE_PROVENANCE }),
    maxClassification: text("max_classification", { enum: CLASSIFICATIONS }),
    classificationsIncluded: text("classifications_included", { mode: "json" }).$type<Classification[]>().notNull(),
    recordsSent: text("records_sent", { mode: "json" }).$type<string[]>().notNull(),
    recordsWithheld: text("records_withheld", { mode: "json" })
      .$type<{ ref: string; classification: Classification; reason: string }[]>()
      .notNull(),
    noticeKey: text("notice_key"),
    noticeParams: text("notice_params", { mode: "json" }).$type<Record<string, string | number>>(),
    redactionTokenCount: integer("redaction_token_count").notNull().default(0),
    tokensUsed: text("tokens_used", { mode: "json" }).$type<string[]>().notNull(),
    userInputRedacted: text("user_input_redacted"),
    requestPayloadRedacted: text("request_payload_redacted"),
    payloadHash: text("payload_hash"),
    payloadStoredForm: text("payload_stored_form", { enum: PAYLOAD_STORED_FORMS }),
    responseRedacted: text("response_redacted"),
    promptVersion: text("prompt_version"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    ttftMs: integer("ttft_ms"),
    stopReason: text("stop_reason"),
    outcome: text("outcome", { enum: AUDIT_OUTCOMES }).notNull(),
    errorCode: text("error_code"),
    citationsValid: integer("citations_valid").notNull().default(0),
    citationsStripped: integer("citations_stripped").notNull().default(0),
    policyVersion: text("policy_version").notNull(),
    appVersion: text("app_version").notNull(),
    demoEpoch: integer("demo_epoch").notNull().default(0),
    tenantId: text("tenant_id").notNull().default("ridgeline"),
  },
  (t) => [
    index("aal_created_idx").on(t.createdAt),
    index("aal_actor_idx").on(t.actorPersonId),
    index("aal_feature_idx").on(t.feature),
    index("aal_provider_idx").on(t.providerKind),
    index("aal_class_idx").on(t.maxClassification),
    index("aal_decision_idx").on(t.decision),
    index("aal_transport_idx").on(t.transport),
  ],
);

/** Non-AI events. details_json holds IDs and enums only — never payloads or transcript text. */
export const eventLog = sqliteTable(
  "event_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    createdAt: text("created_at").notNull(), // real time
    actorPersonId: text("actor_person_id").references(() => people.id),
    actorPersonaId: text("actor_persona_id").references(() => personas.id),
    actorRole: text("actor_role", { enum: ROLES }),
    kind: text("kind", { enum: EVENT_KINDS }).notNull(),
    subjectKind: text("subject_kind"),
    subjectId: text("subject_id"),
    classification: text("classification", { enum: CLASSIFICATIONS }),
    detailsJson: text("details_json", { mode: "json" }).$type<Record<string, string | number | boolean | null>>(),
    tenantId: text("tenant_id").notNull().default("ridgeline"),
  },
  (t) => [index("el_created_idx").on(t.createdAt), index("el_kind_idx").on(t.kind, t.createdAt)],
);

/**
 * Tokens for regex hits and free names. Entity tokens are computed from the HMAC rule (src/lib/redaction/patterns.ts).
 * real_value is sensitive: never logged, never routable.
 */
export const redactionTokens = sqliteTable(
  "redaction_tokens",
  {
    token: text("token").primaryKey(),
    kind: text("kind", { enum: TOKEN_KINDS }).notNull(),
    entityId: text("entity_id"),
    realValue: text("real_value").notNull(),
    scope: text("scope").notNull().default("global"),
    createdAt: text("created_at").notNull(),
    tenantId: text("tenant_id").notNull().default("ridgeline"),
  },
  (t) => [uniqueIndex("rt_value_uq").on(t.kind, t.realValue, t.scope)],
);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedByPersonaId: text("updated_by_persona_id").references(() => personas.id),
  tenantId: text("tenant_id").notNull().default("ridgeline"),
});

/** Photos only — no audio, ever. Files live under data/uploads/ and are served through an authorized route. */
export const mediaAssets = sqliteTable(
  "media_assets",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["photo"] }).notNull(),
    filePath: text("file_path").notNull(),
    sha256: text("sha256").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    uploadedByPersonaId: text("uploaded_by_persona_id").references(() => personas.id),
    machineId: text("machine_id").references(() => machines.id),
    jobId: text("job_id").references(() => jobs.id),
    cardId: text("card_id").references(() => knowledgeCards.id),
    interviewId: text("interview_id").references(() => interviews.id),
    createdAt: text("created_at").notNull(),
    ...classificationColumns(),
  },
  (t) => [classificationCheck("media_assets", t.classification)],
);

/** Lets the Risk Map show deltas since reset. */
export const coverageSnapshots = sqliteTable(
  "coverage_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    takenAt: text("taken_at").notNull(),
    reason: text("reason", { enum: SNAPSHOT_REASONS }).notNull(),
    scope: text("scope", { enum: SNAPSHOT_SCOPES }).notNull(),
    topicId: text("topic_id").references(() => topics.id),
    personId: text("person_id").references(() => people.id),
    coverage: real("coverage"),
    capturedPct: real("captured_pct"),
    risk: integer("risk"),
  },
  (t) => [index("cs_scope_idx").on(t.scope, t.topicId, t.personId, t.takenAt)],
);
