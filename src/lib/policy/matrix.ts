/**
 * Routing matrix (PLAN.md §4.4): the single source of truth for which classification may go to which target
 * class (CLAUDE.md hard rule 5). The Privacy page table and the header clearance dots render from this data, and
 * Phase 3's decide() calls allowed(). Routing decisions live only in src/lib/policy/.
 *
 * Pure: no env reads, no I/O, no clock, no randomness. Every function fails closed: an unknown classification,
 * target, condition or missing fact means "not allowed".
 *
 * Contents
 * - ROUTING_MATRIX (plain data) + allowed() + clearanceFor(): classification × target class, with the
 *   env-driven exceptions CUSTOMER_CONFIDENTIAL_CLOUD=deny, CUSTOMER_CONFIDENTIAL_GLOBAL_PROFILE=deny and
 *   COVERED_MODEL_EC (default deny). Settings can only turn an allowed cell into a deny, never the reverse, so
 *   export_controlled can never reach the Anthropic API or a commercial Bedrock region.
 * - hybridRoute(): the Hybrid branch of decide(): export_controlled goes to the EC target (local Ollama, or
 *   GovCloud when HYBRID_EC_TARGET=govcloud), anything else to the cloud when cleared, else to local, else
 *   blocked. It never falls back to the cloud for data the cloud isn't cleared for.
 * - Target qualification: checkGovCloud() (the five GovCloud checks; anything failing is treated as a
 *   commercial region), ollamaLocality() (loopback, or allowlisted host over https / plaintext opt-in),
 *   isLoopbackHost(), crossRegionOf(), isCoveredModel().
 */
import { CLASSIFICATIONS, TARGET_CLASSES, type Classification } from "@/db/schema/enums";
import type { Env } from "@/lib/env";

export type TargetClass = (typeof TARGET_CLASSES)[number];
export { CLASSIFICATIONS, TARGET_CLASSES };

/** Bumped whenever the matrix or a qualification rule changes; Phase 3 writes it to every audit row. */
export const POLICY_VERSION = "matrix-v1";

// ---------------------------------------------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------------------------------------------

/** Column headings as PLAN.md §4.4 names them (the Privacy page renders these). */
export const TARGET_CLASS_LABEL: Readonly<Record<TargetClass, string>> = {
  anthropic: "Anthropic API",
  bedrock_commercial: "Bedrock (commercial region)",
  bedrock_govcloud: "Bedrock GovCloud (allowlisted host)",
  ollama_local: "Ollama (this computer / allowlisted on-prem host)",
};

/** Cloud targets always get redaction (including GovCloud); the local model never needs it. */
export const TARGET_IS_CLOUD: Readonly<Record<TargetClass, boolean>> = {
  anthropic: true,
  bedrock_commercial: true,
  bedrock_govcloud: true,
  ollama_local: false,
};

/** Settings that can turn an allowed cell into a deny. */
export type DenyCondition = "customer_confidential_cloud_deny" | "customer_confidential_global_profile_deny" | "covered_model_ec";

export const DENY_CONDITIONS: Readonly<Record<DenyCondition, { setting: string; description: string }>> = {
  customer_confidential_cloud_deny: {
    setting: "CUSTOMER_CONFIDENTIAL_CLOUD=deny",
    description:
      "Customer-confidential records go only to the local model or an allowlisted GovCloud endpoint, never to the Anthropic API or a commercial Bedrock region.",
  },
  customer_confidential_global_profile_deny: {
    setting: "CUSTOMER_CONFIDENTIAL_GLOBAL_PROFILE=deny",
    description:
      "Customer-confidential records are not sent to a Bedrock global cross-region inference profile, which can process requests in commercial regions worldwide, or to a profile whose scope can't be determined (treated as global).",
  },
  covered_model_ec: {
    setting: "COVERED_MODEL_EC=deny (default)",
    description:
      "Export-controlled records are not sent to a covered model (one that requires 30-day retention) unless COVERED_MODEL_EC=allow.",
  },
};

