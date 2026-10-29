/**
 * Boot log (PLAN.md §4.10): which variables are SET (names and booleans only, never values), and the names of SDK
 * variables that are set but overridden by the explicit options every adapter passes. No exporters, no telemetry.
 */
import { envSummary, getEnv, sdkEnvOverridesPresent } from "./env";
import { log } from "./log";

export function logBoot(): void {
  try {
    getEnv();
  } catch (err) {
    // The env error names fields only (env.ts never echoes values).
    log.error("env_invalid", { fields: err instanceof Error ? err.message.replace(/^Invalid environment configuration in: /, "") : "unknown" });
    return;
  }
  const set = Object.entries(envSummary())
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(",");
  const env = getEnv();
  log.info("boot", { demoMode: env.DEMO_MODE, llmProvider: env.LLM_PROVIDER, set });
  const overrides = sdkEnvOverridesPresent();
  if (overrides.length > 0) log.warn("sdk_env_overrides_present", { names: overrides.join(",") });
}
