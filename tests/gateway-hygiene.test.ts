/**
 * Full-path hygiene (PLAN.md §4.10): requests that carry seed names go through runAI() (cloud replay, local replay,
 * live stub, live failure, blocked, held) while stdout, stderr and the console are spied. Nothing a user typed or a
 * provider answered may reach a log line, and ai_audit_log / event_log hold no dictionary name. (Real SDK clients
 * under ANTHROPIC_LOG=debug are covered by tests/secret-hygiene.test.ts.)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { aiAuditLog, eventLog } from "@/db/schema";
import { AIError } from "@/lib/ai/errors";
import { readCassetteDir } from "@/lib/ai/replay/store";
import { dictionaryHits } from "@/lib/redaction";
import { seedRedactionDictionary } from "./helpers/dictionary";
import { ACTORS, stubProviders, testGateway } from "./helpers/gateway";
import { seededDb } from "./helpers/seeded-db";

const dict = seedRedactionDictionary();
const cassettes = readCassetteDir();
const QUESTION = "PROMPT-FRAGMENT-5e1d: what did Ray Delgado tell Aerovance about the quote at $1,250?";
const ANSWER = "ANSWER-FRAGMENT-0b7c about Dana Whitcomb";
const captured: string[] = [];

beforeAll(() => {
  const grab = (...args: unknown[]) => {
    captured.push(args.map((a) => (typeof a === "string" ? a : a instanceof Uint8Array ? Buffer.from(a).toString() : (JSON.stringify(a) ?? String(a)))).join(" "));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(grab as never);
  vi.spyOn(process.stderr, "write").mockImplementation(grab as never);
  for (const m of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(globalThis.console, m).mockImplementation(grab as never);
});

afterAll(() => vi.restoreAllMocks());

const ask = (text: string, actor = ACTORS.maya) => ({ task: "ask_shop" as const, feature: "ask_shop" as const, actor, input: { text } });

describe("runAI() leaves no names, prompts or answers in logs or audit tables", () => {
  it("across replay, live, failure, blocked and held calls", async () => {
    const { db, sqlite } = seededDb();

    const replayCloud = testGateway(db, { cassettes }).gw;
    await replayCloud.runAI({ task: "smoke", feature: "settings_test", actor: ACTORS.owner }).collect();
    const replayLocal = testGateway(db, { cassettes, routing: { mode: "local", cloudProvider: "anthropic" } }).gw;
    await replayLocal.runAI({ task: "smoke", feature: "settings_test", actor: ACTORS.ray }).collect();

    const live = { policy: { demoMode: false }, env: { ANTHROPIC_API_KEY: "sk-ant-test-1234567890" } };
    const ok = testGateway(db, { ...live, providers: stubProviders(() => ANSWER).factory }).gw;
    const answered = await ok.runAI(ask(QUESTION)).collect();
    expect(answered.done?.outcome).toBe("ok");
    const failing = testGateway(db, { ...live, providers: stubProviders(() => new AIError("provider_error")).factory }).gw;
    expect((await failing.runAI(ask(QUESTION)).collect()).error?.code).toBe("provider_error");
    const crashing = testGateway(db, { ...live, providers: stubProviders(() => new Error(`raw SDK error: ${QUESTION}`)).factory }).gw;
    expect((await crashing.runAI(ask(QUESTION)).collect()).error).not.toBeNull();

    const replay = testGateway(db, { cassettes }).gw;
    expect((await replay.runAI({ ...ask(`${QUESTION} And RJ-26-0310?`), pinned: [{ kind: "job", id: "J-A10" }] }).collect()).done?.outcome).toBe("blocked");
    expect((await replay.runAI(ask("Graymor and the 4410 manifold, per Ray Delgado?")).collect()).done?.outcome).toBe("held");

    const logged = captured.join("\n");
    for (const fragment of ["PROMPT-FRAGMENT-5e1d", "ANSWER-FRAGMENT-0b7c", "raw SDK error", "1,250"]) expect(logged).not.toContain(fragment);
    expect(dictionaryHits(logged, dict)).toEqual([]);

    const audit = db.select().from(aiAuditLog).all().filter((r) => !r.requestId.startsWith("SEED-"));
    expect(audit.length).toBeGreaterThanOrEqual(7);
    expect(dictionaryHits(JSON.stringify(audit), dict)).toEqual([]);
    expect(JSON.stringify(audit)).not.toContain("1,250");
    // The live answer named someone in the clear: stored with that person's token instead.
    const stored = audit.find((r) => r.id === answered.done?.auditId)!;
    expect(stored.responseRedacted).toMatch(/^ANSWER-FRAGMENT-0b7c about \[\[PERSON_[0-9A-Z]{4}\]\]$/);
    expect(dictionaryHits(JSON.stringify(db.select().from(eventLog).all()), dict)).toEqual([]);
    sqlite.close();
  });
});
