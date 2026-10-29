/**
 * Gateway parity (PLAN.md §12): the same request through a stub LIVE transport and through REPLAY yields the same
 * decision, payload hash and audit row — only transport, provenance and served model may differ. DEMO_MODE changes
 * only the transport (PLAN.md §1 principle 3).
 */
import { describe, expect, it } from "vitest";
import { aiAuditLog } from "@/db/schema";
import { readCassetteDir } from "@/lib/ai/replay/store";
import { ACTORS, stubProviders, testGateway } from "./helpers/gateway";
import { seededDb } from "./helpers/seeded-db";

const cassettes = readCassetteDir();
const VOLATILE = ["id", "createdAt", "completedAt", "requestId", "transport", "cassetteProvenance", "servedModel", "latencyMs", "ttftMs", "inputTokens", "outputTokens", "responseRedacted", "stopReason"] as const;

function strip(row: Record<string, unknown>) {
  const out = { ...row };
  for (const k of VOLATILE) delete out[k];
  return out;
}

describe("gateway parity: live vs replay", () => {
  for (const mode of ["cloud", "local"] as const) {
    it(`${mode}: identical decision, payload hash and audit row except transport fields`, async () => {
      const { db, sqlite } = seededDb();
      const stub = stubProviders(() => "Received. This short reply confirms the connectivity check came through.");
      const routing = { mode, cloudProvider: "anthropic" as const };
      const req = { task: "smoke" as const, feature: "settings_test" as const, actor: ACTORS.maya };
      const replay = await testGateway(db, { cassettes, routing }).gw.runAI(req).collect();
      const live = await testGateway(db, {
        providers: stub.factory,
        routing,
        policy: { demoMode: false },
        env: { ANTHROPIC_API_KEY: "sk-ant-test-1234567890" },
        healthStore: new Map([["ollama", { health: { kind: "ollama", targetClass: "ollama_local", host: "127.0.0.1", model: "qwen3.5:4b", status: "ready", verified: "live-probe", checkedAt: null, deep: false, problems: [] }, at: Date.parse("2026-10-01T10:00:05.000Z") }]]),
      }).gw.runAI(req).collect();

      expect(replay.done?.transport).toBe("demo_replay_exact");
      expect(live.done?.transport).toBe("live");
      const rd = replay.meta!.decision;
      const ld = live.meta!.decision;
      expect(replay.meta!.sources).toEqual(live.meta!.sources);
      expect({ ...rd, target: { ...rd.target, verified: "x" } }).toEqual({ ...ld, target: { ...ld.target, verified: "x" } });
      const [a, b] = db.select().from(aiAuditLog).all().filter((r) => !r.requestId.startsWith("SEED-"));
      expect(a.payloadHash).toBe(b.payloadHash);
      expect(strip(a)).toEqual(strip(b));
      sqlite.close();
    });
  }
});
