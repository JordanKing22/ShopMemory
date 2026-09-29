/**
 * Provider base URLs (CLAUDE.md hard rule 3, PLAN.md §4.1). Pure: no env, no I/O.
 *
 * Every provider client is created with an explicit `baseURL` built here, and the host shown in the header,
 * checked by the routing policy and written to the audit log is derived from that SAME value. The SDKs' own
 * variables (ANTHROPIC_BASE_URL, ANTHROPIC_BEDROCK_BASE_URL, ANTHROPIC_BEDROCK_MANTLE_BASE_URL) are never
 * honoured: env.ts only reads them to warn at boot.
 *
 * The Bedrock defaults match @anthropic-ai/bedrock-sdk 0.34.0 (AnthropicBedrock and AnthropicBedrockMantle).
 */

/** First-party Anthropic API. The app never reads ANTHROPIC_BASE_URL. */
export const ANTHROPIC_BASE_URL_DEFAULT = "https://api.anthropic.com";

export type BedrockEndpointMode = "runtime" | "mantle";

/** Region names like us-east-1, eu-central-2, us-gov-west-1. Anything else never reaches a URL. */
const AWS_REGION_RE = /^[a-z]{2}(?:-gov)?-[a-z]+-\d{1,2}$/;

export function isValidAwsRegion(region: string | undefined): region is string {
  return typeof region === "string" && AWS_REGION_RE.test(region);
}

/** Default Bedrock Runtime endpoint for a region (AnthropicBedrock). */
export function bedrockRuntimeBaseUrl(region: string): string {
  return `https://bedrock-runtime.${region}.amazonaws.com`;
}

/** Default Bedrock Mantle endpoint for a region (AnthropicBedrockMantle). */
export function bedrockMantleBaseUrl(region: string): string {
  return `https://bedrock-mantle.${region}.api.aws/anthropic`;
}

/**
 * The base URL the Bedrock adapter passes to its client: BEDROCK_BASE_URL when set (FIPS/VPC endpoints),
 * else the regional default for the endpoint mode. Null when neither can be built (missing or invalid region).
 */
export function resolveBedrockBaseUrl(opts: {
  region: string | undefined;
  endpointMode: BedrockEndpointMode;
  baseUrlOverride: string | undefined;
}): string | null {
  if (opts.baseUrlOverride) return opts.baseUrlOverride;
  if (!isValidAwsRegion(opts.region)) return null;
  return opts.endpointMode === "mantle" ? bedrockMantleBaseUrl(opts.region) : bedrockRuntimeBaseUrl(opts.region);
}

/** Parses a base URL. Null for anything that isn't an absolute http(s) URL. Never throws. */
export function parseBaseUrl(url: string | null | undefined): URL | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/**
 * Lower-cased hostname of a base URL (no port, no user info; IPv6 keeps its brackets, e.g. "[::1]").
 * Null when the URL is not a valid http(s) URL.
 */
export function hostOf(url: string | null | undefined): string | null {
  const u = parseBaseUrl(url);
  return u ? u.hostname.toLowerCase() : null;
}
