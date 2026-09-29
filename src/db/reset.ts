/**
 * Deterministic reset (PLAN.md §7.7), shared by `npm run seed` and the in-app Reset demo button.
 *
 * One synchronous IMMEDIATE transaction: archive live-call audit rows (through the caller's callback), delete every
 * row child → parent, reset sqlite_sequence, reinsert the bundle parent → child, rebuild FTS, bump demo.epoch and
 * write a demo_reset event. Safe while a server holds the DB (WAL + busy timeout). Never delete the .db file instead.
 *
 * No `server-only` import here: scripts run this under tsx.
 */
import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, getTableName, type Table } from "drizzle-orm";
import * as s from "@/db/schema";
import { SEEDED_TABLES, type SeedBundle, type SeededTableName } from "@/lib/seed/bundle";
import { rebuildFts } from "./fts";

/** Every table, child → parent (the delete order). Runtime-only tables are included so reset clears them. */
const DELETE_ORDER: Table[] = [
  s.coverageSnapshots,
  s.quizAnswers,
  s.quizAttempts,
  s.trainingProgress,
  s.quizQuestionCards,
  s.quizQuestions,
  s.quizzes,
  s.askMessages,
  s.askThreads,
  s.captures,
  s.mediaAssets,
  s.documentCards,
  s.documents,
  s.cardEvidence,
  s.cardTags,
  s.cardTopics,
  s.cardLinks,
  s.knowledgeCards,
  s.quoteReasoningLogs,
  s.consentRecords,
  s.interviewTurns,
  s.interviews,
  s.machineEvents,
  s.jobs,
  s.quoteFinancials,
  s.quotes,
  s.parts,
  s.personTopicExpertise,
  s.tags,
  s.topics,
  s.customerAccounts,
  s.customers,
  s.materials,
  s.machines,
  s.redactionTokens,
  s.eventLog,
  s.aiAuditLog,
  s.appSettings,
  s.personas,
  s.people,
  s.shopProfile,
];

const CHUNK = 200;
export const EPOCH_KEY = "demo.epoch";

export interface ResetOptions {
  /** Real time (ISO) for the demo_reset event and settings timestamps. */
  nowIso: string;
  /**
   * Receives the redacted `transport='live'` audit rows before they are deleted (the caller writes them to
   * data/audit-archive/). Runs inside the transaction: if it throws, nothing is changed.
   */
  archiveLiveAudit?: (rows: Record<string, unknown>[]) => void;
  actor?: { personId: string | null; personaId: string | null; role: (typeof s.ROLES)[number] | null };
}

export interface ResetResult {
  archivedLiveAuditRows: number;
  insertedRows: number;
  epoch: number;
  bundleHash: string;
}

export function resetDatabase(sqlite: Database.Database, bundle: SeedBundle, opts: ResetOptions): ResetResult {
  const db = drizzle({ client: sqlite, schema: s });
  const run = sqlite.transaction((): ResetResult => {
    const live = db.select().from(s.aiAuditLog).where(eq(s.aiAuditLog.transport, "live")).all();
    if (live.length > 0) opts.archiveLiveAudit?.(live as unknown as Record<string, unknown>[]);

    const prevEpochRow = db.select().from(s.appSettings).where(eq(s.appSettings.key, EPOCH_KEY)).get();
    const prevEpoch = typeof prevEpochRow?.value === "number" ? prevEpochRow.value : 0;

    for (const table of DELETE_ORDER) db.delete(table).run();
    const hasSequence = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'").get();
    if (hasSequence) sqlite.prepare("DELETE FROM sqlite_sequence").run();

    let inserted = 0;
    for (const name of Object.keys(SEEDED_TABLES) as SeededTableName[]) {
      const table = SEEDED_TABLES[name] as Table;
      const rows = bundle.tables[name] as Record<string, unknown>[];
      for (let i = 0; i < rows.length; i += CHUNK) {
        db.insert(table).values(rows.slice(i, i + CHUNK)).run();
      }
      inserted += rows.length;
    }
    rebuildFts(sqlite);

    const epoch = prevEpoch + 1;
    db.insert(s.appSettings).values({ key: EPOCH_KEY, value: epoch, updatedAt: opts.nowIso }).run();
    db.insert(s.eventLog)
      .values({
        createdAt: opts.nowIso,
        actorPersonId: opts.actor?.personId ?? null,
        actorPersonaId: opts.actor?.personaId ?? null,
        actorRole: opts.actor?.role ?? null,
        kind: "demo_reset",
        subjectKind: "seed_bundle",
        subjectId: bundle.hash.slice(0, 16),
        detailsJson: { archivedLiveAuditRows: live.length, insertedRows: inserted, epoch },
      })
      .run();
    return { archivedLiveAuditRows: live.length, insertedRows: inserted, epoch, bundleHash: bundle.hash };
  });
  const result = run.immediate();
  sqlite.pragma("wal_checkpoint(TRUNCATE)");
  return result;
}

/** Row counts per seeded table, read back from the DB (used by seed and tests to confirm the reset). */
export function countSeededRows(sqlite: Database.Database): Record<SeededTableName, number> {
  const out = {} as Record<SeededTableName, number>;
  for (const name of Object.keys(SEEDED_TABLES) as SeededTableName[]) {
    const tableName = getTableName(SEEDED_TABLES[name] as Table);
    const row = sqlite.prepare(`SELECT count(*) AS n FROM "${tableName}"`).get() as { n: number };
    out[name] = row.n;
  }
  return out;
}
