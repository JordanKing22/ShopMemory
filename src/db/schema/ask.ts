import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { classificationCheck, classificationColumns } from "./_shared";
import { machines } from "./assets";
import { jobs } from "./commerce";
import { AI_MODES, ASK_ROLES, CAPTURE_KINDS, CAPTURE_STATUSES } from "./enums";
import { people } from "./shop";
import { aiAuditLog, mediaAssets } from "./system";

/** Ask the Shop chat threads. */
export const askThreads = sqliteTable(
  "ask_threads",
  {
    id: text("id").primaryKey(),
    actorPersonId: text("actor_person_id").references(() => people.id),
    modeAtCreation: text("mode_at_creation", { enum: AI_MODES }).notNull(),
    createdAt: text("created_at").notNull(),
    ...classificationColumns(),
  },
  (t) => [classificationCheck("ask_threads", t.classification)],
);

/** Message text is local only; the audit log keeps the redacted copy. */
export const askMessages = sqliteTable(
  "ask_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    threadId: text("thread_id")
      .notNull()
      .references(() => askThreads.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: text("role", { enum: ASK_ROLES }).notNull(),
    text: text("text").notNull(),
    pinnedRefs: text("pinned_refs", { mode: "json" }).$type<string[]>().notNull(),
    sources: text("sources", { mode: "json" }).$type<Record<string, string>>().notNull(), // S# -> record ref
    auditId: integer("audit_id").references(() => aiAuditLog.id),
    createdAt: text("created_at").notNull(),
    ...classificationColumns(),
  },
  (t) => [
    uniqueIndex("am_seq_uq").on(t.threadId, t.seq),
    classificationCheck("ask_messages", t.classification),
  ],
);

/** Machine-page captures. They go to the expert's review queue; they aren't cards until approved. */
export const captures = sqliteTable(
  "captures",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: CAPTURE_KINDS }).notNull(),
    machineId: text("machine_id")
      .notNull()
      .references(() => machines.id),
    jobId: text("job_id").references(() => jobs.id),
    text: text("text"),
    mediaAssetId: text("media_asset_id").references(() => mediaAssets.id),
    status: text("status", { enum: CAPTURE_STATUSES }).notNull(),
    reviewerPersonId: text("reviewer_person_id").references(() => people.id),
    createdByPersonId: text("created_by_person_id").references(() => people.id),
    createdAt: text("created_at").notNull(),
    ...classificationColumns(),
  },
  (t) => [index("captures_machine_idx").on(t.machineId), classificationCheck("captures", t.classification)],
);
