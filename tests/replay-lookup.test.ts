import { describe, expect, it } from "vitest";
import { descriptorFor } from "@/lib/ai/descriptor";
import { replayKey } from "@/lib/ai/replay/key";
import { createTransportResolver } from "@/lib/ai/replay/lookup";
import { jaccard } from "@/lib/ai/replay/similarity";
import { memoryCassetteStore } from "@/lib/ai/replay/store";
import { chunkText, replayTiming } from "@/lib/ai/replay/transport";
import type { CassetteFile, ProviderStreamEvent, TransportContext, TransportLookup, TransportPolicy } from "@/lib/ai/types";
import { routingTargetFor } from "@/lib/policy/summary";
import type { Env } from "@/lib/env";
import { env } from "./fixtures/routing-env";

const H = (c: string) => c.repeat(64);

function file(over: Partial<CassetteFile> & Pick<CassetteFile, "id" | "task" | "targetClass">): CassetteFile {
  return { format: 1, promptVersion: "v1", provenance: "hand_authored", recordedOn: null, entries: [], ...over };
}

function entry(id: string, payloadHash: string, over: Partial<CassetteFile["entries"][number]> = {}): CassetteFile["entries"][number] {
  return {
    id,
    payloadHash,
    scenario: null,
    turnIndex: null,
    question: null,
    sources: [],
    note: null,
    response: { text: `answer ${id} [[CUSTOMER_AAAA]]`, data: null, stopReason: "end_turn", usage: { inputTokens: null, outputTokens: null }, ttftMs: null, latencyMs: null },
    ...over,
  };
}

const STORE = memoryCassetteStore([
  file({ id: "ask.cloud", task: "ask_shop", targetClass: "anthropic", entries: [entry("exact", H("a")), entry("scen", H("b"), { scenario: "s3", question: "how do we quote thin wall ti brackets for [[CUSTOMER_AAAA]]", sources: [{ key: "S1", fingerprint: "card:KC-091@abc" }] })] }),
  file({ id: "ask.local", task: "ask_shop", targetClass: "ollama_local", entries: [entry("local", H("c"))] }),
  file({ id: "extract.cloud", task: "card_extract", targetClass: "anthropic", entries: [entry("ex", H("d"), { scenario: "s2" })] }),
]);

function descriptor(kind: "anthropic" | "bedrock" | "ollama", e: Partial<Env> = {}) {
  const en = env({ AWS_REGION: "us-east-1", BEDROCK_MODEL_ID: "us.anthropic.claude-x", ...e });
  return descriptorFor(routingTargetFor(kind, en).target, { available: true, verified: "config-only-demo" });
}

function ctx(policy: Partial<TransportPolicy> = {}, live = false): TransportContext {
  return {
    policy: { demoMode: true, demoMiss: "offline", demoLiveLocal: false, replaySpeed: "instant", ...policy },
    live: live ? ({ descriptor: descriptor("anthropic") } as never) : null,
    fallback: () => ({ text: "fallback" }),
    detokenize: (t) => t.replace(/\[\[CUSTOMER_AAAA\]\]/g, "Aerovance"),
    sleep: async () => {},
  };
}

function lookup(over: Partial<TransportLookup> & Pick<TransportLookup, "payloadHash">): TransportLookup {
  const d = over.descriptor ?? descriptor("anthropic");
  return { task: "ask_shop", targetClass: d.targetClass, promptVersion: "v1", descriptor: d, scenario: null, sentFingerprints: [], ...over };
}

const resolver = createTransportResolver(STORE);

async function textOf(events: AsyncIterable<ProviderStreamEvent>) {
  let t = "";
  for await (const e of events) if (e.type === "text") t += e.text;
  return t;
}

describe("replay key", () => {
  it("depends on task, target class, prompt version and payload hash only — not host or model", () => {
    const k = { task: "smoke" as const, targetClass: "ollama_local" as const, promptVersion: "smoke-v1", payloadHash: H("e") };
    expect(replayKey(k)).toBe(`smoke|ollama_local|smoke-v1|${H("e")}`);
    const a = descriptor("ollama");
    const b = descriptor("ollama", { OLLAMA_MODEL: "granite4.1:3b", OLLAMA_BASE_URL: "http://localhost:11500" });
    expect(a.model).not.toBe(b.model);
    const ra = resolver.resolve(lookup({ payloadHash: H("c"), descriptor: a }), ctx());
    const rb = resolver.resolve(lookup({ payloadHash: H("c"), descriptor: b }), ctx());
    expect([ra.cassetteEntry, rb.cassetteEntry]).toEqual(["ask.local#local", "ask.local#local"]);
  });
});

