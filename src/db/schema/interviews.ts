import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { classificationCheck, classificationColumns } from "./_shared";
import { customers } from "./assets";
import { jobs, parts, quotes } from "./commerce";
import {
  AI_MODES,
  APPROVAL_MODES,
  CLASSIFICATIONS,
  INTERVIEW_MODES,
  INTERVIEW_PLANS,
  INTERVIEW_STATUSES,
  MOVES,
  RISK_BUCKETS,
  SPEAKERS,
  SPEECH_ENGINES,
  TARGET_CLASSES,
  TEXT_SOURCES,
} from "./enums";
import { people, personas } from "./shop";
import { topics } from "./taxonomy";

export const interviews = sqliteTable(
  "interviews",
  {
    id: text("id").primaryKey(), // INT-01, INT-LIVE-RAY (reserved), INT-M-PER-01 (manual entry), INT-101+
    title: text("title").notNull(),
    mode: text("mode", { enum: INTERVIEW_MODES }).notNull(),
    plan: text("plan", { enum: INTERVIEW_PLANS }).notNull().default("generic"),
    expertPersonId: text("expert_person_id")
      .notNull()
      .references(() => people.id),
    runByPersonaId: text("run_by_persona_id").references(() => personas.id),
    topicId: text("topic_id").references(() => topics.id),
    contextQuoteId: text("context_quote_id").references(() => quotes.id),
    contextJobId: text("context_job_id").references(() => jobs.id),
    contextPartId: text("context_part_id").references(() => parts.id),
    contextCustomerId: text("context_customer_id").references(() => customers.id),
    status: text("status", { enum: INTERVIEW_STATUSES }).notNull(),
    phase: text("phase"),
    trackerState: text("tracker_state", { mode: "json" }).$type<Record<string, unknown>>(),
    speechEngine: text("speech_engine", { enum: SPEECH_ENGINES }).notNull().default("typed"),
    audioRetained: integer("audio_retained", { mode: "boolean" }).notNull().default(false),
    scriptKey: text("script_key"),
    offScript: integer("off_script", { mode: "boolean" }).notNull().default(false),
    isHidden: integer("is_hidden", { mode: "boolean" }).notNull().default(false),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    summaryMd: text("summary_md"),
    ...classificationColumns(),
  },
  (t) => [
    check("interviews_no_audio_ck", sql`${t.audioRetained} = 0`), // Floorwise never stores audio
    index("interviews_expert_idx").on(t.expertPersonId),
    classificationCheck("interviews", t.classification),
  ],
);

/** The transcript. */
export const interviewTurns = sqliteTable(
  "interview_turns",
  {
    id: text("id").primaryKey(), // <interview_id>-T001
    interviewId: text("interview_id")
      .notNull()
      .references(() => interviews.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    speaker: text("speaker", { enum: SPEAKERS }).notNull(),
    phase: text("phase"),
    move: text("move", { enum: MOVES }),
    text: text("text").notNull(),
    textSource: text("text_source", { enum: TEXT_SOURCES }).notNull(),
    createdAt: text("created_at").notNull(),
    classification: text("classification", { enum: CLASSIFICATIONS }).notNull(),
  },
  (t) => [
    uniqueIndex("it_seq_uq").on(t.interviewId, t.seq),
    classificationCheck("interview_turns", t.classification),
  ],
);

export const consentRecords = sqliteTable("consent_records", {
  id: text("id").primaryKey(), // CON-01
  interviewId: text("interview_id")
    .notNull()
    .unique()
    .references(() => interviews.id, { onDelete: "cascade" }),
  personId: text("person_id")
    .notNull()
    .references(() => people.id),
  consentTextVersion: text("consent_text_version").notNull(),
  consentTextSha256: text("consent_text_sha256").notNull(),
  speechEngineDisclosed: text("speech_engine_disclosed").notNull(),
  aiMode: text("ai_mode", { enum: AI_MODES }).notNull(),
  targetClass: text("target_class", { enum: TARGET_CLASSES }).notNull(),
  endpointHost: text("endpoint_host").notNull(),
  granted: integer("granted", { mode: "boolean" }).notNull(),
  grantedAt: text("granted_at").notNull(),
  recordedByPersonaId: text("recorded_by_persona_id").references(() => personas.id),
  mode: text("mode", { enum: APPROVAL_MODES }).notNull().default("self"),
  revokedAt: text("revoked_at"),
});

export const quoteReasoningLogs = sqliteTable(
  "quote_reasoning_logs",
  {
    id: text("id").primaryKey(), // QRL-01
    quoteId: text("quote_id")
      .notNull()
      .references(() => quotes.id),
    interviewId: text("interview_id").references(() => interviews.id),
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
    mainDriver: text("main_driver"),
    machineRationale: text("machine_rationale"),
    hoursRationale: text("hours_rationale"),
    riskPricedIn: text("risk_priced_in"),
    riskBucket: text("risk_bucket", { enum: RISK_BUCKETS }),
    whatWouldChange: text("what_would_change"),
    juniorWouldMiss: text("junior_would_miss"),
    confidence1to5: integer("confidence_1to5"),
    varianceReviewMd: text("variance_review_md"),
    createdAt: text("created_at").notNull(),
    ...classificationColumns(),
  },
  (t) => [
    check("qrl_conf_ck", sql`${t.confidence1to5} is null or ${t.confidence1to5} between 1 and 5`),
    classificationCheck("quote_reasoning_logs", t.classification),
  ],
);
