/**
 * Secret and payload hygiene (PLAN.md §4.10): REAL Anthropic and Bedrock clients with an injected fetch stub (success,
 * HTTP 500, malformed JSON carrying a canary), under ANTHROPIC_LOG=debug. Nothing a provider or a prompt contains may
 * reach stdout, stderr, the console or an AIError message. (The full replay path through runAI() is covered by
 * tests/gateway-hygiene.test.ts.)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { descriptorFor } from "@/lib/ai/descriptor";
import { AIError } from "@/lib/ai/errors";
import type { LLMProvider, ProviderRequest } from "@/lib/ai/types";
import { createAnthropicProvider } from "@/lib/ai/providers/anthropic";
import { createBedrockProvider } from "@/lib/ai/providers/bedrock";
import { routingTargetFor } from "@/lib/policy/summary";
import { dictionaryHits } from "@/lib/redaction";
import { env } from "./fixtures/routing-env";
import { messageStream, recordingFetch } from "./helpers/fake-fetch";
import { seedRedactionDictionary } from "./helpers/dictionary";

const CANARY_KEY = "sk-ant-canary-KEY-0123456789abcdef";
const CANARY_PHRASE = "CANARY-PHRASE-7f3a";
const PROMPT_FRAGMENT = "PROMPT-FRAGMENT-91c2 about Aerovance and Ray Delgado";

const REQ: ProviderRequest = {
  system: `System ${PROMPT_FRAGMENT}`,
  messages: [{ role: "user", content: `User ${PROMPT_FRAGMENT}` }],
  maxTokens: 256,
  output: { kind: "text" },
  effort: "low",
};

const captured: string[] = [];
const savedLog = process.env.ANTHROPIC_LOG;

beforeAll(() => {
  process.env.ANTHROPIC_LOG = "debug";
  const grab = (...args: unknown[]) => {
    captured.push(args.map((a) => (typeof a === "string" ? a : a instanceof Uint8Array ? Buffer.from(a).toString() : (JSON.stringify(a) ?? String(a)))).join(" "));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(grab as never);
  vi.spyOn(process.stderr, "write").mockImplementation(grab as never);
  for (const m of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(globalThis.console, m).mockImplementation(grab as never);
});

afterAll(() => {
  vi.restoreAllMocks();
  if (savedLog === undefined) delete process.env.ANTHROPIC_LOG;
  else process.env.ANTHROPIC_LOG = savedLog;
});

type Scenario = "ok" | "http500" | "malformed";

function handler(s: Scenario) {
  return () => {
    if (s === "ok") return messageStream([`answer with ${CANARY_PHRASE}`]);
    if (s === "http500") {
      return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: `${CANARY_PHRASE} ${CANARY_KEY}` } }), {
        status: 500,
        headers: { "content-type": "application/json", "retry-after-ms": "1", "x-api-key-echo": CANARY_KEY },
      });
    }
    return new Response(`event: message_start\ndata: {"type":"message_start", "${CANARY_PHRASE}": ${CANARY_KEY}\n\n`, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };
}

function anthropic(s: Scenario): LLMProvider {
  const e = env({ ANTHROPIC_API_KEY: CANARY_KEY });
  const d = descriptorFor(routingTargetFor("anthropic", e).target, { available: true, verified: "config-only" });
  return createAnthropicProvider(d, e, { fetch: recordingFetch(handler(s)).fetch });
}

function bedrock(s: Scenario): LLMProvider {
  const e = env({ LLM_PROVIDER: "bedrock", AWS_REGION: "us-east-1", BEDROCK_MODEL_ID: "us.anthropic.claude-x" });
  const d = descriptorFor(routingTargetFor("bedrock", e).target, { available: true, verified: "config-only" });
  return createBedrockProvider(d, e, { fetch: recordingFetch(handler(s)).fetch, bedrockAuth: { apiKey: CANARY_KEY } });
}

async function run(p: LLMProvider): Promise<{ text: string; error: AIError | null }> {
  let text = "";
  try {
    for await (const ev of p.stream(REQ, { timeoutMs: 10_000, requestId: "req_hygiene" })) if (ev.type === "text") text += ev.text;
    return { text, error: null };
  } catch (e) {
    return { text, error: e as AIError };
  }
}

function assertClean(where: string) {
  const all = captured.join("\n");
  expect(all, where).not.toContain(CANARY_KEY);
  expect(all, where).not.toContain(CANARY_PHRASE);
  expect(all, where).not.toContain("PROMPT-FRAGMENT");
  expect(dictionaryHits(all, seedRedactionDictionary()), where).toEqual([]);
}

describe("secret hygiene with real SDK clients", () => {
  for (const [name, make] of [
    ["anthropic", anthropic],
    ["bedrock", bedrock],
  ] as const) {
    it(`${name}: success streams the answer and logs nothing sensitive`, async () => {
      const r = await run(make("ok"));
      expect(r.error).toBeNull();
      expect(r.text).toContain(CANARY_PHRASE); // the answer itself is returned to the caller, never logged
      assertClean(`${name} ok`);
    });

    it(`${name}: HTTP 500 becomes a safe AIError`, async () => {
      const r = await run(make("http500"));
      expect(r.error).toBeInstanceOf(AIError);
      expect(r.error!.code).toBe("provider_error");
      expect(JSON.stringify(r.error!.toJSON()) + r.error!.message + String(r.error!.stack)).not.toMatch(/CANARY|sk-ant-canary/);
      assertClean(`${name} 500`);
    });

    it(`${name}: malformed JSON with a canary becomes a safe AIError`, async () => {
      const r = await run(make("malformed"));
      expect(r.error).toBeInstanceOf(AIError);
      expect(r.error!.message).not.toMatch(/CANARY|sk-ant-canary/);
      assertClean(`${name} malformed`);
    });
  }
});
