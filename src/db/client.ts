/**
 * Database client shared by the app and scripts. Must NOT import 'server-only' (it throws under tsx);
 * the app imports it through src/server/db.ts.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

// Static path literals only (a computed path makes Turbopack trace the whole project).
const MAIN_DB_FILE = path.join(process.cwd(), "data", "floorwise.db");
const E2E_DB_FILE = path.join(process.cwd(), "data", "e2e.db");

export function dbFilePath(): string {
  return getEnv().FLOORWISE_DB === "e2e" ? E2E_DB_FILE : MAIN_DB_FILE;
}

export function configureConnection(sqlite: Database.Database): void {
  sqlite.pragma("journal_mode = WAL"); // readers never block the writer
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("secure_delete = ON"); // deleted rows don't linger in free pages
}

export function openDb(opts: { file?: string; create?: boolean } = {}) {
  const file = opts.file ?? dbFilePath();
  const sqlite = new Database(file, { timeout: 5000, fileMustExist: !opts.create && file !== ":memory:" });
  configureConnection(sqlite);
  return drizzle({ client: sqlite, schema });
}

export type Db = ReturnType<typeof openDb>;

// One connection per process, surviving dev HMR (leaked handles keep the file locked on Windows).
const g = globalThis as typeof globalThis & { __floorwiseDb?: Db };

export function getDb(): Db {
  if (!g.__floorwiseDb) {
    try {
      g.__floorwiseDb = openDb();
    } catch {
      throw new Error('Cannot open the Floorwise database. Run "npm run seed" first.');
    }
  }
  return g.__floorwiseDb;
}
