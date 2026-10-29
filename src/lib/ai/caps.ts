/**
 * Provider capabilities by kind (PLAN.md §4.1). Static, so assembly (P6) never has to construct an adapter — the
 * preview and demo:verify run with no provider client at all.
 */
import type { Env } from "@/lib/env";
import type { ProviderCaps, ProviderKind } from "./types";

export function capsFor(kind: ProviderKind, env: Pick<Env, "OLLAMA_NUM_CTX">): ProviderCaps {
  if (kind === "anthropic") return { nativeJsonSchema: true, supportsEffort: true, maxContextTokens: 200_000 };
  if (kind === "bedrock") return { nativeJsonSchema: false, supportsEffort: true, maxContextTokens: 200_000 };
  return { nativeJsonSchema: true, supportsEffort: false, maxContextTokens: env.OLLAMA_NUM_CTX };
}
