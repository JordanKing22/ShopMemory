/**
 * Test helpers for the gateway: an injected clock, request IDs, instant sleep, in-memory cassettes, a stub "live"
 * provider factory that records calls, and a test task (registered as ask_shop) that accepts pinned records.
 */
import type { Db } from "@/db/client";
import { createGateway, type Gateway } from "@/lib/ai/gateway";
import { createTransportResolver } from "@/lib/ai/replay/lookup";
import { memoryCassetteStore } from "@/lib/ai/replay/store";
import type { TaskDefinition } from "@/lib/ai/tasks/types";
import type {
  AIActor,
  CassetteFile,
  GatewayDeps,
  LLMProvider,
  ProviderDescriptor,
  ProviderFactory,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamEvent,
  TransportPolicy,
  TransportResolver,
} from "@/lib/ai/types";
import type { AiRoutingSetting } from "@/lib/policy/types";
import type { Env } from "@/lib/env";
import { env as hermeticEnv } from "../fixtures/routing-env";

export const ACTORS: Record<string, AIActor> = {
  owner: { personaId: "P-OWNER", personId: null, role: "owner" },
  ray: { personaId: "P-PER-01", personId: "PER-01", role: "quoter" },
  maya: { personaId: "P-PER-05", personId: "PER-05", role: "quoter" },
  marv: { personaId: "P-PER-02", personId: "PER-02", role: "machinist" },
  devin: { personaId: "P-PER-06", personId: "PER-06", role: "trainee" },
};

export interface StubCall {
  descriptor: ProviderDescriptor;
  request: ProviderRequest;
}

/** A "live" provider that answers with fixed text (or throws) and records every request it receives. */
export function stubProviders(answer: (req: ProviderRequest, d: ProviderDescriptor) => string | Error = () => "Stub answer.") {
  const calls: StubCall[] = [];
  const factory: ProviderFactory = (d) => {
    const p: LLMProvider = {
      descriptor: d,
      caps: { nativeJsonSchema: d.kind !== "bedrock", supportsEffort: d.kind !== "ollama", maxContextTokens: 8192 },
      async *stream(req: ProviderRequest, o): AsyncGenerator<ProviderStreamEvent> {
        calls.push({ descriptor: d, request: req });
        const a = answer(req, d);
        if (a instanceof Error) throw a;
        for (const piece of [a.slice(0, 5), a.slice(5)]) {
          if (o.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
          if (piece) yield { type: "text", text: piece };
        }
        const response: ProviderResponse = {
          text: a,
          stopReason: "end_turn",
          rawStopReason: "end_turn",
          servedModel: d.model,
          usage: { inputTokens: 10, outputTokens: 5 },
          timings: { latencyMs: 1, ttftMs: 1 },
        };
        yield { type: "done", response };
      },
      async complete() {
        throw new Error("unused");
      },
      async health() {
        return { kind: d.kind, targetClass: d.targetClass, host: d.host, model: d.model, status: "ready", verified: "live-probe", checkedAt: null, deep: false, problems: [] };
      },
    };
    return p;
  };
  return { factory, calls };
}

/** Test task registered as "ask_shop": pinned records become S# sources; the prompt lists them as JSON. */
export const echoTask: TaskDefinition<{ question: string }> = {
  name: "ask_shop",
  features: ["ask_shop"],
  promptVersion: "echo-test-v1",
  capability: "useAi",
  classificationFloor: "general",
  consent: "none",
  maxPinned: 10,
  output: { kind: "text" },
  effort: "medium",
  maxTokens: 512,
  scenarioReplay: true,
  defaultScenario: "echo",
  prepare: (ctx) => ({ question: ctx.input.text ?? "" }),
  buildPrompt: (input, sources) => ({
    system: `Answer from the sources. Cite them as [S#].\n${sources.map((s) => `[${s.key}] ${JSON.stringify(s.projection)}`).join("\n")}`,
    messages: [{ role: "user", content: input.question || "Summarize the sources." }],
  }),
  offlineFallback: () => ({ text: "Offline fallback (scripted, not model output)." }),
};

export interface TestGatewayOptions {
  env?: Partial<Env>;
  routing?: AiRoutingSetting;
  policy?: Partial<TransportPolicy>;
  cassettes?: CassetteFile[];
  providers?: ProviderFactory;
  transports?: TransportResolver;
  tasks?: GatewayDeps["tasks"];
  healthStore?: GatewayDeps["healthStore"];
  retrieve?: GatewayDeps["retrieve"];
}

export function testGateway(db: Db, o: TestGatewayOptions = {}): { gw: Gateway; env: Env } {
  const env = hermeticEnv(o.env);
  let n = 0;
  let t = Date.parse("2026-10-01T10:00:00.000Z");
  const deps: GatewayDeps = {
    db,
    env,
    now: () => new Date((t += 1000)),
    newRequestId: () => `req_test_${++n}`,
    providers: o.providers ?? stubProviders().factory,
    transports: o.transports ?? createTransportResolver(memoryCassetteStore(o.cassettes ?? [])),
    sleep: async () => {},
    tasks: { ask_shop: echoTask, ...(o.tasks ?? {}) },
    healthStore: o.healthStore ?? new Map(),
  };
  if (o.routing) deps.routingOverride = o.routing;
  if (o.retrieve) deps.retrieve = o.retrieve;
  if (o.policy) deps.transportPolicyOverride = o.policy;
  return { gw: createGateway(deps), env };
}

/** A transport resolver that counts calls (blocked/held must never reach it). */
export function countingResolver(inner: TransportResolver): { resolver: TransportResolver; count: () => number } {
  let count = 0;
  return {
    resolver: {
      resolve: (l, c) => {
        count++;
        return inner.resolve(l, c);
      },
    },
    count: () => count,
  };
}
