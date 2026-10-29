/**
 * Provider health cache (docs/AI-GATEWAY.md §8): TTL 15 s for a ready probe, 5 s otherwise, kept per process on
 * globalThis. Probes never send shop data (Ollama: /api/version + /api/show; Anthropic deep: models.retrieve).
 */
import type { HealthSource, LLMProvider, ProviderDescriptor, ProviderHealth, ProviderKind } from "./types";

export const HEALTH_TTL_READY_MS = 15_000;
export const HEALTH_TTL_OTHER_MS = 5_000;

interface Entry {
  health: ProviderHealth;
  at: number;
}

export function createHealthSource(
  provider: (d: ProviderDescriptor) => LLMProvider,
  descriptorFor: (kind: ProviderKind) => ProviderDescriptor | null,
  nowMs: () => number,
  store: Map<ProviderKind, Entry> = new Map(),
): HealthSource & { fresh(kind: ProviderKind): boolean } {
  const fresh = (kind: ProviderKind) => {
    const e = store.get(kind);
    if (!e) return false;
    const ttl = e.health.status === "ready" ? HEALTH_TTL_READY_MS : HEALTH_TTL_OTHER_MS;
    return nowMs() - e.at < ttl;
  };
  return {
    get: (kind) => store.get(kind)?.health ?? null,
    fresh,
    async refresh(kind, deep = false) {
      const d = descriptorFor(kind);
      if (!d) throw new Error("No descriptor for this provider kind.");
      let h: ProviderHealth;
      try {
        h = await provider(d).health(deep);
      } catch {
        h = {
          kind,
          targetClass: d.targetClass,
          host: d.host,
          model: d.model,
          status: "unreachable",
          verified: "live-probe",
          checkedAt: null,
          deep,
          problems: ["The health probe failed"],
        };
      }
      store.set(kind, { health: h, at: nowMs() });
      return h;
    },
  };
}

const slot = globalThis as typeof globalThis & { __floorwiseHealth?: Map<ProviderKind, Entry> };

/** The per-process store the app's gateway uses (survives dev HMR). */
export function processHealthStore(): Map<ProviderKind, Entry> {
  return (slot.__floorwiseHealth ??= new Map());
}
