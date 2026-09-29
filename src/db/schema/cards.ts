import { check, index, integer, primaryKey, sqliteTable, text, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { classificationCheck, classificationColumns } from "./_shared";
import { customers, machines, materials } from "./assets";
import { jobs, parts, quotes } from "./commerce";
import {
  APPROVAL_MODES,
  CARD_CREATED_BY,
  CARD_SOURCE_KINDS,
  CARD_STATUSES,
  CARD_TYPES,
  COMPARATORS,
  CONFIDENCE,
  LINK_BASIS,
  LINK_KINDS,
} from "./enums";
import { interviews, interviewTurns } from "./interviews";
import { people, personas } from "./shop";
import { tags, topics } from "./taxonomy";

export interface Threshold {
  quantity: string;
  comparator: (typeof COMPARATORS)[number];
  value: number | null;
  value_max: number | null;
  unit: string | null;
  verbatim: string; // e.g. "under forty thou" — shown next to the normalized value
}

export const knowledgeCards = sqliteTable(
  "knowledge_cards",
  {
    id: text("id").primaryKey(), // KC-001..090 seeded, KC-091..094 reserved, KC-101+ runtime
    version: integer("version").notNull().default(1),
    supersedesId: text("supersedes_id").references((): AnySQLiteColumn => knowledgeCards.id),
    type: text("type", { enum: CARD_TYPES }).notNull(),
    status: text("status", { enum: CARD_STATUSES }).notNull(),
    title: text("title").notNull(),
    statement: text("statement").notNull(),
    rationale: text("rationale"),
    commonMistake: text("common_mistake"),
    appliesWhen: text("applies_when", { mode: "json" }).$type<string[]>().notNull(),
    doesNotApplyWhen: text("does_not_apply_when", { mode: "json" }).$type<string[]>().notNull(),
    cues: text("cues", { mode: "json" }).$type<string[]>().notNull(),
    actions: text("actions", { mode: "json" }).$type<string[]>().notNull(),
    thresholds: text("thresholds", { mode: "json" }).$type<Threshold[]>().notNull(),
    openQuestions: text("open_questions", { mode: "json" }).$type<string[]>().notNull(),
    expertConfidence: text("expert_confidence", { enum: CONFIDENCE }).notNull(),
    sourcePersonId: text("source_person_id")
      .notNull()
      .references(() => people.id),
    recordedByPersonaId: text("recorded_by_persona_id").references(() => personas.id),
    sourceKind: text("source_kind", { enum: CARD_SOURCE_KINDS }).notNull(),
    sourceInterviewId: text("source_interview_id").references(() => interviews.id),
    createdBy: text("created_by", { enum: CARD_CREATED_BY }).notNull(),
    approvedByPersonId: text("approved_by_person_id").references(() => people.id),
    approvedAt: text("approved_at"), // real time
    approvedOn: text("approved_on"), // demo clock
    approvalMode: text("approval_mode", { enum: APPROVAL_MODES }),
    reviewNotes: text("review_notes"),
    scriptKey: text("script_key"),
    searchText: text("search_text").notNull(),
    searchTags: text("search_tags").notNull(),
    createdOn: text("created_on").notNull(), // demo clock
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    ...classificationColumns(),
  },
  (t) => [
    index("kc_status_class_idx").on(t.status, t.classification),
    index("kc_person_status_idx").on(t.sourcePersonId, t.status),
    index("kc_type_idx").on(t.type),
    index("kc_interview_idx").on(t.sourceInterviewId),
    classificationCheck("knowledge_cards", t.classification),
  ],
);

/** Polymorphic but FK-enforced: exactly one target column is set and it matches `kind`. */
export const cardLinks = sqliteTable(
  "card_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cardId: text("card_id")
      .notNull()
      .references(() => knowledgeCards.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: LINK_KINDS }).notNull(),
    jobId: text("job_id").references(() => jobs.id),
    quoteId: text("quote_id").references(() => quotes.id),
    partId: text("part_id").references(() => parts.id),
    machineId: text("machine_id").references(() => machines.id),
    materialId: text("material_id").references(() => materials.id),
    customerId: text("customer_id").references(() => customers.id),
    personId: text("person_id").references(() => people.id),
    mention: text("mention"),
    linkBasis: text("link_basis", { enum: LINK_BASIS }).notNull(),
  },
  (t) => [
    index("cl_card_idx").on(t.cardId),
    index("cl_job_idx").on(t.jobId),
    index("cl_quote_idx").on(t.quoteId),
    index("cl_part_idx").on(t.partId),
    index("cl_machine_idx").on(t.machineId),
    index("cl_material_idx").on(t.materialId),
    index("cl_customer_idx").on(t.customerId),
    index("cl_person_idx").on(t.personId),
    check(
      "card_links_one_target_ck",
      sql`((${t.jobId} is not null) + (${t.quoteId} is not null) + (${t.partId} is not null) + (${t.machineId} is not null)
        + (${t.materialId} is not null) + (${t.customerId} is not null) + (${t.personId} is not null)) = 1
        and ((${t.kind} = 'job' and ${t.jobId} is not null) or (${t.kind} = 'quote' and ${t.quoteId} is not null)
          or (${t.kind} = 'part' and ${t.partId} is not null) or (${t.kind} = 'machine' and ${t.machineId} is not null)
          or (${t.kind} = 'material' and ${t.materialId} is not null) or (${t.kind} = 'customer' and ${t.customerId} is not null)
          or (${t.kind} = 'person' and ${t.personId} is not null))`,
    ),
  ],
);

/** Drives coverage; at most 3 per card (enforced by seed:check and the gate). */
export const cardTopics = sqliteTable(
  "card_topics",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => knowledgeCards.id, { onDelete: "cascade" }),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.topicId] }), index("ct_topic_idx").on(t.topicId)],
);

export const cardTags = sqliteTable(
  "card_tags",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => knowledgeCards.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.tagId] })],
);

/** Transcript-span provenance. Every card has at least one, pointing at an EXPERT turn. */
export const cardEvidence = sqliteTable(
  "card_evidence",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cardId: text("card_id")
      .notNull()
      .references(() => knowledgeCards.id, { onDelete: "cascade" }),
    turnId: text("turn_id")
      .notNull()
      .references(() => interviewTurns.id),
    startChar: integer("start_char").notNull(),
    endChar: integer("end_char").notNull(),
    quote: text("quote").notNull(),
    confidenceEvidence: integer("confidence_evidence", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("ce_card_idx").on(t.cardId), index("ce_turn_idx").on(t.turnId)],
);
