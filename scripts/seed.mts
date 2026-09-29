// npm run seed — validate seed-data/, write the bundle, migrate and reset the database to it.
// Safe while the dev server runs (one IMMEDIATE transaction, WAL). Never delete the .db file instead.
import "./lib/load-env.mts";
import path from "node:path";
import { resetDatabase, countSeededRows } from "@/db/reset";
import { buildSeedBundle } from "@/lib/seed/build";
import { archiveAuditRows, readLock, readSeedSources, writeBundle } from "@/lib/seed/files";
import { openAndMigrate } from "./lib/db-setup.mts";
import { out } from "./lib/out";
import { printIssues } from "./lib/seed-report.mts";

const started = performance.now();
const result = buildSeedBundle(readSeedSources(), { lockedGeneratedRefs: readLock()?.generated_refs });
printIssues(result, { showWarnings: false });
if (!result.bundle) {
  out.error("\nseed failed: seed-data/ has errors (run npm run seed:check for details). The database was not changed.");
  process.exit(1);
}
const bundle = result.bundle;
writeBundle(bundle);

const { db, file } = openAndMigrate();
const nowIso = new Date().toISOString();
const res = resetDatabase(db.$client, bundle, {
  nowIso,
  archiveLiveAudit: (rows) => {
    const f = archiveAuditRows(rows, nowIso);
    out.line(`Archived ${rows.length} live-call audit rows to ${path.relative(process.cwd(), f)}.`);
  },
  actor: { personId: null, personaId: null, role: null },
});
const counts = countSeededRows(db.$client);
db.$client.close();

const warnings = result.issues.filter((i) => i.severity === "warning").length;
const ms = Math.round(performance.now() - started);
out.line(
  `Seeded ${path.relative(process.cwd(), file)} in ${ms} ms: ${res.insertedRows} rows, bundle ${bundle.hash.slice(0, 12)}, epoch ${res.epoch}.`,
);
out.line(
  `  people ${counts.people} · machines ${counts.machines} · customers ${counts.customers} · parts ${counts.parts} · quotes ${counts.quotes} · jobs ${counts.jobs} · cards ${counts.knowledgeCards} · transcripts ${counts.interviews} · documents ${counts.documents}`,
);
if (warnings) out.line(`  ${warnings} seed warning${warnings === 1 ? "" : "s"} (run npm run seed:check to see them).`);
