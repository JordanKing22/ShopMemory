// npm run seed:lock — after an intentional seed edit, record the new bundle hash and row counts in
// seed-data/seed.lock.json (commit it with the edit). The determinism test compares against this file.
import "./lib/load-env.mts";
import fs from "node:fs";
import { bundleRowCounts } from "@/lib/seed/bundle";
import { buildSeedBundle } from "@/lib/seed/build";
import { LOCK_FILE, readSeedSources, writeBundle } from "@/lib/seed/files";
import { out } from "./lib/out";
import { printIssues } from "./lib/seed-report.mts";

const result = buildSeedBundle(readSeedSources());
printIssues(result, { showWarnings: false });
if (!result.bundle) {
  out.error("\nseed:lock failed: fix the errors first (npm run seed:check). The lock file was not changed.");
  process.exit(1);
}
writeBundle(result.bundle);
const lock = {
  comment: "Written by npm run seed:lock. Commit it with any intentional seed-data edit.",
  hash: result.bundle.hash,
  demoToday: result.bundle.demoToday,
  seed: result.bundle.seed,
  rows: bundleRowCounts(result.bundle),
};
fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2) + "\n", "utf8");
out.line(`seed-data/seed.lock.json updated: bundle ${result.bundle.hash.slice(0, 12)}.`);
