// npm run db:migrate — creates the database if needed and applies drizzle/ migrations (never drizzle-kit push).
import "./lib/load-env.mts";
import path from "node:path";
import { openAndMigrate } from "./lib/db-setup.mts";
import { out } from "./lib/out";

const { db, file } = openAndMigrate();
db.$client.close();
out.line(`Migrations applied to ${path.relative(process.cwd(), file)}.`);
