import { integer, real, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { COHORTS, DEPARTMENTS, DEPARTURE_KINDS, ROLES } from "./enums";

export const shopProfile = sqliteTable("shop_profile", {
  id: text("id").primaryKey(), // always 'shop'
  name: text("name").notNull(),
  employeeCount: integer("employee_count").notNull(),
  certifications: text("certifications", { mode: "json" }).$type<string[]>().notNull(),
  demoToday: text("demo_today").notNull(),
  seed: integer("seed").notNull(),
  seedBundleHash: text("seed_bundle_hash").notNull(),
  fictionalNotice: text("fictional_notice").notNull(),
});

/** The 8 knowledge holders (heat-map columns). No birth dates or ages, ever. */
export const people = sqliteTable(
  "people",
  {
    id: text("id").primaryKey(), // PER-01
    fullName: text("full_name").notNull(),
    displayName: text("display_name").notNull(),
    jobTitle: text("job_title").notNull(),
    department: text("department", { enum: DEPARTMENTS }).notNull(),
    appRole: text("app_role", { enum: ROLES }).notNull(),
    cohort: text("cohort", { enum: COHORTS }).notNull(),
    hireDate: text("hire_date").notNull(),
    priorExperienceYears: real("prior_experience_years").notNull().default(0),
    plannedDepartureDate: text("planned_departure_date"),
    departureKind: text("departure_kind", { enum: DEPARTURE_KINDS }),
    isKnowledgeHolder: integer("is_knowledge_holder", { mode: "boolean" }).notNull().default(true),
    bioMd: text("bio_md"),
    redactionAliases: text("redaction_aliases", { mode: "json" }).$type<string[]>().notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("people_role_idx").on(t.appRole)],
);

/** Demo role-switcher entries. The owner persona has no people row. */
export const personas = sqliteTable(
  "personas",
  {
    id: text("id").primaryKey(), // P-OWNER, P-PER-01
    label: text("label").notNull(),
    role: text("role", { enum: ROLES }).notNull(),
    personId: text("person_id").references(() => people.id),
    redactionAliases: text("redaction_aliases", { mode: "json" }).$type<string[]>().notNull(),
    isDefaultForRole: integer("is_default_for_role", { mode: "boolean" }).notNull().default(false),
    showInSwitcher: integer("show_in_switcher", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [uniqueIndex("personas_default_role_uq").on(t.role).where(sql`${t.isDefaultForRole} = 1`)],
);