export interface MatrixCell {
  /** Verdict with the default settings (.env.example). */
  allowed: boolean;
  /** Redaction applies. Always on for cloud targets and not configurable; not applied for the local model. */
  redacted: boolean;
  /** Settings that turn this allowed cell into a deny. Nothing turns a denied cell into an allow. */
  deniedWhen: readonly DenyCondition[];
  /** Qualifier shown under the cell (PLAN.md §4.4 wording). */
  note?: string;
}

const cloudAllow = (deniedWhen: readonly DenyCondition[] = [], note?: string): MatrixCell =>
  note === undefined ? { allowed: true, redacted: true, deniedWhen } : { allowed: true, redacted: true, deniedWhen, note };
const localAllow: MatrixCell = { allowed: true, redacted: false, deniedWhen: [] };
const deny: MatrixCell = { allowed: false, redacted: false, deniedWhen: [] };

/** PLAN.md §4.4, cell for cell. */
export const ROUTING_MATRIX: Readonly<Record<Classification, Readonly<Record<TargetClass, MatrixCell>>>> = {
  general: {
    anthropic: cloudAllow(),
    bedrock_commercial: cloudAllow(),
    bedrock_govcloud: cloudAllow(),
    ollama_local: localAllow,
  },
  internal: {
    anthropic: cloudAllow(),
    bedrock_commercial: cloudAllow(),
    bedrock_govcloud: cloudAllow(),
    ollama_local: localAllow,
  },
  customer_confidential: {
    anthropic: cloudAllow(["customer_confidential_cloud_deny"], "CUSTOMER_CONFIDENTIAL_CLOUD=deny makes it local/GovCloud-only"),
    bedrock_commercial: cloudAllow(
      ["customer_confidential_cloud_deny", "customer_confidential_global_profile_deny"],
      "Global cross-region profiles can be denied (CUSTOMER_CONFIDENTIAL_GLOBAL_PROFILE=deny); CUSTOMER_CONFIDENTIAL_CLOUD=deny makes it local/GovCloud-only",
    ),
    bedrock_govcloud: cloudAllow(),
    ollama_local: localAllow,
  },
  export_controlled: {
    anthropic: deny,
    bedrock_commercial: deny,
    bedrock_govcloud: cloudAllow(["covered_model_ec"], "Not to covered models by default (COVERED_MODEL_EC=allow permits it)"),
    ollama_local: localAllow,
  },
};

/** Rows in classification order with cells in target order, for rendering the table. */
export function matrixRows(): { classification: Classification; cells: ({ targetClass: TargetClass } & MatrixCell)[] }[] {
  return CLASSIFICATIONS.map((classification) => ({
    classification,
    cells: TARGET_CLASSES.map((targetClass) => ({ targetClass, ...ROUTING_MATRIX[classification][targetClass] })),
  }));
}

/**
 * Bedrock inference-profile scope. "unknown" (an application inference profile ARN or any other resource we
 * can't read the scope from) is treated as global everywhere (fail closed).
 */
export type CrossRegion = "global" | "geo" | "none" | "unknown";
export type AllowDeny = "allow" | "deny";

/** Settings and facts about the concrete target that the conditional cells depend on. */
export interface PolicyOptions {
  /** CUSTOMER_CONFIDENTIAL_CLOUD (default allow). */
  customerConfidentialCloud?: AllowDeny;
  /** CUSTOMER_CONFIDENTIAL_GLOBAL_PROFILE (default allow). */
  customerConfidentialGlobalProfile?: AllowDeny;
  /** COVERED_MODEL_EC (default deny). */
  coveredModelEc?: AllowDeny;
  /** Inference-profile scope of the target's Bedrock model. "unknown" or missing counts as global (fail closed). */
  crossRegion?: CrossRegion;
  /** The target model requires 30-day retention. Unknown counts as covered (fail closed). */
  coveredModel?: boolean;
}

