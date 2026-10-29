/**
 * Provider factory (docs/AI-GATEWAY.md §8): builds the live adapter for a descriptor. Clients are lazy (no SDK client
 * exists until a call needs one) and adapters are cached per process, keyed by kind | baseUrl | model, so the Ollama
 * model check and the SDK connection pools are reused. Tests and scripts inject fetch / credentials.
 */
import type { Env } from "@/lib/env";
import { getEnv } from "@/lib/env";
import type { LLMProvider, ProviderDescriptor, ProviderFactory } from "@/lib/ai/types";
import { createAnthropicProvider } from "./anthropic";
import { createBedrockProvider, type BedrockAuthOverride } from "./bedrock";
import { createOllamaProvider } from "./ollama";

export { descriptorFor } from "@/lib/ai/descriptor";

export interface ProviderDeps {
  fetch?: typeof fetch;
  now?: () => Date;
  bedrockAuth?: BedrockAuthOverride;
}

export function createProvider(d: ProviderDescriptor, env: Env, deps: ProviderDeps = {}): LLMProvider {
  if (d.kind === "anthropic") return createAnthropicProvider(d, env, deps);
  if (d.kind === "bedrock") return createBedrockProvider(d, env, deps);
  return createOllamaProvider(d, env, deps);
}

const slot = globalThis as typeof globalThis & { __floorwiseProviders?: Map<string, LLMProvider> };

/** The production factory: one cached adapter per kind | baseUrl | model (availability is decided elsewhere). */
export const defaultProviderFactory: ProviderFactory = (d) => {
  const cache = (slot.__floorwiseProviders ??= new Map());
  const key = `${d.kind}|${d.baseUrl}|${d.model}`;
  let p = cache.get(key);
  if (!p) {
    p = createProvider(d, getEnv());
    cache.set(key, p);
  }
  // The cached adapter keeps its own descriptor for the endpoint; callers read availability from theirs.
  return { ...p, descriptor: d };
};

/** A factory for tests and scripts with injected transports (never cached). */
export function providerFactoryWith(env: Env, deps: ProviderDeps): ProviderFactory {
  return (d) => createProvider(d, env, deps);
}
