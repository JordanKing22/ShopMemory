import "server-only";
import { connection } from "next/server";
import { can } from "@/lib/auth/roles";
import { getEnv, sdkEnvOverridesPresent } from "@/lib/env";
import { GOVCLOUD_CHECK_LABEL } from "@/lib/policy/matrix";
import {
  routingOptionAvailability,
  routingTargetFor,
  type ProviderKind,
  type RoutingOptions,
  type RoutingSummary,
} from "@/lib/policy/summary";
import type { EffectiveRouting } from "@/lib/policy/types";
import { getAiRouting } from "@/server/ai";
import { requireActor } from "@/server/actor";

export interface ProviderDetailVM {
  kind: ProviderKind;
  label: string;
  configured: boolean;
  model: string;
  host: string;
  region: string | null;
  crossRegion: string | null;
  fips: boolean | null;
  endpointMode: string | null;
  govCloud: { qualified: boolean; failed: string[] } | null;
  coveredModel: boolean;
  /** Presence only, never the value. */
  keyPresent: boolean | null;
  workspaceIdSet: boolean | null;
  locality: string | null;
  isLoopback: boolean;
  problems: string[];
}

export interface SettingsVM {
  canChange: boolean;
  canTest: boolean;
  effective: EffectiveRouting;
  summary: RoutingSummary;
  options: RoutingOptions;
  providers: ProviderDetailVM[];
  demo: { demoMode: boolean; demoMiss: string; replaySpeed: string; demoLiveLocal: boolean };
  publicBaseUrl: string;
  sdkEnvOverrides: string[];
}

/** /settings (PLAN.md §4.11, §9): routing, provider details (no secrets: presence only), demo settings. */
export async function getSettingsPage(): Promise<SettingsVM> {
  await connection();
  const actor = await requireActor();
  const env = getEnv();
  const { effective, summary } = getAiRouting();
  const open = { demoOpenControls: env.DEMO_OPEN_CONTROLS };
  const providers = (["anthropic", "bedrock", "ollama"] as const).map((kind): ProviderDetailVM => {
    const b = routingTargetFor(kind, env);
    const t = b.target;
    return {
      kind,
      label: t.providerLabel,
      configured: t.configured,
      model: t.model,
      host: t.host,
      region: t.region ?? null,
      crossRegion: t.crossRegion ?? null,
      fips: t.fips ?? null,
      endpointMode: t.endpointMode ?? null,
      govCloud: t.govCloud ? { qualified: t.govCloud.qualified, failed: t.govCloud.failed.map((c) => GOVCLOUD_CHECK_LABEL[c]) } : null,
      coveredModel: t.coveredModel,
      keyPresent: kind === "anthropic" ? Boolean(env.ANTHROPIC_API_KEY) : null,
      workspaceIdSet: kind === "anthropic" ? Boolean(env.ANTHROPIC_WORKSPACE_ID) : null,
      locality: t.locality ?? null,
      isLoopback: t.isLoopback,
      problems: b.problems,
    };
  });
  return {
    canChange: can(actor.role, "changeAiRouting", open),
    canTest: can(actor.role, "testAiConnection", open),
    effective,
    summary,
    options: routingOptionAvailability(env),
    providers,
    demo: { demoMode: env.DEMO_MODE, demoMiss: env.DEMO_MISS, replaySpeed: env.DEMO_REPLAY_SPEED, demoLiveLocal: env.DEMO_LIVE_LOCAL },
    publicBaseUrl: env.PUBLIC_BASE_URL,
    sdkEnvOverrides: sdkEnvOverridesPresent(),
  };
}