describe("replay lookup order (PLAN.md §11.1)", () => {
  it("exact first; cloud and local never stand in for each other", () => {
    expect(resolver.resolve(lookup({ payloadHash: H("a") }), ctx())).toMatchObject({ transport: "demo_replay_exact", cassetteEntry: "ask.cloud#exact", provenance: "hand_authored" });
    expect(resolver.resolve(lookup({ payloadHash: H("c") }), ctx()).transport).toBe("demo_fallback");
    expect(resolver.resolve(lookup({ payloadHash: H("a"), descriptor: descriptor("ollama") }), ctx()).transport).toBe("demo_fallback");
  });

  it("Bedrock may use an Anthropic entry (exact only), labelled with where it was recorded", () => {
    const r = resolver.resolve(lookup({ payloadHash: H("a"), descriptor: descriptor("bedrock") }), ctx());
    expect(r).toMatchObject({ transport: "demo_replay_exact", cassetteEntry: "ask.cloud#exact" });
    expect(r.recordedOnModel).not.toBeNull();
  });

  it("scenario replay needs the hint, a similar tokenized question and every cited fingerprint sent", () => {
    const sc = { hint: "s3", question: "How do we quote thin-wall Ti brackets for [[CUSTOMER_AAAA]]?" };
    expect(resolver.resolve(lookup({ payloadHash: H("f"), scenario: sc, sentFingerprints: ["card:KC-091@abc"] }), ctx())).toMatchObject({ transport: "demo_replay_scenario", cassetteEntry: "ask.cloud#scen" });
    expect(resolver.resolve(lookup({ payloadHash: H("f"), scenario: sc, sentFingerprints: [] }), ctx()).transport).toBe("demo_fallback");
    expect(resolver.resolve(lookup({ payloadHash: H("f"), scenario: { ...sc, question: "What alarms does the VF-4 throw?" }, sentFingerprints: ["card:KC-091@abc"] }), ctx()).transport).toBe("demo_fallback");
    expect(jaccard("a b c d e", "a b c d f")).toBeCloseTo(4 / 6);
  });

  it("card extraction is never scenario-replayed", () => {
    const r = resolver.resolve(lookup({ task: "card_extract", payloadHash: H("9"), scenario: { hint: "s2" } }), ctx());
    expect(r.transport).toBe("demo_fallback");
  });

  it("live mode, or Ollama with DEMO_LIVE_LOCAL, always goes live (failing closed without a provider)", async () => {
    expect(resolver.resolve(lookup({ payloadHash: H("a") }), ctx({ demoMode: false })).transport).toBe("live");
    const local = resolver.resolve(lookup({ payloadHash: H("c"), descriptor: descriptor("ollama") }), ctx({ demoLiveLocal: true }));
    expect(local.transport).toBe("live");
    await expect(textOf(local.stream({} as never, { timeoutMs: 1, requestId: "r" }))).rejects.toMatchObject({ code: "provider_unavailable" });
  });

  it("DEMO_MISS=live uses a live-capable provider on a miss; otherwise the offline fallback", () => {
    expect(resolver.resolve(lookup({ payloadHash: H("9") }), ctx({ demoMiss: "live" }, true)).transport).toBe("live");
    expect(resolver.resolve(lookup({ payloadHash: H("9") }), ctx({ demoMiss: "live" }, false)).transport).toBe("demo_fallback");
  });
});

describe("ReplayTransport", () => {
  it("cloud streams the tokenized text; local streams it de-tokenized (like a live Ollama)", async () => {
    const cloud = resolver.resolve(lookup({ payloadHash: H("a") }), ctx());
    expect(await textOf(cloud.stream({} as never, { timeoutMs: 1, requestId: "r" }))).toBe("answer exact [[CUSTOMER_AAAA]]");
    const local = resolver.resolve(lookup({ payloadHash: H("c"), descriptor: descriptor("ollama") }), ctx());
    expect(await textOf(local.stream({} as never, { timeoutMs: 1, requestId: "r" }))).toBe("answer local Aerovance");
  });

  it("chunks deterministically by 12 code points and caps latency (structured ≤ 2 s, local ≤ 8 s)", () => {
    expect(chunkText("ab🙂".repeat(10)).map((c) => [...c].length)).toEqual([12, 12, 6]);
    const t = replayTiming("realistic", { isCloud: true, structured: false, chunks: 10, recordedTtftMs: null });
    expect(t).toEqual({ ttftMs: 700, perChunkMs: 25 });
    const s = replayTiming("realistic", { isCloud: true, structured: true, chunks: 400, recordedTtftMs: null });
    expect(s.ttftMs + s.perChunkMs * 399).toBeLessThanOrEqual(2000);
    const l = replayTiming("realistic", { isCloud: false, structured: false, chunks: 1000, recordedTtftMs: 30000 });
    expect(l.ttftMs + l.perChunkMs * 999).toBeLessThanOrEqual(8000);
    expect(replayTiming("instant", { isCloud: true, structured: false, chunks: 5, recordedTtftMs: null })).toEqual({ ttftMs: 0, perChunkMs: 0 });
  });

  it("an aborted signal stops the replay with aborted", async () => {
    const r = resolver.resolve(lookup({ payloadHash: H("a") }), ctx());
    const c = new AbortController();
    c.abort();
    await expect(textOf(r.stream({} as never, { timeoutMs: 1, requestId: "r", signal: c.signal }))).rejects.toMatchObject({ code: "aborted" });
  });
});
