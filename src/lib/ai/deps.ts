/**
 * Production gateway dependencies (docs/AI-GATEWAY.md §10.3). The ONLY file in src/lib/ai that reads the real clock or
 * makes random IDs (audit/event timestamps and request IDs; tests inject their own).
 */
import { randomUUID } from "node:crypto";
import { getDb } from "@/db/client";
import { getEnv } from "@/lib/env";
import { processHealthStore } from "./health";
import { defaultProviderFactory } from "./providers/factory";
import { createTransportResolver } from "./replay/lookup";
import { fsCassetteStore } from "./replay/store";
import type { GatewayDeps } from "./types";

/** Abortable sleep (replay pacing). */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function defaultGatewayDeps(overrides: Partial<GatewayDeps> = {}): GatewayDeps {
  return {
    db: getDb(),
    env: getEnv(),
    now: () => new Date(),
    newRequestId: () => `req_${randomUUID()}`,
    providers: defaultProviderFactory,
    healthStore: processHealthStore(),
    transports: createTransportResolver(fsCassetteStore()),
    sleep: abortableSleep,
    ...overrides,
  };
}
