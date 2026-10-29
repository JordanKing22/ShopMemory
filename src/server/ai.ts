import "server-only";
/**
 * The app's handle on the AI gateway (CLAUDE.md hard rule 1): one createGateway(defaultGatewayDeps()) per process on
 * globalThis. Route handlers and pages import from here; scripts and tests call createGateway directly.
 */
import { createGateway, type Gateway } from "@/lib/ai/gateway";
import { defaultGatewayDeps } from "@/lib/ai/deps";
import type { AIPreview, AIRequest, AIRun, HealthReport, ProviderHealth, RunOptions } from "@/lib/ai/types";

const slot = globalThis as typeof globalThis & { __floorwiseGateway?: Gateway };

function gateway(): Gateway {
  return (slot.__floorwiseGateway ??= createGateway(defaultGatewayDeps()));
}

export function runAI(req: AIRequest, opts: { dryRun: true }): Promise<AIPreview>;
export function runAI(req: AIRequest, opts?: RunOptions): AIRun;
export function runAI(req: AIRequest, opts?: RunOptions | { dryRun: true }): Promise<AIPreview> | AIRun {
  if (opts && "dryRun" in opts) return gateway().runAI(req, { dryRun: true });
  return gateway().runAI(req, opts as RunOptions | undefined);
}

export function getHealthReport(deep: boolean): Promise<HealthReport> {
  return gateway().healthReport(deep);
}

export function warmLocalModel(): Promise<ProviderHealth | null> {
  return gateway().warm();
}

export function getAiRouting(): ReturnType<Gateway["routing"]> {
  return gateway().routing();
}
