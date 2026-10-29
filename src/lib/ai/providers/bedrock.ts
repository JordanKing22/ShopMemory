/**
 * Amazon Bedrock adapter (PLAN.md §4.1): AnthropicBedrock (runtime, default) or AnthropicBedrockMantle
 * (BEDROCK_ENDPOINT=mantle). AWS_REGION and BEDROCK_MODEL_ID are required and the adapter fails closed without them
 * (the SDK would otherwise default to us-east-1). The client always gets the descriptor's explicit baseURL (the SDK
 * ignores AWS_USE_FIPS_ENDPOINT and would honour ANTHROPIC_BEDROCK_BASE_URL). Credentials: the standard AWS chain
 * (profile/SSO, env keys, or AWS_BEARER_TOKEN_BEDROCK); tests inject explicit fake credentials so the container's own
 * chain is never consulted. Prompt-JSON only (no output_config.format on Bedrock); same forbidden parameters as the
 * first-party API. Model IDs are never hardcoded.
 */
import { AnthropicBedrock, AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { AIError } from "@/lib/ai/errors";
import type {
  CallOptions,
  LLMProvider,
  ProviderCaps,
  ProviderDescriptor,
  ProviderHealth,
  ProviderRequest,
  ProviderStreamEvent,
} from "@/lib/ai/types";
import { hostOf, isValidAwsRegion } from "@/lib/ai/endpoints";
import type { Env } from "@/lib/env";
import { GOVCLOUD_CHECK_LABEL } from "@/lib/policy/matrix";
import { drain, streamMessages, toMessagesParams } from "./messages-api";
import { sdkLogger } from "./sdk-logger";

/** Tests only: explicit credentials so no real AWS chain is read. */
export type BedrockAuthOverride =
  | { apiKey: string }
  | { awsAccessKey: string; awsSecretKey: string; awsSessionToken?: string }
  | { providerChainResolver: () => Promise<() => Promise<{ accessKeyId: string; secretAccessKey: string }>> };

export interface BedrockDeps {
  fetch?: typeof fetch;
  bedrockAuth?: BedrockAuthOverride;
}

const BEDROCK_CONTEXT_TOKENS = 200_000;

type MessagesClient = Pick<AnthropicBedrock, "messages">;

export function createBedrockProvider(descriptor: ProviderDescriptor, env: Env, deps: BedrockDeps = {}): LLMProvider {
  let client: MessagesClient | null = null;
  const caps: ProviderCaps = { nativeJsonSchema: false, supportsEffort: true, maxContextTokens: BEDROCK_CONTEXT_TOKENS };

  function getClient(): MessagesClient {
    const region = descriptor.region;
    if (!isValidAwsRegion(region) || !descriptor.model) throw new AIError("provider_unavailable");
    if (!descriptor.baseUrl || hostOf(descriptor.baseUrl) !== descriptor.host) throw new AIError("provider_unavailable");
    if (!client) {
      const common = {
        baseURL: descriptor.baseUrl,
        maxRetries: 2,
        timeout: env.AI_TIMEOUT_MS,
        logLevel: "warn" as const,
        logger: sdkLogger("bedrock"),
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      };
      const auth = deps.bedrockAuth;
      if (descriptor.endpointMode === "mantle") {
        client = new AnthropicBedrockMantle({
          ...common,
          awsRegion: region,
          ...(auth && "apiKey" in auth ? { apiKey: auth.apiKey } : {}),
          ...(auth && "awsAccessKey" in auth
            ? { awsAccessKey: auth.awsAccessKey, awsSecretAccessKey: auth.awsSecretKey, awsSessionToken: auth.awsSessionToken ?? null }
            : {}),
          ...(auth && "providerChainResolver" in auth ? { providerChainResolver: auth.providerChainResolver } : {}),
        });
      } else if (auth && "awsAccessKey" in auth) {
        client = new AnthropicBedrock({
          ...common,
          awsRegion: region,
          awsAccessKey: auth.awsAccessKey,
          awsSecretKey: auth.awsSecretKey,
          awsSessionToken: auth.awsSessionToken ?? null,
        });
      } else {
        client = new AnthropicBedrock({
          ...common,
          awsRegion: region,
          ...(auth && "apiKey" in auth ? { apiKey: auth.apiKey } : {}),
          ...(auth && "providerChainResolver" in auth ? { providerChainResolver: auth.providerChainResolver } : {}),
        });
      }
    }
    return client;
  }

  /** Lazy: nothing (not even validation or the client) runs until iteration, so every failure surfaces there. */
  async function* stream(req: ProviderRequest, o: CallOptions): AsyncGenerator<ProviderStreamEvent> {
    const params = toMessagesParams(req, descriptor.model, { nativeJson: false });
    yield* streamMessages(getClient(), params, o);
  }

  async function health(deep = false): Promise<ProviderHealth> {
    const problems: string[] = [];
    if (!descriptor.region) problems.push("AWS_REGION is not set or not valid");
    if (!descriptor.model) problems.push("BEDROCK_MODEL_ID is not set");
    if (descriptor.govCloud && !descriptor.govCloud.qualified && descriptor.targetClass !== "bedrock_govcloud" && (descriptor.region ?? "").startsWith("us-gov-")) {
      problems.push(...descriptor.govCloud.failed.map((c) => GOVCLOUD_CHECK_LABEL[c]));
    }
    return {
      kind: "bedrock",
      targetClass: descriptor.targetClass,
      host: descriptor.host,
      model: descriptor.model,
      // Bedrock has no probe that sends no shop data and no prompt; configuration is the check.
      status: problems.length > 0 ? "misconfigured" : "not_checked",
      verified: "config-only",
      checkedAt: null,
      deep,
      problems,
      bedrock: {
        region: descriptor.region ?? null,
        endpointMode: descriptor.endpointMode ?? "runtime",
        fips: descriptor.fips === true,
        crossRegion: descriptor.crossRegion ?? "none",
        govCloudQualified: descriptor.govCloud?.qualified === true,
        govCloudFailed: descriptor.govCloud?.failed ?? [],
        coveredModel: descriptor.coveredModel,
      },
    };
  }

  return { descriptor, caps, stream, complete: (req, o) => drain(stream(req, o)), health };
}