function conditionActive(condition: DenyCondition, opts: PolicyOptions): boolean {
  switch (condition) {
    case "customer_confidential_cloud_deny":
      return opts.customerConfidentialCloud === "deny";
    case "customer_confidential_global_profile_deny":
      return opts.customerConfidentialGlobalProfile === "deny" && opts.crossRegion !== "geo" && opts.crossRegion !== "none";
    case "covered_model_ec":
      return opts.coveredModelEc !== "allow" && opts.coveredModel !== false;
    default:
      return true; // an unknown condition denies
  }
}

/** May data of this classification be sent to this target class? */
export function allowed(classification: Classification, targetClass: TargetClass, opts: PolicyOptions = {}): boolean {
  if (!Object.hasOwn(ROUTING_MATRIX, classification)) return false;
  const row = ROUTING_MATRIX[classification];
  if (!Object.hasOwn(row, targetClass)) return false;
  const cell = row[targetClass];
  if (cell.allowed !== true) return false;
  return cell.deniedWhen.every((c) => !conditionActive(c, opts));
}

export const NO_CLEARANCE: Readonly<Record<Classification, boolean>> = {
  general: false,
  internal: false,
  customer_confidential: false,
  export_controlled: false,
};

/** Which classifications one target is cleared for (the header's four clearance dots). */
export function clearanceFor(targetClass: TargetClass, opts: PolicyOptions = {}): Record<Classification, boolean> {
  const out = { ...NO_CLEARANCE };
  for (const c of CLASSIFICATIONS) out[c] = allowed(c, targetClass, opts);
  return out;
}

/** The PolicyOptions for a concrete target under the current settings. */
export function policyOptionsFor(
  env: Pick<Env, "CUSTOMER_CONFIDENTIAL_CLOUD" | "CUSTOMER_CONFIDENTIAL_GLOBAL_PROFILE" | "COVERED_MODEL_EC">,
  target: { crossRegion?: CrossRegion; coveredModel: boolean },
): PolicyOptions {
  const opts: PolicyOptions = {
    customerConfidentialCloud: env.CUSTOMER_CONFIDENTIAL_CLOUD,
    customerConfidentialGlobalProfile: env.CUSTOMER_CONFIDENTIAL_GLOBAL_PROFILE,
    coveredModelEc: env.COVERED_MODEL_EC,
    coveredModel: target.coveredModel,
  };
  if (target.crossRegion !== undefined) opts.crossRegion = target.crossRegion;
  return opts;
}

// ---------------------------------------------------------------------------------------------------------------
// Hybrid mode
// ---------------------------------------------------------------------------------------------------------------

export interface RouteTarget {
  targetClass: TargetClass;
  opts?: PolicyOptions;
  /** Configured and usable (in Phase 2: from configuration; Phase 3 adds live health). */
  available: boolean;
}

export type HybridRoute =
  | { to: "ec_target" }
  | { to: "cloud" }
  | { to: "local" }
  | { to: "blocked"; reason: "local_unavailable_controlled" };

/**
 * Where Hybrid sends a request whose highest classification is `need` (PLAN.md §4.4 decide()):
 * export_controlled → the EC target (local Ollama, or GovCloud only if HYBRID_EC_TARGET=govcloud);
 * else the cloud target if it is available and cleared for `need`; else local Ollama if available;
 * else blocked. FAIL CLOSED: never a cloud fallback for data the cloud isn't cleared for.
 */
export function hybridRoute(
  need: Classification,
  targets: { cloud: RouteTarget; ecTarget: RouteTarget; local: RouteTarget },
): HybridRoute {
  const ok = (t: RouteTarget) => t.available && allowed(need, t.targetClass, t.opts);
  if (need === "export_controlled") {
    return ok(targets.ecTarget) ? { to: "ec_target" } : { to: "blocked", reason: "local_unavailable_controlled" };
  }
  if (ok(targets.cloud)) return { to: "cloud" };
  if (targets.local.targetClass === "ollama_local" && ok(targets.local)) return { to: "local" };
  return { to: "blocked", reason: "local_unavailable_controlled" };
}

// ---------------------------------------------------------------------------------------------------------------
// Target qualification
// ---------------------------------------------------------------------------------------------------------------

export const GOVCLOUD_REGIONS = ["us-gov-west-1", "us-gov-east-1"] as const;

