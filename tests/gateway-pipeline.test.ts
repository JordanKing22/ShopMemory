import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { aiAuditLog, appSettings, eventLog } from "@/db/schema";
import { AIError } from "@/lib/ai/errors";
import { readCassetteDir, memoryCassetteStore } from "@/lib/ai/replay/store";
import { createTransportResolver } from "@/lib/ai/replay/lookup";
import { SMOKE_FALLBACK_TEXT } from "@/lib/ai/tasks/smoke";
import type { TaskDefinition } from "@/lib/ai/tasks/types";
import { dictionaryHits, tokensIn } from "@/lib/redaction";
import { z } from "zod";
import { seedRedactionDictionary } from "./helpers/dictionary";
import { ACTORS, countingResolver, stubProviders, testGateway } from "./helpers/gateway";
import { seededDb } from "./helpers/seeded-db";

const dict = seedRedactionDictionary();
const cassettes = readCassetteDir();
const smoke = (actor = ACTORS.owner) => ({ task: "smoke" as const, feature: "settings_test" as const, actor });
const rows = (db: ReturnType<typeof seededDb>["db"]) => db.select().from(aiAuditLog).all().filter((r) => !r.requestId.startsWith("SEED-"));

describe("runAI(): the Settings test prompt in DEMO_MODE", () => {
  it("Cloud: replays the cassette exactly, streams restored text, writes a tokenized REPLAY audit row", async () => {
    const { db, sqlite } = seededDb();
    const { gw } = testGateway(db, { cassettes });
    const r = await gw.runAI(smoke(ACTORS.maya)).collect();
    expect(r.events[0].t).toBe("meta");
    expect(r.events.at(-1)?.t).toBe("done");
    expect(r.error).toBeNull();
    expect(r.meta?.badge).toEqual({ text: "Anthropic API · claude-sonnet-5-5", replay: "scripted", recordedOnModel: null });
    expect(r.meta?.decision).toMatchObject({ kind: "allow", floor: "internal", target: { targetClass: "anthropic", redacted: true } });
    expect(r.text).toBe("Received. This short reply confirms the connectivity check came through.");
    expect(r.done).toMatchObject({ outcome: "ok", transport: "demo_replay_exact", provenance: "hand_authored" });

    const [row] = rows(db);
    expect(row).toMatchObject({
      id: r.done!.auditId,
      decision: "allow",
      transport: "demo_replay_exact",
      cassetteProvenance: "hand_authored",
      payloadStoredForm: "as_sent_redacted",
      servedModel: null,
      outcome: "ok",
      maxClassification: "internal",
      endpointHost: "api.anthropic.com",
      actorPersonaId: "P-PER-05",
    });
    expect(row.tokensUsed).toHaveLength(1);
    expect(row.tokensUsed[0]).toMatch(/^\[\[PERSON_[0-9A-Z]{4}\]\]$/);
    expect(row.requestPayloadRedacted).toContain(row.tokensUsed[0]);
    expect(dictionaryHits(JSON.stringify(row), dict)).toEqual([]);
    sqlite.close();
  });

  it("Local: replays the local cassette (de-tokenized like a live Ollama), stores the payload redacted-for-storage", async () => {
    const { db, sqlite } = seededDb();
    const { gw } = testGateway(db, { cassettes, routing: { mode: "local", cloudProvider: "anthropic" } });
    const r = await gw.runAI(smoke()).collect();
    expect(r.done).toMatchObject({ outcome: "ok", transport: "demo_replay_exact" });
    expect(r.meta?.badge.text).toBe("Ollama · qwen3.5:4b · this computer (not contacted: replay)");
    expect(r.meta?.decision.target).toMatchObject({ targetClass: "ollama_local", redacted: false, isLoopback: true });
    const [row] = rows(db);
    expect(row).toMatchObject({ payloadStoredForm: "redacted_for_storage", targetClass: "ollama_local", isCloud: false });
    expect(dictionaryHits(JSON.stringify(row), dict)).toEqual([]);
    sqlite.close();
  });

  it("a cache miss falls back to the scripted offline answer, labelled and audited as demo_fallback", async () => {
    const { db, sqlite } = seededDb();
    const { gw } = testGateway(db, { cassettes: [] });
    const r = await gw.runAI(smoke()).collect();
    expect(r.text).toBe(SMOKE_FALLBACK_TEXT);
    expect(r.meta?.badge.replay).toBe("fallback");
    expect(rows(db)[0]).toMatchObject({ transport: "demo_fallback", cassetteProvenance: null, outcome: "ok" });
    sqlite.close();
  });
});

