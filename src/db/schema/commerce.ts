import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { classificationCheck, classificationColumns } from "./_shared";
import { customers, machines, materials } from "./assets";
import {
  CLASSIFICATIONS,
  EXPORT_CONTROL,
  JOB_STATUSES,
  LOST_REASONS,
  MACHINE_EVENT_KINDS,
  PART_FAMILIES,
  QUOTE_OUTCOMES,
  type JudgmentDriver,
  type PartFeature,
} from "./enums";
import { people } from "./shop";

export const parts = sqliteTable(
  "parts",
  {
    id: text("id").primaryKey(), // PRT-A01 anchor / PRT-G17 generated / PRT-I01 internal
    customerId: text("customer_id").references(() => customers.id), // NULL = internal fixture/tooling
    partNumber: text("part_number").notNull(),
    revision: text("revision").notNull(),
    description: text("description").notNull(),
    family: text("family", { enum: PART_FAMILIES }).notNull(),
    materialId: text("material_id")
      .notNull()
      .references(() => materials.id),
    features: text("features", { mode: "json" }).$type<PartFeature[]>().notNull(),
    minWallIn: real("min_wall_in"),
    maxWallHeightIn: real("max_wall_height_in"),
    tightestTolIn: real("tightest_tol_in"),
    envelopeIn: text("envelope_in"),
    complexity: integer("complexity").notNull(),
    exportControl: text("export_control", { enum: EXPORT_CONTROL }).notNull().default("none"),
    isAnchor: integer("is_anchor", { mode: "boolean" }).notNull().default(false),
    notesMd: text("notes_md"),
    ...classificationColumns(),
  },
  (t) => [
    uniqueIndex("parts_pn_uq").on(t.customerId, t.partNumber, t.revision),
    index("parts_customer_idx").on(t.customerId),
    index("parts_material_idx").on(t.materialId),
    index("parts_class_idx").on(t.classification),
    check("parts_complexity_ck", sql`${t.complexity} between 1 and 5`),
    classificationCheck("parts", t.classification),
  ],
);

export const quotes = sqliteTable(
  "quotes",
  {
    id: text("id").primaryKey(), // Q-A01 / Q-G001
    quoteNumber: text("quote_number").notNull().unique(),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    quotedOn: text("quoted_on").notNull(),
    quotedByPersonId: text("quoted_by_person_id")
      .notNull()
      .references(() => people.id),
    qty: integer("qty").notNull(),
    primaryMachineId: text("primary_machine_id")
      .notNull()
      .references(() => machines.id),
    secondaryMachineId: text("secondary_machine_id").references(() => machines.id),
    quotedSetupHours: real("quoted_setup_hours").notNull(),
    quotedCycleMinutes: real("quoted_cycle_minutes").notNull(),
    quotedHours: real("quoted_hours").notNull(),
    leadTimeDays: integer("lead_time_days"),
    outcome: text("outcome", { enum: QUOTE_OUTCOMES }).notNull(),
    lostReason: text("lost_reason", { enum: LOST_REASONS }),
    judgmentDrivers: text("judgment_drivers", { mode: "json" }).$type<JudgmentDriver[]>().notNull(),
    quoterNotesMd: text("quoter_notes_md"),
    isAnchor: integer("is_anchor", { mode: "boolean" }).notNull().default(false),
    // FTS mirror columns. MUST NOT contain prices or account data.
    searchTitle: text("search_title").notNull(),
    searchText: text("search_text").notNull(),
    searchTags: text("search_tags").notNull(),
    ...classificationColumns(),
  },
  (t) => [
    index("quotes_part_idx").on(t.partId),
    index("quotes_cust_date_idx").on(t.customerId, t.quotedOn),
    index("quotes_outcome_idx").on(t.outcome),
    index("quotes_quoter_idx").on(t.quotedByPersonId),
    classificationCheck("quotes", t.classification),
  ],
);

/** ROLE-HIDDEN (owner, quoter). A separate table so non-cleared queries never join it. */
export const quoteFinancials = sqliteTable(
  "quote_financials",
  {
    quoteId: text("quote_id")
      .primaryKey()
      .references(() => quotes.id, { onDelete: "cascade" }),
    shopRateUsdPerHr: real("shop_rate_usd_per_hr").notNull(),
    materialCostUsd: real("material_cost_usd").notNull(),
    outsideProcessingUsd: real("outside_processing_usd").notNull(),
    riskAdderHours: real("risk_adder_hours").notNull(),
    scrapAllowancePct: real("scrap_allowance_pct").notNull(),
    unitPriceUsd: real("unit_price_usd").notNull(),
    totalPriceUsd: real("total_price_usd").notNull(),
    targetMarginPct: real("target_margin_pct").notNull(),
    classification: text("classification", { enum: CLASSIFICATIONS }).notNull(),
  },
  (t) => [classificationCheck("quote_financials", t.classification)],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(), // J-A02 / J-G004 / J-I01
    jobNumber: text("job_number").notNull().unique(), // RJ-yy-nnnn
    quoteId: text("quote_id")
      .unique()
      .references(() => quotes.id), // NULL only for internal work orders
    partId: text("part_id")
      .notNull()
      .references(() => parts.id),
    status: text("status", { enum: JOB_STATUSES }).notNull(),
    startedOn: text("started_on"),
    shippedOn: text("shipped_on"),
    leadPersonId: text("lead_person_id").references(() => people.id),
    actualMachineId: text("actual_machine_id").references(() => machines.id),
    actualSetupHours: real("actual_setup_hours"),
    actualRunHours: real("actual_run_hours"),
    actualHours: real("actual_hours"),
    variancePct: real("variance_pct"),
    scrapQty: integer("scrap_qty").notNull().default(0),
    ncrCount: integer("ncr_count").notNull().default(0),
    onTime: integer("on_time", { mode: "boolean" }),
    debriefMd: text("debrief_md"),
    isAnchor: integer("is_anchor", { mode: "boolean" }).notNull().default(false),
    ...classificationColumns(),
  },
  (t) => [
    index("jobs_part_idx").on(t.partId),
    index("jobs_status_idx").on(t.status),
    index("jobs_variance_idx").on(t.variancePct),
    classificationCheck("jobs", t.classification),
  ],
);

/** "Recent issues" on machine pages. */
export const machineEvents = sqliteTable(
  "machine_events",
  {
    id: text("id").primaryKey(), // ME-001
    machineId: text("machine_id")
      .notNull()
      .references(() => machines.id),
    occurredOn: text("occurred_on").notNull(),
    kind: text("kind", { enum: MACHINE_EVENT_KINDS }).notNull(),
    summary: text("summary").notNull(),
    jobId: text("job_id").references(() => jobs.id),
    personId: text("person_id").references(() => people.id),
    ...classificationColumns(),
  },
  (t) => [
    index("machine_events_machine_idx").on(t.machineId, t.occurredOn),
    classificationCheck("machine_events", t.classification),
  ],
);
