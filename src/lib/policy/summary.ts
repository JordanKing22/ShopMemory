/**
 * Routing summary for the header badge, Settings and the Privacy page (PLAN.md §4.4, §4.11). Pure: takes the
 * parsed env as an argument (only src/lib/env.ts reads process.env) and derives everything from matrix.ts and
 * the base-URL builders in src/lib/ai/endpoints.ts, so the host shown is the host the adapter will call.
 *
 * Precedence in Phase 2: env only — AI_MODE (default: local if LLM_PROVIDER=ollama, else cloud) and
 * LLM_PROVIDER (cloud side: anthropic or bedrock; with LLM_PROVIDER=ollama, HYBRID_CLOUD_PROVIDER).
 * Phase 3 adds the in-app ai_routing setting and AI_SETTINGS_LOCKED.
 *
 * Availability here comes from configuration only (as in DEMO_MODE with DEMO_LIVE_LOCAL=false); Phase 3 adds
 * live health. A target that is not usable is cleared for nothing (fail closed).
 *
 * Never returns secret values: the API key is only tested for presence, and configProblems name settings,
 * never their values.
 */
import type { Classification } from "@/db/schema/enums";
import type { Env } from "@/lib/env";
import {
  ANTHROPIC_BASE_URL_DEFAULT,
  hostOf,
  isValidAwsRegion,
  parseBaseUrl,
  resolveBedrockBaseUrl,
} from "@/lib/ai/endpoints";
import {
  CLASSIFICATIONS,
  GOVCLOUD_CHECK_LABEL,
  NO_CLEARANCE,
  TARGET_IS_CLOUD,
  allowed,
  checkGovCloud,
  clearanceFor,
  crossRegionOf,
  hybridRoute,
  isCoveredModel,
  ollamaLocality,
  policyOptionsFor,
  type CrossRegion,
  type GovCloudCheck,
  type HybridRoute,
  type OllamaLocality,
  type OllamaLocalityProblem,
  type PolicyOptions,
  type TargetClass,
} from "@/lib/policy/matrix";

export type RoutingMode = "cloud" | "local" | "hybrid";
export type ProviderKind = "anthropic" | "bedrock" | "ollama";
export type ProviderLabel = "Anthropic API" | "Amazon Bedrock" | "Ollama";

export const PROVIDER_LABEL: Readonly<Record<ProviderKind, ProviderLabel>> = {
  anthropic: "Anthropic API",
  bedrock: "Amazon Bedrock",
  ollama: "Ollama",
};

/** The env fields the summary reads. A full Env satisfies it. */
export type RoutingEnv = Pick<
  Env,
  | "LLM_PROVIDER"
  | "AI_MODE"
  | "HYBRID_CLOUD_PROVIDER"
  | "HYBRID_EC_TARGET"
  | "CUSTOMER_CONFIDENTIAL_CLOUD"
  | "CUSTOMER_CONFIDENTIAL_GLOBAL_PROFILE"
  | "COVERED_MODEL_EC"
  | "DEMO_MODE"
  | "ANTHROPIC_API_KEY"
  | "ANTHROPIC_MODEL"
  | "AWS_REGION"
  | "BEDROCK_ENDPOINT"
  | "BEDROCK_MODEL_ID"
  | "BEDROCK_BASE_URL"
  | "GOVCLOUD_ENDPOINT_ALLOWLIST"
  | "OLLAMA_BASE_URL"
  | "OLLAMA_MODEL"
  | "OLLAMA_HOST_ALLOWLIST"
  | "OLLAMA_ALLOW_PLAINTEXT_LAN"
>;