describe("runAI(): live transport", () => {
  it("Cloud sends only the redacted request; Local sends it unredacted and stores a redacted copy", async () => {
    const { db, sqlite } = seededDb();
    const stub = stubProviders();
    const cloud = testGateway(db, { providers: stub.factory, policy: { demoMode: false }, env: { ANTHROPIC_API_KEY: "sk-ant-test-1234567890" } });
    const c = await cloud.gw.runAI(smoke(ACTORS.ray)).collect();
    expect(c.done).toMatchObject({ outcome: "ok", transport: "live" });
    expect(dictionaryHits(JSON.stringify(stub.calls[0].request), dict)).toEqual([]);
    expect(rows(db)[0]).toMatchObject({ transport: "live", servedModel: "claude-sonnet-5-5", payloadStoredForm: "as_sent_redacted" });

    const local = testGateway(db, { providers: stub.factory, policy: { demoMode: false }, routing: { mode: "local", cloudProvider: "anthropic" } });
    const l = await local.gw.runAI(smoke(ACTORS.ray)).collect();
    expect(l.done).toMatchObject({ outcome: "ok", transport: "live" });
    expect(stub.calls[1].descriptor.kind).toBe("ollama");
    expect(JSON.stringify(stub.calls[1].request)).toContain("Ray Delgado"); // local: not redacted
    const localRow = rows(db).find((r) => r.id === l.done!.auditId)!;
    expect(localRow.payloadStoredForm).toBe("redacted_for_storage");
    expect(dictionaryHits(JSON.stringify(localRow), dict)).toEqual([]);
    sqlite.close();
  });

  it("a provider error after meta yields error then done, and finalizes the row as provider_error", async () => {
    const { db, sqlite } = seededDb();
    const stub = stubProviders(() => new AIError("provider_overloaded"));
    const { gw } = testGateway(db, { providers: stub.factory, policy: { demoMode: false }, env: { ANTHROPIC_API_KEY: "sk-ant-test-1234567890" } });
    const r = await gw.runAI(smoke()).collect();
    expect(r.events.map((e) => e.t)).toEqual(["meta", "error", "done"]);
    expect(r.error).toMatchObject({ code: "provider_overloaded" });
    expect(rows(db)[0]).toMatchObject({ outcome: "provider_error", errorCode: "provider_overloaded" });
    sqlite.close();
  });

  it("a client abort finalizes the row as aborted", async () => {
    const { db, sqlite } = seededDb();
    const stub = stubProviders(() => "A longer answer that streams in pieces.");
    const { gw } = testGateway(db, { providers: stub.factory, policy: { demoMode: false }, env: { ANTHROPIC_API_KEY: "sk-ant-test-1234567890" } });
    const controller = new AbortController();
    const run = gw.runAI(smoke(), { signal: controller.signal });
    for await (const ev of run.events) {
      if (ev.t === "text") controller.abort();
    }
    expect(rows(db)[0]).toMatchObject({ outcome: "aborted" });
    sqlite.close();
  });

  it("a consumer that stops reading closes the row as aborted", async () => {
    const { db, sqlite } = seededDb();
    const stub = stubProviders(() => "A longer answer that streams in pieces.");
    const { gw } = testGateway(db, { providers: stub.factory, policy: { demoMode: false }, env: { ANTHROPIC_API_KEY: "sk-ant-test-1234567890" } });
    for await (const ev of gw.runAI(smoke()).events) if (ev.t === "text") break;
    expect(rows(db)[0]).toMatchObject({ outcome: "aborted" });
    sqlite.close();
  });

  it("a reset during the stream (demo epoch changed) skips the finalize and reports demo_epoch_changed", async () => {
    const { db, sqlite } = seededDb();
    const stub = stubProviders(() => {
      db.update(appSettings).set({ value: 999 }).where(eq(appSettings.key, "demo.epoch")).run();
      return "answer";
    });
    const { gw } = testGateway(db, { providers: stub.factory, policy: { demoMode: false }, env: { ANTHROPIC_API_KEY: "sk-ant-test-1234567890" } });
    const r = await gw.runAI(smoke()).collect();
    expect(r.error?.code).toBe("demo_epoch_changed");
    expect(rows(db)[0].outcome).toBe("pending");
    sqlite.close();
  });
});

