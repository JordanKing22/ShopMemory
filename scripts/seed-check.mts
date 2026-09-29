// npm run seed:check — validates seed-data/ (touches no database; safe while the server runs).
// On success it writes data/seed-bundle.json, the last valid bundle that `npm run seed` and Reset demo replay.
import "./lib/load-env.mts";
import { buildSeedBundle } from "@/lib/seed/build";
import { readLock, readSeedSources, writeBundle } from "@/lib/seed/files";
import { out } from "./lib/out";
import { printIssues, printReport } from "./lib/seed-report.mts";

const started = performance.now();
const result = buildSeedBundle(readSeedSources(), { lockedGeneratedRefs: readLock()?.generated_refs });
printIssues(result);
printReport(result);
const ms = Math.round(performance.now() - started);

if (!result.bundle) {
  out.error(`\nseed:check failed (${ms} ms). Fix the errors above; data/seed-bundle.json was not changed.`);
  process.exit(1);
}
writeBundle(result.bundle);
out.line(`\nseed:check passed in ${ms} ms. Bundle ${result.bundle.hash.slice(0, 12)} written to data/seed-bundle.json.`);