export interface RoutingTarget {
  targetClass: TargetClass;
  providerKind: ProviderKind;
  providerLabel: ProviderLabel;
  /** Configured model ID; "" when not configured (Bedrock without BEDROCK_MODEL_ID). */
  model: string;
  /** Lower-cased hostname of the exact base URL the adapter will use; "" when it can't be derived. */
  host: string;
  /** AWS region (Bedrock only, and only when valid). */
  region?: string;
  /** True only for an Ollama target whose host is 127.0.0.0/8, ::1 or localhost. Always false for cloud targets. */
  isLoopback: boolean;
  isCloud: boolean;
  /** Cloud calls are always redacted (including GovCloud); local calls are not. */
  redacted: boolean;
  /** Configuration is complete and the target qualifies; false means nothing can be sent there. */
  configured: boolean;
  /** Needs 30-day retention (PLAN.md §4.1). */
  coveredModel: boolean;
  /** Bedrock only. */
  crossRegion?: CrossRegion;
  fips?: boolean;
  endpointMode?: "runtime" | "mantle";
  govCloud?: { qualified: boolean; failed: GovCloudCheck[] };
  /** Ollama only: this_computer (loopback) · on_prem · on_prem_unencrypted · not_local. */
  locality?: OllamaLocality;
  /** What this target alone is cleared for (all false when not configured). */
  clearance: Record<Classification, boolean>;
}

/**
 * Where the active mode sends each classification: "primary" / "secondary" / "local" name the summary's target of
 * that name; "blocked" means nothing is sent. Hybrid fills it from hybridRoute() (cloud → primary,
 * ec_target → secondary, local → local); Cloud and Local modes use primary or blocked.
 */
export type RouteDestination = "primary" | "secondary" | "local" | "blocked";

export interface RoutingSummary {
  mode: RoutingMode;
  /** Cloud mode: the cloud provider. Local: Ollama. Hybrid: the cloud side. */
  primary: RoutingTarget;
  /** Hybrid only: where export-controlled records go (local Ollama, or GovCloud when HYBRID_EC_TARGET=govcloud). */
  secondary?: RoutingTarget;
  /**
   * Hybrid only: the local Ollama target that takes non-export-controlled records the cloud side isn't cleared
   * for. The same target as `secondary` when HYBRID_EC_TARGET=local.
   */
  local?: RoutingTarget;
  /** What the active mode can send, per classification (the header's clearance dots). */
  clearance: Record<Classification, boolean>;
  /** Where each classification goes in the active mode (clearance[c] === (routes[c] !== "blocked")). */
  routes: Record<Classification, RouteDestination>;
  demoMode: boolean;
  /** Setting names that need attention. Never contains values. */
  configProblems: string[];
  /** Where mode and provider came from (Phase 3 adds "setting"). */
  source: "env";
}

export function resolveMode(env: Pick<RoutingEnv, "AI_MODE" | "LLM_PROVIDER">): RoutingMode {
  if (env.AI_MODE === "cloud" || env.AI_MODE === "local" || env.AI_MODE === "hybrid") return env.AI_MODE;
  return env.LLM_PROVIDER === "ollama" ? "local" : "cloud";
}

/** The cloud side for Cloud and Hybrid modes. */
export function resolveCloudProvider(env: Pick<RoutingEnv, "LLM_PROVIDER" | "HYBRID_CLOUD_PROVIDER">): "anthropic" | "bedrock" {
  if (env.LLM_PROVIDER === "anthropic" || env.LLM_PROVIDER === "bedrock") return env.LLM_PROVIDER;
  return env.HYBRID_CLOUD_PROVIDER === "bedrock" ? "bedrock" : "anthropic";
}

function withClearance(t: Omit<RoutingTarget, "clearance">, opts: PolicyOptions): RoutingTarget {
  return { ...t, clearance: t.configured ? clearanceFor(t.targetClass, opts) : { ...NO_CLEARANCE } };
}

interface Built {
  target: RoutingTarget;
  opts: PolicyOptions;
  problems: string[];
}

function buildAnthropic(env: RoutingEnv): Built {
  const problems: string[] = [];
  const model = env.ANTHROPIC_MODEL;
  // DEMO_MODE replays recorded answers and needs no key; a live call does.
  const hasKey = Boolean(env.ANTHROPIC_API_KEY);
  if (!env.DEMO_MODE && !hasKey) problems.push("Anthropic API needs ANTHROPIC_API_KEY (or DEMO_MODE=true)");
  const coveredModel = isCoveredModel(model);
  const opts = policyOptionsFor(env, { coveredModel });
  const target = withClearance(
    {
      targetClass: "anthropic",
      providerKind: "anthropic",
      providerLabel: PROVIDER_LABEL.anthropic,
      model,
      host: hostOf(ANTHROPIC_BASE_URL_DEFAULT) ?? "",
      isLoopback: false,
      isCloud: TARGET_IS_CLOUD.anthropic,
      redacted: true,
      configured: env.DEMO_MODE || hasKey,
      coveredModel,
    },
    opts,
  );
  return { target, opts, problems };
}