describe("runAI(): decisions that send nothing never reach a transport", () => {
  const ask = (text: string, pinned: { kind: "job"; id: string }[] = [], actor = ACTORS.maya) => ({
    task: "ask_shop" as const,
    feature: "ask_shop" as const,
    actor,
    input: { text },
    pinned,
  });

  it("blocked (a pinned export-controlled job in Cloud): meta + done, a complete row, zero transport calls", async () => {
    const { db, sqlite } = seededDb();
    const counting = countingResolver(createTransportResolver(memoryCassetteStore(cassettes)));
    const { gw } = testGateway(db, { transports: counting.resolver });
    const r = await gw.runAI(ask("What should we watch on this job?", [{ kind: "job", id: "J-A10" }])).collect();
    expect(r.events.map((e) => e.t)).toEqual(["meta", "done"]);
    expect(r.meta?.decision).toMatchObject({ kind: "blocked", reason: "request_not_cleared", sentCount: 0, withheldCount: 1 });
    expect(r.meta?.decision.noticeText?.body).toContain("job RJ-26-0310");
    expect(r.done).toMatchObject({ outcome: "blocked", transport: "none" });
    expect(counting.count()).toBe(0);
    const [row] = rows(db);
    expect(row).toMatchObject({ decision: "blocked", transport: "none", outcome: "blocked", requestPayloadRedacted: null, recordsSent: [] });
    expect(row.recordsWithheld).toEqual([{ ref: "job:J-A10", classification: "export_controlled", reason: "not_cleared_for_target" }]);
    sqlite.close();
  });

  it("held (looks controlled): a detector hit is never sendable, even with a forged confirmation", async () => {
    const { db, sqlite } = seededDb();
    const counting = countingResolver(createTransportResolver(memoryCassetteStore(cassettes)));
    const { gw } = testGateway(db, { transports: counting.resolver });
    const r = await gw.runAI({ ...ask("How long did the 4410 manifold take?"), confirmNotControlled: true }).collect();
    expect(r.meta?.decision).toMatchObject({ kind: "held", canSendAnyway: false, holdTriggers: ["numeric_core"] });
    expect(counting.count()).toBe(0);
    const [row] = rows(db);
    expect(row).toMatchObject({ decision: "held", outcome: "held", transport: "none" });
    expect(row.userInputRedacted).toBe("How long did the 4410 manifold take?");
    sqlite.close();
  });

  it("Hybrid with Ollama down and export-controlled context: blocked, never sent to the cloud", async () => {
    const { db, sqlite } = seededDb();
    const stub = stubProviders();
    const down = new Map([["ollama" as const, { health: { kind: "ollama" as const, targetClass: "ollama_local" as const, host: "127.0.0.1", model: "qwen3.5:4b", status: "unreachable" as const, verified: "live-probe" as const, checkedAt: null, deep: false, problems: [] }, at: Date.parse("2026-10-01T10:00:05.000Z") }]]);
    const { gw } = testGateway(db, {
      providers: stub.factory,
      policy: { demoMode: false },
      routing: { mode: "hybrid", cloudProvider: "anthropic" },
      env: { ANTHROPIC_API_KEY: "sk-ant-test-1234567890" },
      healthStore: down,
    });
    const r = await gw.runAI(ask("What happened on this one?", [{ kind: "job", id: "J-A06" }])).collect();
    expect(r.meta?.decision).toMatchObject({ kind: "blocked", reason: "local_unavailable_controlled", canExcludeControlled: false });
    expect(r.meta?.decision.noticeText?.body).toContain("Floorwise never sends controlled data to the cloud as a fallback.");
    expect(stub.calls).toHaveLength(0);
    sqlite.close();
  });
});

