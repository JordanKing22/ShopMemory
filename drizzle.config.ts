import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: "./data/floorwise.db" },
  // FTS5 virtual/shadow tables come from a custom migration; without this filter `push` would drop them.
  // Never use `drizzle-kit push` anyway (CLAUDE.md database conventions).
  tablesFilter: ["!*_fts*"],
  strict: true,
  verbose: true,
});
