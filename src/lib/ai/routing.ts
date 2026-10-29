/**
 * Gateway routing inputs (docs/AI-GATEWAY.md §10.3). Reads the in-app setting and builds the policy targets with
 * their availability. The decisions themselves (precedence, matrix, decide) live in src/lib/policy/ (CLAUDE.md hard
 * rule 5); this module only wires configuration + health into them.
 *
 * Availability (contract §8): DEMO_MODE (and not live local for Ollama) → configuration only ("config-only-demo",
 * ReplayTransport serves the call). Live mode: Anthropic / Bedrock → configured ("config-only", the call is the
 * probe); Ollama → configured AND the cached probe says ready ("live-probe"). Unavailable targets are never
 * substituted: decide() blocks instead.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { appSettings } from "@/db/schema";
import type { Env } from "@/lib/env";
import { parseAiRoutingSetting, routingTargetFor } from "@/lib/policy/summary";
import { AI_ROUTING_SETTING_KEY, type AiRoutingSetting, type EffectiveRouting, type PolicyTarget, type PolicyTargets } from "@/lib/policy/types";
import { descriptorFor } from "./descriptor";
import type { ProviderDescriptor, ProviderHealth, ProviderKind, TransportPolicy } from "./types";

export function readAiRoutingSetting(db: Db): AiRoutingSetting | null {
  const row = db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, AI_ROUTING_SETTING_KEY)).get();
  return row ? parseAiRoutingSetting(row.value) : null;
}

export function readDemoEpoch(db: Db): number {
  const row = db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, "demo.epoch")).get();
  return typeof row?.value === "number" ? row.value : 0;
}

export function transportPolicyOf(env: Env, override?: Partial<TransportPolicy>): TransportPolicy {
  return {
    demoMode: env.DEMO_MODE,
    demoMiss: env.DEMO_MISS,
    demoLiveLocal: env.DEMO_LIVE_LOCAL,
    replaySpeed: env.DEMO_REPLAY_SPEED,
    ...override,
  };
}

/** Does this provider kind need a live probe under the policy (live mode, or Ollama with DEMO_LIVE_LOCAL)? */
export function usesLiveProbe(kind: ProviderKind, policy: TransportPolicy): boolean {
  return kind === "ollama" && (!policy.demoMode || policy.demoLiveLocal);
}

/** Which provider kinds the effective mode uses. */
export function kindsForMode(env: Env, effective: EffectiveRouting): ProviderKind[] {
  if (effective.mode === "local") return ["ollama"];
  if (effective.mode === "cloud") return [effective.cloudProvider];
  const kinds: ProviderKind[] = [effective.cloudProvider, "ollama"];
  if (env.HYBRID_EC_TARGET === "govcloud" && !kinds.includes("bedrock")) kinds.push("bedrock");
  return kinds;
}

export interface ResolvedTargets {
  targets: PolicyTargets;
  descriptors: Partial<Record<ProviderKind, ProviderDescriptor>>;
}

export function policyTargetFor(
  kind: ProviderKind,
  env: Env,
  policy: TransportPolicy,
  health: (kind: ProviderKind) => ProviderHealth | null,
): PolicyTarget {
  // The routing summary reads DEMO_MODE to decide whether a key-less Anthropic target is "configured"; the transport
  // policy (demo:record forces live) is what counts here.
  const built = routingTargetFor(kind, { ...env, DEMO_MODE: policy.demoMode });
  const t = built.target;
  if (!usesLiveProbe(kind, policy)) {
    const verified = policy.demoMode ? "config-only-demo" : "config-only";
    return {
      descriptor: descriptorFor(t, { available: t.configured, verified, unavailableReason: built.problems[0] }),
      opts: built.opts,
    };
  }
  const h = health(kind);
  const ready = h?.status === "ready";
  const reason = !t.configured ? built.problems[0] : ready ? undefined : `Ollama at ${t.host || "the configured host"} isn't ready`;
  return { descriptor: descriptorFor(t, { available: t.configured && ready, verified: "live-probe", unavailableReason: reason }), opts: built.opts };
}

export function resolveTargets(
  env: Env,
  effective: EffectiveRouting,
  policy: TransportPolicy,
  health: (kind: ProviderKind) => ProviderHealth | null,
): ResolvedTargets {
  const make = (k: ProviderKind) => policyTargetFor(k, env, policy, health);
  const descriptors: Partial<Record<ProviderKind, ProviderDescriptor>> = {};
  const keep = (t: PolicyTarget) => {
    descriptors[t.descriptor.kind] = t.descriptor;
    return t;
  };
  if (effective.mode === "local") return { targets: { cloud: null, local: keep(make("ollama")), ecTarget: null }, descriptors };
  const cloud = keep(make(effective.cloudProvider));
  if (effective.mode === "cloud") return { targets: { cloud, local: null, ecTarget: null }, descriptors };
  const local = keep(make("ollama"));
  let ecTarget: PolicyTarget = local;
  if (env.HYBRID_EC_TARGET === "govcloud") {
    const b = cloud.descriptor.kind === "bedrock" ? cloud : keep(make("bedrock"));
    // Only a GovCloud-qualified endpoint may be the EC target; anything else can't be cleared for export_controlled.
    ecTarget = b.descriptor.targetClass === "bedrock_govcloud" ? b : { ...b, descriptor: { ...b.descriptor, available: false } };
  }
  return { targets: { cloud, local, ecTarget }, descriptors };
}

/** Can this target REALLY be called (credentials configured / Ollama probed ready)? Used for DEMO_MISS=live. */
export function liveCapable(d: ProviderDescriptor, env: Env, health: (kind: ProviderKind) => ProviderHealth | null): boolean {
  if (d.kind === "anthropic") return Boolean(env.ANTHROPIC_API_KEY) && Boolean(d.baseUrl);
  if (d.kind === "bedrock") return Boolean(d.region && d.model && d.baseUrl);
  return d.locality !== "not_local" && health("ollama")?.status === "ready";
}
