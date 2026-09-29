// Opens (creating if needed) the database chosen by FLOORWISE_DB and applies the migrations in drizzle/.
import fs from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { dbFilePath, openDb, type Db } from "@/db/client";

export function openAndMigrate(): { db: Db; file: string } {
  const file = dbFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = openDb({ file, create: true });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return { db, file };
}