function buildBedrock(env: RoutingEnv): Built {
  const problems: string[] = [];
  const region = env.AWS_REGION;
  const modelId = env.BEDROCK_MODEL_ID;

  const missing = [!region && "AWS_REGION", !modelId && "BEDROCK_MODEL_ID"].filter((x): x is string => Boolean(x));
  if (missing.length > 0) problems.push(`Amazon Bedrock needs ${missing.join(" and ")}`);
  const regionValid = isValidAwsRegion(region);
  if (region && !regionValid) problems.push("AWS_REGION is not a valid AWS region name");

  let overrideOk = true;
  if (env.BEDROCK_BASE_URL) {
    const u = parseBaseUrl(env.BEDROCK_BASE_URL);
    if (!u || u.protocol !== "https:") {
      overrideOk = false;
      problems.push("BEDROCK_BASE_URL must be a valid https URL");
    } else if (u.username !== "" || u.password !== "") {
      overrideOk = false;
      problems.push("BEDROCK_BASE_URL must not include a user name or password");
    }
  }

  const baseUrl = resolveBedrockBaseUrl({
    region: regionValid ? region : undefined,
    endpointMode: env.BEDROCK_ENDPOINT,
    baseUrlOverride: env.BEDROCK_BASE_URL,
  });
  const host = (overrideOk && hostOf(baseUrl)) || "";

  const govCloud = checkGovCloud({
    region,
    baseUrl: overrideOk ? baseUrl : null,
    endpointMode: env.BEDROCK_ENDPOINT,
    modelId,
    allowlist: env.GOVCLOUD_ENDPOINT_ALLOWLIST,
  });
  const looksGov =
    (region ?? "").toLowerCase().startsWith("us-gov-") || host.includes("us-gov") || (modelId ?? "").startsWith("us-gov.");
  if (looksGov && !govCloud.qualified) {
    problems.push(
      `The Bedrock endpoint is treated as a commercial region because a GovCloud check failed: ${govCloud.failed
        .map((c) => GOVCLOUD_CHECK_LABEL[c])
        .join("; ")}`,
    );
  }

  const targetClass: TargetClass = govCloud.qualified ? "bedrock_govcloud" : "bedrock_commercial";
  const crossRegion = crossRegionOf(modelId);
  const coveredModel = isCoveredModel(modelId);
  const opts = policyOptionsFor(env, { crossRegion, coveredModel });
  const base: Omit<RoutingTarget, "clearance"> = {
    targetClass,
    providerKind: "bedrock",
    providerLabel: PROVIDER_LABEL.bedrock,
    model: modelId ?? "",
    host,
    isLoopback: false,
    isCloud: TARGET_IS_CLOUD[targetClass],
    redacted: true,
    configured: missing.length === 0 && regionValid && overrideOk && host !== "",
    coveredModel,
    crossRegion,
    fips: host.includes("-fips."),
    endpointMode: env.BEDROCK_ENDPOINT,
    govCloud,
  };
  if (regionValid) base.region = region;
  return { target: withClearance(base, opts), opts, problems };
}

const OLLAMA_PROBLEM: Readonly<Record<OllamaLocalityProblem, string>> = {
  invalid_url: "OLLAMA_BASE_URL must be a valid http(s) URL",
  userinfo: "OLLAMA_BASE_URL must not include a user name or password",
  not_allowlisted: "OLLAMA_BASE_URL is not this computer and its host is not in OLLAMA_HOST_ALLOWLIST",
  plaintext_lan: "OLLAMA_BASE_URL must use https for an on-prem host (or set OLLAMA_ALLOW_PLAINTEXT_LAN=true)",
};

