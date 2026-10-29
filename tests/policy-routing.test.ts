import { describe, expect, it } from "vitest";
import {
  getRoutingSummary,
  parseAiRoutingSetting,
  resolveEffectiveRouting,
  routingOptionAvailability,
} from "@/lib/policy/summary";
import { env } from "./fixtures/routing-env";

describe("effective routing precedence (PLAN.md §4.11)", () => {
  it("env when there is no valid setting; the setting when valid; env only when locked", () => {
    expect(resolveEffectiveRouting(env(), null)).toEqual({ mode: "cloud", cloudProvider: "anthropic", source: "env", locked: false });
    expect(resolveEffectiveRouting(env({ LLM_PROVIDER: "ollama" }), null)).toMatchObject({ mode: "local", source: "env" });
    expect(resolveEffectiveRouting(env(), { mode: "local", cloudProvider: "bedrock" })).toEqual({
      mode: "local",
      cloudProvider: "bedrock",
      source: "setting",
      locked: false,
    });
    expect(resolveEffectiveRouting(env({ AI_SETTINGS_LOCKED: true }), { mode: "local", cloudProvider: "anthropic" })).toEqual({
      mode: "cloud",
      cloudProvider: "anthropic",
      source: "locked_env",
      locked: true,
    });
  });

  it("an invalid stored setting is ignored", () => {
    for (const bad of [null, "cloud", { mode: "orbit", cloudProvider: "anthropic" }, { mode: "cloud", cloudProvider: "vertex" }, 3]) {
      expect(parseAiRoutingSetting(bad)).toBeNull();
    }
    expect(resolveEffectiveRouting(env(), parseAiRoutingSetting({ mode: "x" }))).toMatchObject({ source: "env" });
  });
});

describe("routing options for the Settings picker", () => {
  it("DEMO_MODE enables Anthropic without a key; Bedrock needs region and model; locked disables everything", () => {
    const o = routingOptionAvailability(env());
    expect(o.cloudProviders.anthropic).toEqual({ enabled: true });
    expect(o.cloudProviders.bedrock.enabled).toBe(false);
    expect(o.cloudProviders.bedrock.reason).toMatch(/AWS_REGION and BEDROCK_MODEL_ID/);
    expect(o.modes).toMatchObject({ cloud: { enabled: true }, local: { enabled: true }, hybrid: { enabled: true } });

    const live = routingOptionAvailability(env({ DEMO_MODE: false }));
    expect(live.cloudProviders.anthropic.enabled).toBe(false);
    expect(live.modes.cloud.enabled).toBe(false);

    const locked = routingOptionAvailability(env({ AI_SETTINGS_LOCKED: true }));
    expect(Object.values(locked.modes).every((m) => !m.enabled && m.reason?.includes("AI_SETTINGS_LOCKED"))).toBe(true);
  });

  it("reasons name settings, never values", () => {
    const o = routingOptionAvailability(env({ DEMO_MODE: false, ANTHROPIC_API_KEY: undefined, OLLAMA_BASE_URL: "http://10.1.2.3:11434" }));
    expect(JSON.stringify(o)).not.toContain("10.1.2.3");
  });
});

describe("routing summary with effective routing and live health", () => {
  it("uses the in-app setting's mode and cloud provider", () => {
    const routing = resolveEffectiveRouting(env(), { mode: "hybrid", cloudProvider: "anthropic" });
    const s = getRoutingSummary(env(), { routing });
    expect(s.mode).toBe("hybrid");
    expect(s.source).toBe("setting");
    expect(s.routes.export_controlled).toBe("secondary");
  });

  it("an unreachable Ollama clears nothing: Local mode can send nothing, Hybrid can't send export_controlled", () => {
    const local = getRoutingSummary(env(), { routing: resolveEffectiveRouting(env(), { mode: "local", cloudProvider: "anthropic" }), health: { ollama: "unreachable" } });
    expect(Object.values(local.clearance).every((v) => !v)).toBe(true);
    expect(local.primary.health).toBe("unreachable");
    const hybrid = getRoutingSummary(env(), { routing: resolveEffectiveRouting(env(), { mode: "hybrid", cloudProvider: "anthropic" }), health: { ollama: "model_not_allowed" } });
    expect(hybrid.clearance.export_controlled).toBe(false);
    expect(hybrid.clearance.internal).toBe(true);
  });
});
