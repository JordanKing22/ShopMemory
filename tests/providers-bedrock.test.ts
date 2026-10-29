import { describe, expect, it } from "vitest";
import { descriptorFor } from "@/lib/ai/descriptor";
import type { ProviderRequest, ProviderStreamEvent } from "@/lib/ai/types";
import { createBedrockProvider } from "@/lib/ai/providers/bedrock";
import { routingTargetFor } from "@/lib/policy/summary";
import type { Env } from "@/lib/env";
import { env } from "./fixtures/routing-env";
import { messageStream, recordingFetch } from "./helpers/fake-fetch";

const REQ: ProviderRequest = {
  system: "Return JSON.",
  messages: [{ role: "user", content: "Go." }],
  maxTokens: 800,
  output: { kind: "json", schemaName: "x", jsonSchema: { type: "object", properties: {}, additionalProperties: false } },
  effort: "medium",
};

const BEDROCK: Partial<Env> = {
  LLM_PROVIDER: "bedrock",
  AWS_REGION: "us-west-2",
  BEDROCK_MODEL_ID: "us.anthropic.claude-sonnet-x",
  ANTHROPIC_BEDROCK_BASE_URL: "https://elsewhere.example.com",
};

async function collect(events: AsyncIterable<ProviderStreamEvent>) {
  const out: ProviderStreamEvent[] = [];
  for await (const ev of events) out.push(ev);
  return out;
}

function provider(over: Partial<Env> = {}) {
  const e = env({ ...BEDROCK, ...over });
  const d = descriptorFor(routingTargetFor("bedrock", e).target, { available: true, verified: "config-only" });
  const rec = recordingFetch(() => messageStream(["{}"]));
  return { p: createBedrockProvider(d, e, { fetch: rec.fetch, bedrockAuth: { apiKey: "fake-bedrock-bearer" } }), calls: rec.calls, d };
}

describe("Bedrock adapter", () => {
  it("posts to the explicit regional base URL with the Bedrock body shape and prompt-JSON (no output_config.format)", async () => {
    const { p, calls, d } = provider();
    expect(d.host).toBe("bedrock-runtime.us-west-2.amazonaws.com");
    expect(d.crossRegion).toBe("geo");
    await collect(p.stream(REQ, { timeoutMs: 5000, requestId: "r" }));
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.host).toBe("bedrock-runtime.us-west-2.amazonaws.com");
    expect(decodeURIComponent(url.pathname)).toBe("/model/us.anthropic.claude-sonnet-x/invoke-with-response-stream");
    const body = calls[0].body as Record<string, unknown>;
    expect(body).toMatchObject({ anthropic_version: "bedrock-2023-05-31", max_tokens: 800, output_config: { effort: "medium" } });
    expect(body).not.toHaveProperty("model");
    expect((body.output_config as Record<string, unknown>).format).toBeUndefined();
    for (const forbidden of ["temperature", "top_p", "top_k", "thinking", "tool_choice"]) expect(body).not.toHaveProperty(forbidden);
    expect(calls[0].headers.authorization).toBe("Bearer fake-bedrock-bearer");
    expect(p.caps.nativeJsonSchema).toBe(false);
  });

  it("fails closed without AWS_REGION or BEDROCK_MODEL_ID (never a silent us-east-1)", async () => {
    for (const over of [{ AWS_REGION: undefined }, { BEDROCK_MODEL_ID: undefined }]) {
      const { p, calls } = provider(over);
      await expect(collect(p.stream(REQ, { timeoutMs: 5000, requestId: "r" }))).rejects.toMatchObject({ code: "provider_unavailable" });
      expect(calls).toHaveLength(0);
    }
  });

  it("uses BEDROCK_BASE_URL (FIPS) exactly, and GovCloud qualification comes from the same host", async () => {
    const { d, p, calls } = provider({
      AWS_REGION: "us-gov-west-1",
      BEDROCK_MODEL_ID: "us-gov.anthropic.claude-x",
      BEDROCK_BASE_URL: "https://bedrock-runtime-fips.us-gov-west-1.amazonaws.com",
    });
    expect(d.targetClass).toBe("bedrock_govcloud");
    expect(d.fips).toBe(true);
    await collect(p.stream(REQ, { timeoutMs: 5000, requestId: "r" }));
    expect(new URL(calls[0].url).host).toBe("bedrock-runtime-fips.us-gov-west-1.amazonaws.com");
    expect((await p.health()).bedrock).toMatchObject({ govCloudQualified: true, fips: true });
  });
});
