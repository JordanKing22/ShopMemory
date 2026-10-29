/**
 * The ONLY module that reads process.env (CLAUDE.md hard rule 3).
 * Parsed lazily and cached so tests and scripts can prepare the environment first.
 * Scripts load .env files with scripts/lib/load-env.mts before importing anything that calls getEnv().
 */
import { z } from "zod";

const bool = (def: boolean) =>
  z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : v === "true" || v === "1"));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

const EnvSchema = z.object({
  LLM_PROVIDER: z.enum(["anthropic", "bedrock", "ollama"]).default("anthropic"),
  AI_MODE: z
    .enum(["cloud", "local", "hybrid", ""])
    .optional()
    .transform((v) => (v ? v : undefined)),
  HYBRID_CLOUD_PROVIDER: z.enum(["anthropic", "bedrock"]).default("anthropic"),
  HYBRID_EC_TARGET: z.enum(["local", "govcloud"]).default("local"),
  AI_SETTINGS_LOCKED: bool(false),
  CUSTOMER_CONFIDENTIAL_CLOUD: z.enum(["allow", "deny"]).default("allow"),
  CUSTOMER_CONFIDENTIAL_GLOBAL_PROFILE: z.enum(["allow", "deny"]).default("allow"),
  COVERED_MODEL_EC: z.enum(["allow", "deny"]).default("deny"),
  VOICE_VENDOR_CLOUD: z.enum(["on", "off"]).default("off"),

  DEMO_MODE: bool(true),
  DEMO_OPEN_CONTROLS: bool(true),
  DEMO_MISS: z.enum(["offline", "live"]).default("offline"),
  DEMO_REPLAY_SPEED: z.enum(["realistic", "fast", "instant"]).default("realistic"),
  DEMO_LIVE_LOCAL: bool(false),
  DEMO_PIN: optionalString,

  /** Resolved by getEnv(): FLOORWISE_ANTHROPIC_API_KEY wins over ANTHROPIC_API_KEY. */
  ANTHROPIC_API_KEY: optionalString,
  /**
   * App-specific name for the same key. Use it where ANTHROPIC_API_KEY is taken by another tool (for example a
   * Claude Code cloud environment, which reserves that name for its own sign-in).
   */
  FLOORWISE_ANTHROPIC_API_KEY: optionalString,
  /**
   * Resolved by getEnv(): FLOORWISE_ANTHROPIC_WORKSPACE_ID wins over ANTHROPIC_WORKSPACE_ID. Sent as the
   * anthropic-workspace-id header by the Anthropic adapter, for API keys that aren't scoped to one workspace (the API
   * then answers "must include the anthropic-workspace-id header"). An identifier, not a secret, but never logged.
   */
  ANTHROPIC_WORKSPACE_ID: optionalString,
  FLOORWISE_ANTHROPIC_WORKSPACE_ID: optionalString,
  ANTHROPIC_MODEL: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : "claude-sonnet-5-5")),

  AWS_REGION: optionalString,
  BEDROCK_ENDPOINT: z.enum(["runtime", "mantle"]).default("runtime"),
  BEDROCK_MODEL_ID: optionalString,
  BEDROCK_BASE_URL: optionalString,
  GOVCLOUD_ENDPOINT_ALLOWLIST: csv,

  OLLAMA_BASE_URL: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : "http://127.0.0.1:11434")),
  OLLAMA_MODEL: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : "qwen3.5:4b")),
  OLLAMA_NUM_CTX: z.coerce.number().int().positive().default(8192),
  OLLAMA_HOST_ALLOWLIST: csv,
  OLLAMA_ALLOW_PLAINTEXT_LAN: bool(false),

  PUBLIC_BASE_URL: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : "http://localhost:3000")),
  FLOORWISE_DB: z.enum(["main", "e2e"]).default("main"),
  AUTH_MODE: z.enum(["demo"]).default("demo"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),

  // SDK variables we never honour (we always pass an explicit baseURL); read only to warn at boot.
  ANTHROPIC_BASE_URL: optionalString,
  ANTHROPIC_BEDROCK_BASE_URL: optionalString,
  ANTHROPIC_BEDROCK_MANTLE_BASE_URL: optionalString,
});

export type Env = z.output<typeof EnvSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      // Never echo values: they may be secrets.
      throw new Error(`Invalid environment configuration in: ${fields}`);
    }
    const data = parsed.data;
    cached = {
      ...data,
      ANTHROPIC_API_KEY: data.FLOORWISE_ANTHROPIC_API_KEY ?? data.ANTHROPIC_API_KEY,
      ANTHROPIC_WORKSPACE_ID: data.FLOORWISE_ANTHROPIC_WORKSPACE_ID ?? data.ANTHROPIC_WORKSPACE_ID,
    };
  }
  return cached;
}

/** Test helper: forget the cached env so a test can change process.env first. */
export function resetEnvCache(): void {
  cached = undefined;
}

/** Names (never values) of variables that are set, for a safe boot summary. */
export function envSummary(): Record<string, boolean> {
  const env = getEnv();
  return {
    ANTHROPIC_API_KEY: Boolean(env.ANTHROPIC_API_KEY),
    ANTHROPIC_WORKSPACE_ID: Boolean(env.ANTHROPIC_WORKSPACE_ID),
    AWS_REGION: Boolean(env.AWS_REGION),
    BEDROCK_MODEL_ID: Boolean(env.BEDROCK_MODEL_ID),
    BEDROCK_BASE_URL: Boolean(env.BEDROCK_BASE_URL),
    DEMO_PIN: Boolean(env.DEMO_PIN),
    SDK_BASE_URL_OVERRIDES_PRESENT: Boolean(
      env.ANTHROPIC_BASE_URL || env.ANTHROPIC_BEDROCK_BASE_URL || env.ANTHROPIC_BEDROCK_MANTLE_BASE_URL,
    ),
  };
}

/**
 * Variables the provider SDKs read on their own (PLAN.md §4.1, docs/AI-GATEWAY.md §8). The adapters neutralise them
 * with explicit options (baseURL, apiKey, authToken: null, logLevel, awsRegion) — except ANTHROPIC_CUSTOM_HEADERS,
 * which the Anthropic SDK merges into its default headers. instrumentation.ts logs these NAMES at boot (never values)
 * so the host shown, checked and audited is always where traffic goes. Presence only: no value is read into memory.
 */
const SDK_ENV_NAMES = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_BEDROCK_MANTLE_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_CUSTOM_HEADERS",
  "ANTHROPIC_LOG",
  "ANTHROPIC_PROFILE",
] as const;

export function sdkEnvOverridesPresent(): string[] {
  return SDK_ENV_NAMES.filter((name) => {
    const v = process.env[name];
    return typeof v === "string" && v.trim() !== "";
  });
}