function buildOllama(env: RoutingEnv): Built {
  const loc = ollamaLocality({
    baseUrl: env.OLLAMA_BASE_URL,
    allowlist: env.OLLAMA_HOST_ALLOWLIST,
    allowPlaintextLan: env.OLLAMA_ALLOW_PLAINTEXT_LAN,
  });
  const problems = loc.problem ? [OLLAMA_PROBLEM[loc.problem]] : [];
  const coveredModel = isCoveredModel(env.OLLAMA_MODEL);
  const opts = policyOptionsFor(env, { coveredModel });
  const target = withClearance(
    {
      targetClass: "ollama_local",
      providerKind: "ollama",
      providerLabel: PROVIDER_LABEL.ollama,
      model: env.OLLAMA_MODEL,
      host: hostOf(env.OLLAMA_BASE_URL) ?? "",
      isLoopback: loc.isLoopback,
      isCloud: TARGET_IS_CLOUD.ollama_local,
      redacted: false,
      configured: loc.locality !== "not_local",
      coveredModel,
      locality: loc.locality,
    },
    opts,
  );
  return { target, opts, problems };
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}

/** Single-target modes: each classification goes to the primary target when cleared, else nowhere. */
function singleTargetRoutes(clearance: Record<Classification, boolean>): Record<Classification, RouteDestination> {
  const routes = {} as Record<Classification, RouteDestination>;
  for (const c of CLASSIFICATIONS) routes[c] = clearance[c] ? "primary" : "blocked";
  return routes;
}

const HYBRID_DESTINATION: Readonly<Record<HybridRoute["to"], RouteDestination>> = {
  cloud: "primary",
  ec_target: "secondary",
  local: "local",
  blocked: "blocked",
};

/** What the active mode may send and where, derived from env only (Phase 2). */
export function getRoutingSummary(env: RoutingEnv): RoutingSummary {
  const mode = resolveMode(env);
  const demoMode = env.DEMO_MODE;

  if (mode === "local") {
    const ollama = buildOllama(env);
    return {
      mode,
      primary: ollama.target,
      clearance: { ...ollama.target.clearance },
      routes: singleTargetRoutes(ollama.target.clearance),
      demoMode,
      configProblems: uniq(ollama.problems),
      source: "env",
    };
  }

  const cloud = resolveCloudProvider(env) === "bedrock" ? buildBedrock(env) : buildAnthropic(env);

  if (mode === "cloud") {
    return {
      mode,
      primary: cloud.target,
      clearance: { ...cloud.target.clearance },
      routes: singleTargetRoutes(cloud.target.clearance),
      demoMode,
      configProblems: uniq(cloud.problems),
      source: "env",
    };
  }

  // Hybrid: cloud side + EC target (+ local Ollama for anything the cloud isn't cleared for).
  const ollama = buildOllama(env);
  const problems = [...cloud.problems];
  let ec: Built;
  if (env.HYBRID_EC_TARGET === "govcloud") {
    ec = cloud.target.providerKind === "bedrock" ? cloud : buildBedrock(env);
    if (ec !== cloud) problems.push(...ec.problems);
    if (ec.target.targetClass !== "bedrock_govcloud") {
      problems.push("HYBRID_EC_TARGET=govcloud needs a Bedrock endpoint that passes the GovCloud checks");
    }
  } else {
    ec = ollama;
    problems.push(...ollama.problems);
  }

  const route = (t: Built) => ({ targetClass: t.target.targetClass, opts: t.opts, available: t.target.configured });
  const clearance = { ...NO_CLEARANCE };
  const routes = {} as Record<Classification, RouteDestination>;
  for (const c of CLASSIFICATIONS) {
    routes[c] = HYBRID_DESTINATION[hybridRoute(c, { cloud: route(cloud), ecTarget: route(ec), local: route(ollama) }).to];
    clearance[c] = routes[c] !== "blocked";
  }

  // Local Ollama also takes non-EC records the cloud isn't cleared for; report its problems when it's needed.
  const needsLocal = CLASSIFICATIONS.some(
    (c) => c !== "export_controlled" && !(cloud.target.configured && allowed(c, cloud.target.targetClass, cloud.opts)),
  );
  if (ec !== ollama && needsLocal) problems.push(...ollama.problems);

  return {
    mode,
    primary: cloud.target,
    secondary: ec.target,
    local: ollama.target,
    clearance,
    routes,
    demoMode,
    configProblems: uniq(problems),
    source: "env",
  };
}
