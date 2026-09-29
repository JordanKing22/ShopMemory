import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { customers, machines, materials } from "./assets";
import { ASSESSED_BY, TOPIC_CATEGORIES } from "./enums";
import { people } from "./shop";

/** Heat-map rows: 7 processes, 8 machines, 7 materials, 6 customers. */
export const topics = sqliteTable(
  "topics",
  {
    id: text("id").primaryKey(), // t-thin-wall, t-m-dmu50, t-mat-ti64, t-cus-01
    category: text("category", { enum: TOPIC_CATEGORIES }).notNull(),
    label: text("label").notNull(),
    description: text("description"),
    machineId: text("machine_id").references(() => machines.id),
    materialId: text("material_id").references(() => materials.id),
    customerId: text("customer_id").references(() => customers.id),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [
    check(
      "topics_entity_ck",
      sql`(${t.category} = 'process' and ${t.machineId} is null and ${t.materialId} is null and ${t.customerId} is null)
       or (${t.category} = 'machine' and ${t.machineId} is not null and ${t.materialId} is null and ${t.customerId} is null)
       or (${t.category} = 'material' and ${t.materialId} is not null and ${t.machineId} is null and ${t.customerId} is null)
       or (${t.category} = 'customer' and ${t.customerId} is not null and ${t.machineId} is null and ${t.materialId} is null)`,
    ),
  ],
);

/** Controlled tag vocabulary; a tag may map to a topic. */
export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(), // thin-wall
  label: text("label").notNull(),
  topicId: text("topic_id").references(() => topics.id),
  synonyms: text("synonyms", { mode: "json" }).$type<string[]>().notNull(),
});

/**
 * Curated search-synonym groups from seed-data/taxonomy/search-synonyms.yaml (PLAN.md §5.3), one row per group, in
 * file order. Terms are stored as the SME wrote them; `buildSynonymIndex()` normalizes them. Library/Ask search merges
 * these with material aliases and tag synonyms (`buildSearchSynonymIndex()` in src/lib/data/search.ts).
 */
export const searchSynonymGroups = sqliteTable("search_synonym_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  terms: text("terms", { mode: "json" }).$type<string[]>().notNull(),
});

/** SME-seeded tacit level 0–3 (PLAN.md §6). */
export const personTopicExpertise = sqliteTable(
  "person_topic_expertise",
  {
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id),
    tacitLevel: integer("tacit_level").notNull(),
    assessedBy: text("assessed_by", { enum: ASSESSED_BY }).notNull(),
    assessedOn: text("assessed_on").notNull(),
    note: text("note"),
  },
  (t) => [
    primaryKey({ columns: [t.personId, t.topicId] }),
    index("pte_topic_idx").on(t.topicId),
    check("pte_level_ck", sql`${t.tacitLevel} between 0 and 3`),
  ],
);
