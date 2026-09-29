/**
 * Test helper: a fresh in-memory database with the real schema and the real seed bundle, for data-layer tests
 * (docs/DATA-LAYER.md "Testing a data function").
 *
 *   const { db } = seededDb();                       // call once per file (beforeAll) or per test that writes
 *   const vm = jobDetail(db, actorFor("machinist", "PER-02"), "J-A02");
 *
 * The bundle is built from seed-data/ once per worker and shared; every seededDb() call opens its own `:memory:`
 * database, so tests may write to it freely. Close it with `sqlite.close()` when a file opens many.
 */
import path from "node:path";
import type Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDb, type Db } from "@/db/client";
import { resetDatabase } from "@/db/reset";
import type { Role } from "@/lib/auth/roles";
import type { SeedBundle } from "@/lib/seed/bundle";
import { buildSeedBundle } from "@/lib/seed/build";
import { readSeedSources } from "@/lib/seed/files";

const MIGRATIONS = path.join(process.cwd(), "drizzle");

// Per worker: a globalThis slot survives module re-evaluation between test files that share a worker.
const g = globalThis as typeof globalThis & { __floorwiseTestBundle?: SeedBundle };

/** The seed bundle built from seed-data/ (cached per worker). Throws, naming file:line, if seed-data has errors. */
export function seedBundle(): SeedBundle {
  if (!g.__floorwiseTestBundle) {
    const result = buildSeedBundle(readSeedSources());
    if (!result.bundle) {
      const errors = result.issues
        .filter((i) => i.severity === "error")
        .slice(0, 10)
        .map((i) => `${i.file}${i.line ? `:${i.line}` : ""} [${i.code}] ${i.message}`);
      throw new Error(`seed-data has errors (run npm run seed:check):\n${errors.join("\n")}`);
    }
    g.__floorwiseTestBundle = result.bundle;
  }
  return g.__floorwiseTestBundle;
}

export interface SeededDb {
  /** Drizzle handle with the full schema — what the pure data functions take. */
  db: Db;
  /** The underlying better-sqlite3 connection (same as `db.$client`), for raw SQL and `close()`. */
  sqlite: Database.Database;
  bundle: SeedBundle;
}

/** A new migrated `:memory:` database loaded with the seed bundle through the real reset. */
export function seededDb(): SeededDb {
  const bundle = seedBundle();
  const db = openDb({ file: ":memory:", create: true });
  migrate(db, { migrationsFolder: MIGRATIONS });
  // Fixed timestamp (the demo day at noon UTC) so the demo_reset event row is deterministic.
  resetDatabase(db.$client, bundle, { nowIso: `${bundle.demoToday}T12:00:00.000Z` });
  return { db, sqlite: db.$client, bundle };
}

/** The actor shape the pure data functions take (an `Actor` from src/server/actor.ts satisfies it structurally). */
export interface TestActor {
  role: Role;
  personId: string | null;
}

/** `actorFor("machinist", "PER-02")` → `{ role: "machinist", personId: "PER-02" }`; personId defaults to null. */
export function actorFor(role: Role, personId: string | null = null): TestActor {
  return { role, personId };
}