describe("runAI(): errors before R1 produce no audit row", () => {
  it("unknown task, wrong feature, forbidden role and too much text are refused up front", async () => {
    const { db, sqlite } = seededDb();
    const { gw } = testGateway(db, { cassettes, env: { DEMO_OPEN_CONTROLS: false } });
    const cases = [
      [gw.runAI({ ...smoke(), task: "doc_generate" }), "task_unknown"],
      [gw.runAI({ ...smoke(), feature: "ask_shop" }), "invalid_request"],
      [gw.runAI(smoke(ACTORS.devin)), "forbidden"],
      [gw.runAI({ ...smoke(), input: { text: "x".repeat(4001) } }), "invalid_request"],
      [gw.runAI({ ...smoke(), actor: { ...ACTORS.maya, role: "owner" } }), "forbidden"],
    ] as const;
    for (const [run, code] of cases) {
      const r = await run.collect();
      expect(r.events).toEqual([{ t: "error", code, message: new AIError(code).safeMessage }]);
    }
    expect(rows(db)).toEqual([]);
    sqlite.close();
  });

  it("DEMO_OPEN_CONTROLS lets any persona send the test prompt", async () => {
    const { db, sqlite } = seededDb();
    const { gw } = testGateway(db, { cassettes });
    expect((await gw.runAI(smoke(ACTORS.devin)).collect()).done?.outcome).toBe("ok");
    sqlite.close();
  });
});

describe("runAI(): structured output with one repair retry", () => {
  const jsonTask: TaskDefinition<{ q: string }> = {
    name: "doc_generate",
    features: ["document_generator"],
    promptVersion: "json-test-v1",
    capability: "useAi",
    classificationFloor: "general",
    consent: "none",
    maxPinned: 0,
    output: {
      kind: "json",
      schemaName: "answer",
      jsonSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false },
      parse: (v) => z.object({ answer: z.string() }).strict().parse(v),
    },
    effort: "medium",
    maxTokens: 256,
    scenarioReplay: false,
    prepare: (ctx) => ({ q: ctx.input.text ?? "" }),
    buildPrompt: (i) => ({ system: "Return JSON.", messages: [{ role: "user", content: i.q }] }),
    offlineFallback: () => ({ text: '{"answer":"fallback"}' }),
  };

  it("an invalid first answer finalizes as invalid_output and a child row (attempt 2) carries the repaired answer", async () => {
    const { db, sqlite } = seededDb();
    let n = 0;
    const stub = stubProviders(() => (++n === 1 ? "not json" : '{"answer":"For Aerovance: ok"}'));
    const { gw } = testGateway(db, {
      providers: stub.factory,
      policy: { demoMode: false },
      env: { ANTHROPIC_API_KEY: "sk-ant-test-1234567890" },
      tasks: { doc_generate: jsonTask },
    });
    const r = await gw.runAI({ task: "doc_generate", feature: "document_generator", actor: ACTORS.maya, input: { text: "Summarize Aerovance." } }).collect();
    expect(r.data).toEqual({ answer: "For Aerovance: ok" });
    expect(r.done).toMatchObject({ outcome: "ok" });
    const [parent, child] = rows(db);
    expect(parent).toMatchObject({ outcome: "invalid_output", attempt: 1, errorCode: "invalid_output" });
    expect(child).toMatchObject({ outcome: "ok", attempt: 2, parentId: parent.id, requestId: parent.requestId });
    // The provider saw only tokens; the repair request ends with the user's repair instruction (no prefill).
    expect(dictionaryHits(JSON.stringify(stub.calls[0].request), dict)).toEqual([]);
    expect(stub.calls[1].request.messages.at(-1)?.role).toBe("user");
    expect(tokensIn(stub.calls[0].request.messages[0].content)).toHaveLength(1);
    sqlite.close();
  });
});

describe("audit and event hygiene of a full run", () => {
  it("no dictionary name appears in ai_audit_log or event_log after replay, live, blocked and held runs", async () => {
    const { db, sqlite } = seededDb();
    const { gw } = testGateway(db, { cassettes });
    await gw.runAI(smoke(ACTORS.maya)).collect();
    await gw.runAI({ task: "ask_shop", feature: "ask_shop", actor: ACTORS.maya, input: { text: "What did Ray Delgado say about Aerovance and RJ-26-0310?" } }).collect();
    await gw.runAI({ task: "ask_shop", feature: "ask_shop", actor: ACTORS.maya, input: { text: "Graymor first articles?" } }).collect();
    const audit = JSON.stringify(rows(db));
    const events = JSON.stringify(db.select().from(eventLog).all());
    expect(dictionaryHits(audit, dict)).toEqual([]);
    expect(dictionaryHits(events, dict)).toEqual([]);
    sqlite.close();
  });
});
