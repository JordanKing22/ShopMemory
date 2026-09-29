import { sql } from "drizzle-orm";
import { type AnySQLiteColumn, check, text } from "drizzle-orm/sqlite-core";
import { CLASSIFICATION_SOURCES, CLASSIFICATIONS } from "./enums";

/** The classification trio every routable record carries (PLAN.md §4.3). */
export const classificationColumns = () => ({
  classification: text("classification", { enum: CLASSIFICATIONS }).notNull(),
  classificationSource: text("classification_source", { enum: CLASSIFICATION_SOURCES }).notNull().default("derived"),
  classificationReason: text("classification_reason"),
});

/** DB-level CHECK so no code path can write an unknown classification. */
export const classificationCheck = (name: string, column: AnySQLiteColumn) =>
  check(
    `${name}_classification_ck`,
    sql`${column} in ('general','internal','customer_confidential','export_controlled')`,
  );