/** Used when GOVCLOUD_ENDPOINT_ALLOWLIST is empty (PLAN.md §4.4 default: the two FIPS runtime hosts). */
export const GOVCLOUD_ENDPOINT_ALLOWLIST_DEFAULT: readonly string[] = GOVCLOUD_REGIONS.map(
  (r) => `bedrock-runtime-fips.${r}.amazonaws.com`,
);

export type GovCloudCheck = "region" | "allowlisted_host" | "host_has_region" | "https_no_path_or_userinfo" | "model_prefix";

/** What each check requires, for Settings ("which check failed"). Names settings, never their values. */
export const GOVCLOUD_CHECK_LABEL: Readonly<Record<GovCloudCheck, string>> = {
  region: "AWS_REGION must be us-gov-west-1 or us-gov-east-1",
  allowlisted_host: "the endpoint host must be listed in GOVCLOUD_ENDPOINT_ALLOWLIST",
  host_has_region: "the endpoint host must contain the region",
  https_no_path_or_userinfo: "the endpoint must use https with no path, query or user info",
  model_prefix: "BEDROCK_MODEL_ID must start with us-gov. (runtime) or anthropic. (mantle)",
};

export interface GovCloudInput {
  region: string | undefined;
  /** The exact base URL the Bedrock adapter will pass to its client (BEDROCK_BASE_URL or the regional default). */
  baseUrl: string | null;
  endpointMode: "runtime" | "mantle";
  modelId: string | undefined;
  /** GOVCLOUD_ENDPOINT_ALLOWLIST (lower-cased hosts); empty means the default list. */
  allowlist: readonly string[];
}

export interface GovCloudResult {
  qualified: boolean;
  failed: GovCloudCheck[];
}

function parseUrl(url: string | null | undefined): URL | null {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * A Bedrock endpoint is a GovCloud target only if ALL checks pass; otherwise it is treated as a commercial
 * region. Host comparison is lower-cased and exact. The one path accepted is the SDK's own Mantle suffix
 * "/anthropic" in mantle mode (the Mantle client's default base URL carries it).
 */
export function checkGovCloud(input: GovCloudInput): GovCloudResult {
  const failed: GovCloudCheck[] = [];
  const region = input.region?.trim().toLowerCase() ?? "";
  const url = parseUrl(input.baseUrl);
  const host = url ? url.hostname.toLowerCase() : "";
  const allowlist = (input.allowlist.length > 0 ? input.allowlist : GOVCLOUD_ENDPOINT_ALLOWLIST_DEFAULT).map((h) =>
    h.trim().toLowerCase(),
  );

  if (!(GOVCLOUD_REGIONS as readonly string[]).includes(region)) failed.push("region");
  if (!host || !allowlist.includes(host)) failed.push("allowlisted_host");
  if (!host || !region || !host.includes(region)) failed.push("host_has_region");

  const pathOk = url !== null && (url.pathname === "/" || url.pathname === "" || (input.endpointMode === "mantle" && url.pathname === "/anthropic"));
  if (!url || url.protocol !== "https:" || url.username !== "" || url.password !== "" || !pathOk || url.search !== "" || url.hash !== "") {
    failed.push("https_no_path_or_userinfo");
  }

  const model = input.modelId?.trim() ?? "";
  const prefix = input.endpointMode === "mantle" ? "anthropic." : "us-gov.";
  if (!model.startsWith(prefix)) failed.push("model_prefix");

  return { qualified: failed.length === 0, failed };
}

/** 127.0.0.0/8, ::1 and localhost only (a WHATWG-parsed hostname, e.g. from new URL(...).hostname). */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  let h = host.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h === "localhost" || h === "::1") return true;
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  return m !== null && m.slice(1).every((octet) => Number(octet) <= 255);
}

export type OllamaLocality = "this_computer" | "on_prem" | "on_prem_unencrypted" | "not_local";
export type OllamaLocalityProblem = "invalid_url" | "userinfo" | "not_allowlisted" | "plaintext_lan";

