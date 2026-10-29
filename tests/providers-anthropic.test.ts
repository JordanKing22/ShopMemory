import { describe, expect, it } from "vitest";
import { descriptorFor } from "@/lib/ai/descriptor";
import { AIError } from "@/lib/ai/errors";
import type { ProviderRequest, ProviderStreamEvent } from "@/lib/ai/types";
import { createAnthropicProvider } from "@/lib/ai/providers/anthropic";
import { routingTargetFor } from "@/lib/policy/summary";
import { env } from "./fixtures/routing-env";
import { json, messageStream, recordingFetch } from "./helpers/fake-fetch";

const REQ: ProviderRequest = {
  system: "You are a connectivity check.",
  messages: [{ role: "user", content: "Reply with one short sentence." }],
  maxTokens: 1024,
  output: { kind: "text" },
  effort: "low",
};

function provider(over = {}, handler = () => messageStream(["Hello", " there."])) {
  const e = env({ ANTHROPIC_API_KEY: "sk-ant-test-0000000000", ANTHROPIC_BASE_URL: "https://elsewhere.example.com", ...over });
  const d = descriptorFor(routingTargetFor("anthropic", e).target, { available: true, verified: "config-only" });
  const rec = recordingFetch(handler);
  return { p: createAnthropicProvider(d, e, { fetch: rec.fetch }), calls: rec.calls };
}

async function collect(events: AsyncIterable<ProviderStreamEvent>) {
  const out: ProviderStreamEvent[] = [];
  for await (const ev of events) out.push(ev);
  return out;
}

describe("Anthropic adapter", () => {
  it("calls the explicit base URL (never ANTHROPIC_BASE_URL) with only allowed parameters", async () => {
    const { p, calls } = provider();
    const events = await collect(p.stream(REQ, { timeoutMs: 5000, requestId: "req_1" }));
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).host).toBe("api.anthropic.com");
    const body = calls[0].body as Record<string, unknown>;
    expect(body).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 1024, system: REQ.system, stream: true, output_config: { effort: "low" } });
    for (const forbidden of ["temperature", "top_p", "top_k", "thinking", "tool_choice", "tools", "fallbacks"]) expect(body).not.toHaveProperty(forbidden);
    expect((body.messages as { role: string }[]).at(-1)?.role).toBe("user");
    expect(calls[0].headers["x-api-key"]).toBe("sk-ant-test-0000000000");
    expect(calls[0].headers["anthropic-workspace-id"]).toBeUndefined();
    expect(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text)).toEqual(["Hello", " there."]);
    const done = events.at(-1);
    expect(done?.type === "done" && done.response).toMatchObject({ text: "Hello there.", stopReason: "end_turn", servedModel: "claude-sonnet-5-5", usage: { inputTokens: 12, outputTokens: 7 } });
  });

  it("sends the workspace ID header when ANTHROPIC_WORKSPACE_ID is set", async () => {
    const { p, calls } = provider({ ANTHROPIC_WORKSPACE_ID: "wrkspc_test" });
    await collect(p.stream(REQ, { timeoutMs: 5000, requestId: "req_1" }));
    expect(calls[0].headers["anthropic-workspace-id"]).toBe("wrkspc_test");
  });

  it("JSON output uses output_config.format with the hand-written schema, untransformed", async () => {
    const { p, calls } = provider();
    const schema = { type: "object", properties: { kind: { type: "string", enum: ["a", "b"] } }, required: ["kind"], additionalProperties: false };
    await collect(p.stream({ ...REQ, output: { kind: "json", schemaName: "x", jsonSchema: schema } }, { timeoutMs: 5000, requestId: "r" }));
    expect((calls[0].body as { output_config: unknown }).output_config).toEqual({ effort: "low", format: { type: "json_schema", schema } });
  });

  it("reports a refusal as stopReason refusal with its category only", async () => {
    const { p } = provider({}, () => messageStream([], { stopReason: "refusal", stopDetails: { type: "refusal", category: "cyber", explanation: "secret words" } }));
    const done = (await collect(p.stream(REQ, { timeoutMs: 5000, requestId: "r" }))).at(-1);
    expect(done?.type === "done" && done.response.stopReason).toBe("refusal");
    expect(JSON.stringify(done)).not.toContain("secret words");
  });

  it("refuses an assistant prefill and maps HTTP errors to safe codes", async () => {
    const { p } = provider();
    await expect(collect(p.stream({ ...REQ, messages: [...REQ.messages, { role: "assistant", content: "Sure" }] }, { timeoutMs: 5000, requestId: "r" }))).rejects.toMatchObject({ code: "invalid_request" });
    const bad = provider({}, () => json(401, { type: "error", error: { type: "authentication_error", message: "must include the anthropic-workspace-id header" } }));
    const err = await collect(bad.p.stream(REQ, { timeoutMs: 5000, requestId: "r" })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AIError);
    expect((err as AIError).code).toBe("provider_auth");
    expect((err as AIError).message).not.toContain("workspace");
  });

  it("never builds a client without a key (DEMO_MODE needs none)", async () => {
    const { p, calls } = provider({ ANTHROPIC_API_KEY: undefined });
    await expect(collect(p.stream(REQ, { timeoutMs: 5000, requestId: "r" }))).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(calls).toHaveLength(0);
    expect((await p.health(true)).status).toBe("misconfigured");
  });

  it("deep health retrieves the model; an auth failure names the settings, never values", async () => {
    const ok = provider({}, () => json(200, { id: "claude-sonnet-5-5", type: "model", display_name: "x", created_at: "2026-09-28T00:00:00Z" }));
    expect((await ok.p.health(true)).status).toBe("ready");
    expect(new URL(ok.calls[0].url).pathname).toBe("/v1/models/claude-sonnet-5-5");
    const denied = provider({}, () => json(401, { type: "error", error: { type: "authentication_error", message: "bad" } }));
    const h = await denied.p.health(true);
    expect(h.status).toBe("misconfigured");
    expect(h.problems.join(" ")).toMatch(/ANTHROPIC_WORKSPACE_ID/);
  });
});
