import { describe, expect, it } from "vitest";
import { aiAuditLog } from "@/db/schema";
import type { ProviderHealth } from "@/lib/ai/types";
import { ACTORS, stubProviders, testGateway } from "./helpers/gateway";
import { seededDb } from "./helpers/seeded-db";

const ollamaDown = () =>
  new Map([
    [
      "ollama" as const,
      {
        health: { kind: "ollama", targetClass: "ollama_local", host: "127.0.0.1", model: "qwen3.5:4b", status: "unreachable", verified: "live-probe", checkedAt: null, deep: false, problems: [] } as ProviderHealth,
        at: Date.parse("2026-10-01T10:00:05.000Z"),
      },
    ],
  ]);

/** The retrieval seam stands in for Phase 4's retriever: the context touches J-A02 (CC) and J-A06 (EC). */
const retrieve = () => [
  { kind: "job" as const, id: "J-A02" },
  { kind: "job" as const, id: "J-A06" },
];

function hybridDown(db: ReturnType<typeof seededDb>["db"]) {
  const stub = stubProviders();
  const { gw } = testGateway(db, {
    retrieve,
    providers: stub.factory,
    policy: { demoMode: false },
    routing: { mode: "hybrid", cloudProvider: "anthropic" },
    env: { ANTHROPIC_API_KEY: "sk-ant-test-1234567890" },
    healthStore: ollamaDown(),
  });
  return { gw, stub };
}

describe("Hybrid escape hatch: 'Ask without the N controlled records' (PLAN.md §4.4)", () => {
  it("offered when only the context is controlled; the server recomputes and sends only cleared records", async () => {
    const { db, sqlite } = seededDb();
    const { gw, stub } = hybridDown(db);
    const req = {
      task: "ask_shop" as const,
      feature: "ask_shop" as const,
      actor: ACTORS.maya,
      input: { text: "Compare these two." },
    };
    const first = await gw.runAI(req).collect();
    expect(first.meta?.decision).toMatchObject({ kind: "blocked", canExcludeControlled: true });
    expect(stub.calls).toHaveLength(0);

    const second = await gw.runAI({ ...req, excludeAboveClearance: true }).collect();
    expect(second.meta?.decision).toMatchObject({ kind: "user_excluded_controlled", sentCount: 1, withheldCount: 1 });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].descriptor.kind).toBe("anthropic");
    expect(JSON.stringify(stub.calls[0].request)).not.toMatch(/RJ-|GDS-|VLM-/);
    const row = db.select().from(aiAuditLog).all().find((r) => r.id === second.done!.auditId)!;
    expect(row).toMatchObject({ decision: "user_excluded_controlled", recordsSent: ["job:J-A02"], noticeKey: "user_excluded_controlled" });
    expect(row.recordsWithheld).toEqual([{ ref: "job:J-A06", classification: "export_controlled", reason: "user_excluded" }]);
    sqlite.close();
  });

  it("refused when the request itself is controlled (typed EC job number, or a pinned EC record): no button, forged POST blocked", async () => {
    const { db, sqlite } = seededDb();
    const { gw, stub } = hybridDown(db);
    const req = {
      task: "ask_shop" as const,
      feature: "ask_shop" as const,
      actor: ACTORS.maya,
      input: { text: "Anything on RJ-26-0310?" },
    };
    const r = await gw.runAI(req).collect();
    expect(r.meta?.decision).toMatchObject({ kind: "blocked", canExcludeControlled: false });
    const forged = await gw.runAI({ ...req, excludeAboveClearance: true }).collect();
    expect(forged.meta?.decision.kind).toBe("blocked");
    const pinned = { ...req, input: { text: "And this one?" }, pinned: [{ kind: "job" as const, id: "J-A06" }] };
    expect((await gw.runAI(pinned).collect()).meta?.decision).toMatchObject({ kind: "blocked", canExcludeControlled: false });
    expect((await gw.runAI({ ...pinned, excludeAboveClearance: true }).collect()).meta?.decision.kind).toBe("blocked");
    expect(stub.calls).toHaveLength(0);
    sqlite.close();
  });
});
