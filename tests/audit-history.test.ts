import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { stringify } from "yaml";
import { aiAuditLog } from "@/db/schema";
import { resetDatabase } from "@/db/reset";
import { writeAhead } from "@/lib/audit/ai-audit";
import { isSeededRequestId } from "@/lib/audit/types";
import { dictionaryHits } from "@/lib/redaction";
import { buildSeedBundle } from "@/lib/seed/build";
import { readSeedSources } from "@/lib/seed/files";
import { writeAheadInput } from "./helpers/audit";
import { seedRedactionDictionary } from "./helpers/dictionary";
import { seedBundle, seededDb } from "./helpers/seeded-db";

const FILE = "audit/history.yaml";
const dict = seedRedactionDictionary();

function buildWith(mutate: (rows: Record<string, unknown>[]) => void) {
  const sources = readSeedSources();
  const rows = parse(sources[FILE]) as Record<string, unknown>[];
  mutate(rows);
  return buildSeedBundle({ ...sources, [FILE]: stringify(rows) });
}

describe("seeded audit history (seed-data/audit/history.yaml)", () => {
  const rows = seedBundle().tables.aiAuditLog;

  it("has ~20 fictional rows covering every decision, local, Bedrock, a smoke test, a timeout and a repair chain", () => {
    expect(rows.length).toBeGreaterThanOrEqual(20);
    expect(rows.every((r) => isSeededRequestId(r.requestId))).toBe(true);
    expect(new Set(rows.map((r) => r.decision))).toEqual(new Set(["allow", "withheld_partial", "blocked", "held", "user_excluded_controlled"]));
    expect(rows.some((r) => r.targetClass === "ollama_local" && r.payloadStoredForm === "redacted_for_storage" && r.maxClassification === "export_controlled")).toBe(true);
    expect(rows.some((r) => r.targetClass === "bedrock_commercial" && r.crossRegion === "global")).toBe(true);
    expect(rows.some((r) => r.task === "smoke")).toBe(true);
    expect(rows.some((r) => r.outcome === "timeout")).toBe(true);
    const child = rows.find((r) => r.attempt === 2)!;
    expect(rows.find((r) => r.id === child.parentId)?.outcome).toBe("invalid_output");
    expect(rows.filter((r) => r.decision === "blocked" || r.decision === "held").every((r) => r.transport === "none" && r.requestPayloadRedacted === null)).toBe(true);
    expect(rows.filter((r) => r.transport === "seeded").every((r) => r.payloadHash && r.cassetteProvenance !== undefined)).toBe(true);
  });

  it("contains no names or record numbers, only resolvable entity tokens", () => {
    expect(dictionaryHits(JSON.stringify(rows), dict)).toEqual([]);
    for (const r of rows) for (const t of r.tokensUsed) expect(dict.entityTokens.has(t), t).toBe(true);
  });

  it("seed:check rejects a name, a token the seed can't produce, and a record the target isn't cleared for", () => {
    const named = buildWith((rs) => (rs[1].user_input = "What does Aerovance want?"));
    expect(named.bundle).toBeNull();
    expect(named.issues.some((i) => i.file === FILE && /Contains a name/.test(i.message))).toBe(true);

    const foreign = buildWith((rs) => (rs[1].user_input = "Ask about [[AMOUNT_ABCD]]"));
    expect(foreign.issues.some((i) => i.file === FILE && /isn't a token this seed produces/.test(i.message))).toBe(true);

    const leak = buildWith((rs) => {
      const r = rs.find((x) => x.decision === "allow" && x.target_class === "anthropic" && x.task === "ask_shop")!;
      (r.records_sent as string[]).push("job:J-A06");
    });
    expect(leak.issues.some((i) => i.file === FILE && /isn't cleared for/.test(i.message))).toBe(true);
  });

  it("are inserted by Reset with explicit IDs and never archived as live calls", () => {
    const { db, sqlite, bundle } = seededDb();
    expect(db.select().from(aiAuditLog).all().length).toBe(rows.length);
    writeAhead(db, { ...writeAheadInput(), transport: "live", cassetteProvenance: null });
    let archived: Record<string, unknown>[] = [];
    resetDatabase(sqlite, bundle, { nowIso: "2026-10-02T10:00:00.000Z", archiveLiveAudit: (r) => (archived = r) });
    expect(archived).toHaveLength(1);
    expect(archived.every((r) => !String(r.requestId).startsWith("SEED-"))).toBe(true);
    expect(db.select().from(aiAuditLog).all().map((r) => r.id)).toEqual(rows.map((r) => r.id));
    sqlite.close();
  });
});
