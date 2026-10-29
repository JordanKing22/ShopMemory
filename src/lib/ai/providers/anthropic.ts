/**
 * Anthropic API adapter (PLAN.md §4.1). The client is built lazily (DEMO_MODE needs no key) and only with an explicit
 * apiKey and an explicit baseURL taken from the descriptor (never ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / a profile
 * or credential chain), so the host shown, checked and audited is where traffic goes. ANTHROPIC_WORKSPACE_ID, when set,
 * is sent as the anthropic-workspace-id header (for keys not scoped to one workspace). SDK logs go to a logger that
 * discards their arguments.
 */
import Anthropic from "@anthropic-ai/sdk";
import { AIError } from "@/lib/ai/errors";
import type {
  CallOptions,
  LLMProvider,
  ProviderCaps,
  ProviderDescriptor,
  ProviderHealth,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamEvent,
} from "@/lib/ai/types";
import { hostOf } from "@/lib/ai/endpoints";
import type { Env } from "@/lib/env";
import { mapProviderError } from "./errors";
import { drain, streamMessages, toMessagesParams } from "./messages-api";
import { sdkLogger } from "./sdk-logger";

export interface AnthropicDeps {
  fetch?: typeof fetch;
  now?: () => Date;
}

/** Context window of the configured model, used only for prompt budgeting. */
const ANTHROPIC_CONTEXT_TOKENS = 200_000;

export function createAnthropicProvider(descriptor: ProviderDescriptor, env: Env, deps: AnthropicDeps = {}): LLMProvider {
  let client: Anthropic | null = null;
  const caps: ProviderCaps = { nativeJsonSchema: true, supportsEffort: true, maxContextTokens: ANTHROPIC_CONTEXT_TOKENS };

  function getClient(): Anthropic {
    if (!env.ANTHROPIC_API_KEY) throw new AIError("provider_unavailable");
    if (!descriptor.baseUrl || hostOf(descriptor.baseUrl) !== descriptor.host) throw new AIError("provider_unavailable");
    if (!client) {
      client = new Anthropic({
        apiKey: env.ANTHROPIC_API_KEY,
        authToken: null,
        webhookKey: null,
        baseURL: descriptor.baseUrl,
        maxRetries: 2,
        timeout: env.AI_TIMEOUT_MS,
        logLevel: "warn",
        logger: sdkLogger("anthropic"),
        ...(env.ANTHROPIC_WORKSPACE_ID ? { defaultHeaders: { "anthropic-workspace-id": env.ANTHROPIC_WORKSPACE_ID } } : {}),
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      });
    }
    return client;
  }

  /** Lazy: nothing (not even validation or the client) runs until iteration, so every failure surfaces there. */
  async function* stream(req: ProviderRequest, o: CallOptions): AsyncGenerator<ProviderStreamEvent> {
    const params = toMessagesParams(req, descriptor.model, { nativeJson: true });
    yield* streamMessages(getClient(), params, o);
  }

  async function health(deep = false): Promise<ProviderHealth> {
    const base: ProviderHealth = {
      kind: "anthropic",
      targetClass: descriptor.targetClass,
      host: descriptor.host,
      model: descriptor.model,
      status: env.ANTHROPIC_API_KEY ? "not_checked" : "misconfigured",
      verified: "config-only",
      checkedAt: null,
      deep,
      problems: env.ANTHROPIC_API_KEY ? [] : ["ANTHROPIC_API_KEY (or FLOORWISE_ANTHROPIC_API_KEY) is not set"],
      anthropic: { keyPresent: Boolean(env.ANTHROPIC_API_KEY), modelFound: null },
    };
    if (!deep || !env.ANTHROPIC_API_KEY) return base;
    const checkedAt = (deps.now ?? (() => new Date()))().toISOString();
    try {
      await getClient().models.retrieve(descriptor.model, {}, { timeout: Math.min(env.AI_TIMEOUT_MS, 10_000) });
      return { ...base, status: "ready", verified: "live-probe", checkedAt, anthropic: { keyPresent: true, modelFound: true } };
    } catch (err) {
      const code = mapProviderError(err).code;
      if (code === "provider_bad_request") {
        return { ...base, status: "model_missing", checkedAt, problems: ["ANTHROPIC_MODEL was not found for this key"], anthropic: { keyPresent: true, modelFound: false } };
      }
      if (code === "provider_auth") {
        return {
          ...base,
          status: "misconfigured",
          checkedAt,
          problems: ["The API rejected the key (check ANTHROPIC_API_KEY, and ANTHROPIC_WORKSPACE_ID for keys not scoped to a workspace)"],
        };
      }
      return { ...base, status: "unreachable", checkedAt, problems: ["The Anthropic API could not be reached"] };
    }
  }

  return {
    descriptor,
    caps,
    stream,
    complete: (req, o): Promise<ProviderResponse> => drain(stream(req, o)),
    health,
  };
}
