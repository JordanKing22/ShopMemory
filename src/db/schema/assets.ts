import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { classificationCheck, classificationColumns } from "./_shared";
import { CLASSIFICATIONS, INDUSTRIES, MACHINE_KINDS, MACHINE_STATUSES, MATERIAL_FAMILIES } from "./enums";

/** Machine IDs are permanent: printed QR codes encode /machines/<id>. Implicitly internal. */
export const machines = sqliteTable("machines", {
  id: text("id").primaryKey(), // m-dmu50
  assetTag: text("asset_tag").notNull().unique(),
  name: text("name").notNull(),
  make: text("make").notNull(),
  model: text("model").notNull(),
  kind: text("kind", { enum: MACHINE_KINDS }).notNull(),
  yearInstalled: integer("year_installed").notNull(),
  acquired: text("acquired", { enum: ["new", "used"] }).notNull(),
  locationCell: text("location_cell"),
  status: text("status", { enum: MACHINE_STATUSES }).notNull().default("running"),
  capabilities: text("capabilities", { mode: "json" }).$type<string[]>().notNull(),
  unitHistoryMd: text("unit_history_md"), // THIS unit's history, never model-wide claims
  sortOrder: integer("sort_order").notNull(),
});

/** Implicitly general. Aliases also feed search synonyms. */
export const materials = sqliteTable("materials", {
  id: text("id").primaryKey(), // mat-ti64
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  family: text("family", { enum: MATERIAL_FAMILIES }).notNull(),
  aliases: text("aliases", { mode: "json" }).$type<string[]>().notNull(),
  notesMd: text("notes_md"),
  sortOrder: integer("sort_order").notNull(),
});

export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(), // CUS-01
    name: text("name").notNull(),
    industry: text("industry", { enum: INDUSTRIES }).notNull(),
    segment: text("segment"),
    customerSince: text("customer_since").notNull(),
    isNewCustomer: integer("is_new_customer", { mode: "boolean" }).notNull(),
    partClassificationFloor: text("part_classification_floor", { enum: CLASSIFICATIONS }).notNull(),
    qualityRequirementsMd: text("quality_requirements_md"),
    redactionAliases: text("redaction_aliases", { mode: "json" }).$type<string[]>().notNull(),
    partNumberPattern: text("part_number_pattern").notNull(),
    sortOrder: integer("sort_order").notNull(),
    ...classificationColumns(),
  },
  (t) => [classificationCheck("customers", t.classification)],
);

/** ROLE-HIDDEN (owner, quoter). Never sent to any model. */
export const customerAccounts = sqliteTable(
  "customer_accounts",
  {
    customerId: text("customer_id")
      .primaryKey()
      .references(() => customers.id, { onDelete: "cascade" }),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    paymentTerms: text("payment_terms"),
    annualSpendUsd: integer("annual_spend_usd"),
    pricingNotesMd: text("pricing_notes_md"),
    classification: text("classification", { enum: CLASSIFICATIONS }).notNull(),
  },
  (t) => [classificationCheck("customer_accounts", t.classification)],
);
