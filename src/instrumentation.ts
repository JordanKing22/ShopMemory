/**
 * Next.js instrumentation: the boot log only (PLAN.md §4.10). Deliberately no exporters and no onRequestError hook —
 * telemetry is egress (CLAUDE.md hard rule 2).
 */
import { nextRuntime } from "@/lib/env";

export async function register(): Promise<void> {
  if (nextRuntime() !== "nodejs") return;
  const { logBoot } = await import("@/lib/boot");
  logBoot();
}
