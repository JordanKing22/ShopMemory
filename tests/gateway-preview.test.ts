import { describe, expect, it } from "vitest";
import { aiAuditLog } from "@/db/schema";
import { payloadHashOf } from "@/lib/ai/pipeline/assemble";
import { readCassetteDir } from "@/lib/ai/replay/store";
import { canonicalJson } from "@/lib/seed/source";
import { ACTORS, stubProviders, testGateway } from "./helpers/gateway";
import { seededDb } from "./helpers/seeded-db";

const cassettes = readCassetteDir();
const smoke = { task: "smoke" as const, feature: "settings_test" as const, actor: ACTORS.maya };

describe("dry run = 'What will be sent' (PLAN.md §4.6)", () => {
  it("is byte-identical to what the real call sends and audits, and writes nothing", async () => {
    const { db, sqlite } = seededDb();
    const stub = stubProviders();
    const { gw } = testGateway(db, { providers: stub.factory, policy: { demoMode: false }, env: { ANTHROPIC_API_KEY: "sk-ant-test-1234567890" } });
    const before = db.select().from(aiAuditLog).all().length;
    const preview = await gw.runAI(smoke, { dryRun: true });
    expect(db.select().from(aiAuditLog).all().length).toBe(before);
    expect(stub.calls).toHaveLength(0);
    expect(preview.storedForm).toBe("as_sent_redacted");
    expect(preview.tokenLegend).toHaveLength(1);
    expect(preview.tokenLegend[0]).toMatchObject({ kind: "PERSON", display: "Maya Chen" });

    const r = await gw.runAI({ ...smoke, previewToken: preview.previewToken! }).collect();
    expect(r.done?.outcome).toBe("ok");
    expect(stub.calls[0].request).toEqual(preview.request);
    const row = db.select().from(aiAuditLog).all().find((x) => x.id === r.done!.auditId)!;
    expect(row.payloadHash).toBe(preview.payloadHash);
    expect(row.requestPayloadRedacted).toBe(canonicalJson(preview.request));
    expect(payloadHashOf(preview.request)).toBe(preview.payloadHash);
    sqlite.close();
  });

  it("a preview taken in Local, sent after a switch to Cloud, is rejected as stale (nothing written or sent)", async () => {
    const { db, sqlite } = seededDb();
    const local = testGateway(db, { cassettes, routing: { mode: "local", cloudProvider: "anthropic" } }).gw;
    const preview = await local.runAI(smoke, { dryRun: true });
    expect(preview.decision.target?.targetClass).toBe("ollama_local");
    expect(preview.storedForm).toBe("redacted_for_storage");

    const cloud = testGateway(db, { cassettes, routing: { mode: "cloud", cloudProvider: "anthropic" } }).gw;
    const r = await cloud.runAI({ ...smoke, previewToken: preview.previewToken! }).collect();
    expect(r.events).toEqual([{ t: "error", code: "preview_stale", message: expect.any(String) }]);
    expect(db.select().from(aiAuditLog).all().filter((x) => !x.requestId.startsWith("SEED-"))).toEqual([]);

    // The same destination accepts it.
    expect((await local.runAI({ ...smoke, previewToken: preview.previewToken! }).collect()).done?.outcome).toBe("ok");
    sqlite.close();
  });

  it("previews of blocked requests carry no payload and no token", async () => {
    const { db, sqlite } = seededDb();
    const { gw } = testGateway(db, { cassettes });
    const p = await gw.runAI(
      { task: "ask_shop", feature: "ask_shop", actor: ACTORS.maya, input: { text: "Notes on RJ-26-0310?" } },
      { dryRun: true },
    );
    expect(p).toMatchObject({ request: null, payloadHash: null, previewToken: null, decision: { kind: "blocked" } });
    sqlite.close();
  });

  it("the token legend hides amounts and contacts from roles that can't see them; suspects are reported", async () => {
    const { db, sqlite } = seededDb();
    const { gw } = testGateway(db, { cassettes });
    const text = "Ask morgan: Morgan Ellery quoted $1,800 for Aerovance";
    const asDevin = await gw.runAI({ task: "ask_shop", feature: "ask_shop", actor: ACTORS.devin, input: { text } }, { dryRun: true });
    const byKind = Object.fromEntries(asDevin.tokenLegend.map((e) => [e.kind, e]));
    expect(byKind.CUSTOMER.display).toBe("Aerovance");
    expect(byKind.CONTACT).toMatchObject({ display: null, hiddenLabel: "Hidden for Trainee role" });
    expect(byKind.AMOUNT).toMatchObject({ display: null });
    expect(asDevin.suspects.map((s) => [s.text, s.field])).toEqual([["morgan", "messages[0].content"]]);
    const asOwner = await gw.runAI({ task: "ask_shop", feature: "ask_shop", actor: ACTORS.owner, input: { text } }, { dryRun: true });
    expect(Object.fromEntries(asOwner.tokenLegend.map((e) => [e.kind, e.display])).AMOUNT).toBe("$1,800");
    sqlite.close();
  });
});
