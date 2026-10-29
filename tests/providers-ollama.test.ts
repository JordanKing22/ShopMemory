import { describe, expect, it } from "vitest";
import { descriptorFor } from "@/lib/ai/descriptor";
import type { ProviderRequest, ProviderStreamEvent } from "@/lib/ai/types";
import { createOllamaProvider, versionAtLeast } from "@/lib/ai/providers/ollama";
import { routingTargetFor } from "@/lib/policy/summary";
import type { Env } from "@/lib/env";
import { env } from "./fixtures/routing-env";
import { json, ndjson, recordingFetch, type Recorded } from "./helpers/fake-fetch";

const REQ: ProviderRequest = {
  system: "Be brief.",
  messages: [{ role: "user", content: "Hi" }],
  maxTokens: 400,
  output: { kind: "text" },
  effort: "low",
};

function fakeOllama(opts: { remoteHost?: string; missing?: boolean } = {}) {
  return (req: Recorded) => {
    const path = new URL(req.url).pathname;
    if (path === "/api/version") return json(200, { version: "0.34.6" });
    if (path === "/api/show") {
      if (opts.missing) return json(404, { error: "model not found" });
      return json(200, { model_info: { "qwen3.context_length": 32768 }, ...(opts.remoteHost ? { remote_host: opts.remoteHost } : {}) });
    }
    if (path === "/api/ps") return json(200, { models: [{ name: "qwen3.5:4b", size: 100, size_vram: 25 }] });
    if (path === "/api/chat") {
      const body = req.body as { stream?: boolean };
      if (body.stream === false) return json(200, { done: true });
      return ndjson([
        { model: "qwen3.5:4b", message: { role: "assistant", content: "Hel" }, done: false },
        { model: "qwen3.5:4b", message: { role: "assistant", content: "lo" }, done: false },
        { model: "qwen3.5:4b", message: { role: "assistant", content: "" }, done: true, done_reason: "stop", load_duration: 2_000_000, prompt_eval_count: 9, eval_count: 3 },
      ]);
    }
    return json(404, {});
  };
}

function provider(over: Partial<Env> = {}, opts = {}) {
  const e = env({ LLM_PROVIDER: "ollama", ...over });
  const d = descriptorFor(routingTargetFor("ollama", e).target, { available: true, verified: "live-probe" });
  const rec = recordingFetch(fakeOllama(opts));
  return { p: createOllamaProvider(d, e, { fetch: rec.fetch }), calls: rec.calls };
}

async function collect(events: AsyncIterable<ProviderStreamEvent>) {
  const out: ProviderStreamEvent[] = [];
  for await (const ev of events) out.push(ev);
  return out;
}

describe("Ollama adapter", () => {
  it("uses native /api/chat with think:false, keep_alive and identical options on every call, redirect:error", async () => {
    const { p, calls } = provider();
    const events = await collect(p.stream(REQ, { timeoutMs: 5000, requestId: "r" }));
    await collect(p.stream({ ...REQ, output: { kind: "json", schemaName: "x", jsonSchema: { type: "object" } } }, { timeoutMs: 5000, requestId: "r2" }));
    await p.warm!({ timeoutMs: 5000, requestId: "w" });
    const chats = calls.filter((c) => new URL(c.url).pathname === "/api/chat");
    expect(chats).toHaveLength(3);
    const opts = chats.map((c) => JSON.stringify((c.body as { options: unknown }).options));
    expect(new Set(opts).size).toBe(1);
    expect(JSON.parse(opts[0])).toEqual({ num_ctx: 8192, temperature: 0, num_predict: 1536 });
    for (const c of chats) {
      expect(c.body).toMatchObject({ think: false, keep_alive: "60m" });
      expect(c.redirect).toBe("error");
    }
    expect((chats[0].body as { messages: { role: string }[] }).messages[0].role).toBe("system");
    expect((chats[1].body as { format?: unknown }).format).toEqual({ type: "object" });
    expect(calls.every((c) => !new URL(c.url).pathname.startsWith("/v1"))).toBe(true);
    const done = events.at(-1);
    expect(done?.type === "done" && done.response).toMatchObject({ text: "Hello", stopReason: "end_turn", usage: { inputTokens: 9, outputTokens: 3 }, timings: { loadDurationMs: 2, evalCount: 3 } });
  });

  it("refuses a model with a non-empty remote_host (Ollama cloud model): model_not_allowed, no chat call", async () => {
    const { p, calls } = provider({}, { remoteHost: "https://ollama.com:443" });
    await expect(collect(p.stream(REQ, { timeoutMs: 5000, requestId: "r" }))).rejects.toMatchObject({ code: "model_not_allowed" });
    expect(calls.some((c) => new URL(c.url).pathname === "/api/chat")).toBe(false);
    expect((await p.health()).status).toBe("model_not_allowed");
  });

  it("refuses a non-local base URL before any request", async () => {
    const { p, calls } = provider({ OLLAMA_BASE_URL: "http://10.0.0.9:11434", OLLAMA_HOST_ALLOWLIST: ["10.0.0.9"] });
    await expect(collect(p.stream(REQ, { timeoutMs: 5000, requestId: "r" }))).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(calls).toHaveLength(0);
    expect((await p.health()).status).toBe("misconfigured");
  });

  it("health: ready with version/model/warm facts; model_missing; unreachable", async () => {
    const ok = await provider().p.health(true);
    expect(ok).toMatchObject({ status: "ready", ollama: { version: "0.34.6", versionOk: true, modelPulled: true, remoteHostEmpty: true, contextLength: 32768, warm: true, gpuShare: 0.25 } });
    expect((await provider({}, { missing: true }).p.health()).status).toBe("model_missing");
    const e = env({ LLM_PROVIDER: "ollama" });
    const d = descriptorFor(routingTargetFor("ollama", e).target, { available: true, verified: "live-probe" });
    const down = createOllamaProvider(d, e, { fetch: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
    expect((await down.health()).status).toBe("unreachable");
    await expect(collect(down.stream(REQ, { timeoutMs: 5000, requestId: "r" }))).rejects.toMatchObject({ code: "provider_connection" });
  });

  it("compares versions numerically", () => {
    expect(versionAtLeast("0.34.10", "0.34.4")).toBe(true);
    expect(versionAtLeast("0.34.3", "0.34.4")).toBe(false);
    expect(versionAtLeast("v1.0.0-rc1", "0.34.4")).toBe(true);
  });
});