export interface OllamaLocalityResult {
  /** this_computer = loopback ("nothing leaves this computer" may be said only here). */
  locality: OllamaLocality;
  isLoopback: boolean;
  problem?: OllamaLocalityProblem;
}

/**
 * Ollama counts as local only if OLLAMA_BASE_URL is loopback, or its host is in OLLAMA_HOST_ALLOWLIST and it uses
 * https (or OLLAMA_ALLOW_PLAINTEXT_LAN=true: "on-prem · unencrypted"). Anything else is not a usable target.
 * (The model's remote_host check happens at runtime in Phase 3.)
 */
export function ollamaLocality(input: {
  baseUrl: string;
  /** OLLAMA_HOST_ALLOWLIST (lower-cased; "host" or "host:port"). */
  allowlist: readonly string[];
  allowPlaintextLan: boolean;
}): OllamaLocalityResult {
  const url = parseUrl(input.baseUrl);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
    return { locality: "not_local", isLoopback: false, problem: "invalid_url" };
  }
  if (url.username !== "" || url.password !== "") return { locality: "not_local", isLoopback: false, problem: "userinfo" };

  const hostname = url.hostname.toLowerCase();
  if (isLoopbackHost(hostname)) return { locality: "this_computer", isLoopback: true };

  const allow = input.allowlist.map((h) => h.trim().toLowerCase());
  if (!allow.includes(hostname) && !allow.includes(url.host.toLowerCase())) {
    return { locality: "not_local", isLoopback: false, problem: "not_allowlisted" };
  }
  if (url.protocol === "https:") return { locality: "on_prem", isLoopback: false };
  if (input.allowPlaintextLan) return { locality: "on_prem_unencrypted", isLoopback: false };
  return { locality: "not_local", isLoopback: false, problem: "plaintext_lan" };
}

/**
 * Inference-profile scope from the Bedrock model ID (PLAN.md §4.4 "global profiles deniable").
 * Bare IDs: "global." → global (may run in commercial regions worldwide), a geography prefix ("us.", "eu.",
 * "apac.", "us-gov.", …) → geo, no prefix → none (in-region).
 * ARNs (arn:partition:service:region:account:resource): the resource part decides.
 *   "inference-profile/<id>"  → the prefix rule above applied to <id> (system-defined profiles)
 *   "foundation-model/<id>"   → none
 *   anything else, including "application-inference-profile/<id>" (an opaque ID that can wrap a global
 *   profile) or a malformed ARN → unknown, which every rule treats as global (fail closed).
 */
export function crossRegionOf(modelId: string | undefined): CrossRegion {
  if (!modelId) return "none";
  const trimmed = modelId.trim().toLowerCase();
  if (trimmed.startsWith("arn:")) {
    const parts = trimmed.split(":");
    // Model IDs may contain ":" (e.g. "…-v1:0"), so the resource is everything after the fifth colon.
    if (parts.length < 6) return "unknown";
    const resource = parts.slice(5).join(":");
    const slash = resource.indexOf("/");
    const type = slash === -1 ? resource : resource.slice(0, slash);
    const id = slash === -1 ? "" : resource.slice(slash + 1);
    if (type === "foundation-model" && id) return "none";
    if (type === "inference-profile" && id) return prefixScope(id);
    return "unknown";
  }
  return prefixScope(trimmed);
}

function prefixScope(id: string): CrossRegion {
  const m = /^([a-z]{2,6}(?:-gov)?)\./.exec(id);
  if (!m) return "none";
  return m[1] === "global" ? "global" : "geo";
}

/**
 * Covered models (PLAN.md §4.1): the Fable and Mythos families (Fable 5.1, Mythos 5.1, Fable 5, Mythos 5 and their
 * Bedrock IDs) require 30-day retention. Matched by family name so every ID form is caught; any other version
 * of these families also counts (fail closed). Phase 3 moves this list to policy/covered-models.ts.
 */
export function isCoveredModel(modelId: string | undefined): boolean {
  return typeof modelId === "string" && /(?:^|[^a-z0-9])(?:fable|mythos)(?:[^a-z0-9]|$)/i.test(modelId);
}
