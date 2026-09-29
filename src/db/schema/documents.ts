import { index, integer, primaryKey, sqliteTable, text, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { classificationCheck, classificationColumns } from "./_shared";
import { machines } from "./assets";
import { knowledgeCards } from "./cards";
import { jobs, parts } from "./commerce";
import { DOC_GENERATED_BY, DOC_KINDS, DOC_SECTIONS, DOC_STATUSES } from "./enums";
import { people, personas } from "./shop";

export type DocSectionKey = (typeof DOC_SECTIONS)[number];

export interface DocBody {
  header: { partId?: string; machineId?: string; op?: string; programRefs: string[] };
  sections: {
    key: DocSectionKey;
    title: string;
    items: { text: string; cardIds: string[] }[];
    table?: { columns: string[]; rows: string[][] };
  }[];
}

export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(), // DOC-SS-01..25, DOC-SS-LIVE (reserved), DOC-101+
    kind: text("kind", { enum: DOC_KINDS }).notNull(),
    title: text("title").notNull(),
    status: text("status", { enum: DOC_STATUSES }).notNull(),
    version: integer("version").notNull().default(1),
    supersedesId: text("supersedes_id").references((): AnySQLiteColumn => documents.id),
    machineId: text("machine_id").references(() => machines.id),
    partId: text("part_id").references(() => parts.id),
    jobId: text("job_id").references(() => jobs.id),
    forPersonId: text("for_person_id").references(() => people.id),
    reviewerPersonId: text("reviewer_person_id").references(() => people.id),
    authorPersonaId: text("author_persona_id").references(() => personas.id),
    generatedBy: text("generated_by", { enum: DOC_GENERATED_BY }).notNull(),
    body: text("body", { mode: "json" }).$type<DocBody>().notNull(),
    bodyMd: text("body_md").notNull(),
    programRefs: text("program_refs", { mode: "json" }).$type<string[]>().notNull(),
    submittedAt: text("submitted_at"),
    approvedAt: text("approved_at"),
    approvedOn: text("approved_on"),
    approvedByPersonId: text("approved_by_person_id").references(() => people.id),
    reviewNotes: text("review_notes"),
    scriptKey: text("script_key"),
    searchText: text("search_text").notNull(),
    createdOn: text("created_on").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    ...classificationColumns(),
  },
  (t) => [
    index("doc_kind_status_idx").on(t.kind, t.status),
    index("doc_machine_idx").on(t.machineId),
    index("doc_reviewer_idx").on(t.reviewerPersonId, t.status),
    classificationCheck("documents", t.classification),
  ],
);

export const documentCards = sqliteTable(
  "document_cards",
  {
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    cardId: text("card_id")
      .notNull()
      .references(() => knowledgeCards.id),
    cardVersion: integer("card_version").notNull(),
    section: text("section", { enum: DOC_SECTIONS }).notNull(),
    sort: integer("sort").notNull(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.cardId] })],
);
