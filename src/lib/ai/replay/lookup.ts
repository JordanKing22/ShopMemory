/**
 * Transport selection for R2 (PLAN.md §11.1, docs/AI-GATEWAY.md §11). Synchronous and egress-free, so it runs before
 * the audit write-ahead (R1) and the row records which transport served the call.
 *
 *   1. live mode, or Ollama with DEMO_LIVE_LOCAL → the live adapter (or one that fails provider_unavailable)
 *   2. exact key (task, targetClass, promptVersion, payloadHash)                    → demo_replay_exact
 *   3. Bedrock with no own entry → the same key recorded for the Anthropic API (exact only, labelled)
 *      Cloud and local entries never stand in for each other.
 *   4. scenario (never for card extraction): same task + target class, scenario hint, turn index, Jaccard ≥ 0.6 on the
 *      tokenized question, and EVERY cited source fingerprint was sent                → demo_replay_scenario
 *   5. miss → DEMO_MISS=live with a live-capable provider → live; else the task's offline fallback → demo_fallback
 */
import { SCENARIO_REPLAY_FORBIDDEN, type CassetteStore, type ResolvedTransport, type TransportContext, type TransportLookup, type TransportResolver } from "../types";
import { SCENARIO_JACCARD_MIN, jaccard } from "./similarity";
import { fallbackTransport, liveTransport, replayTransport } from "./transport";

export function createTransportResolver(store: CassetteStore): TransportResolver {
  return {
    resolve(lookup: TransportLookup, ctx: TransportContext): ResolvedTransport {
      const isOllama = lookup.descriptor.kind === "ollama";
      if (!ctx.policy.demoMode || (isOllama && ctx.policy.demoLiveLocal)) return liveTransport(ctx.live);

      const files = store.files();
      const configured = lookup.descriptor.model;
      const recordedOn = (model: string | null | undefined) => (model && model !== configured ? model : null);

      const exactIn = (targetClass: string) => {
        for (const f of files) {
          if (f.task !== lookup.task || f.targetClass !== targetClass || f.promptVersion !== lookup.promptVersion) continue;
          const e = f.entries.find((x) => x.payloadHash === lookup.payloadHash);
          if (e) return { f, e };
        }
        return null;
      };

      const exact = exactIn(lookup.targetClass);
      if (exact) return replayTransport(exact.f, exact.e, lookup, ctx, "demo_replay_exact", recordedOn(exact.f.recordedOn?.model));

      if (lookup.descriptor.kind === "bedrock") {
        const viaAnthropic = exactIn("anthropic");
        if (viaAnthropic) {
          return replayTransport(
            viaAnthropic.f,
            viaAnthropic.e,
            lookup,
            ctx,
            "demo_replay_exact",
            viaAnthropic.f.recordedOn?.model ?? "the Anthropic API (scripted)",
          );
        }
      }

      if (lookup.scenario && !SCENARIO_REPLAY_FORBIDDEN.has(lookup.task)) {
        const sc = lookup.scenario;
        const sent = new Set(lookup.sentFingerprints);
        for (const f of files) {
          if (f.task !== lookup.task || f.targetClass !== lookup.targetClass) continue;
          for (const e of f.entries) {
            if (e.scenario !== sc.hint) continue;
            if (e.turnIndex !== null && sc.turnIndex !== undefined && e.turnIndex !== sc.turnIndex) continue;
            if (e.question !== null && (sc.question === undefined || jaccard(e.question, sc.question) < SCENARIO_JACCARD_MIN)) continue;
            if (!e.sources.every((s) => sent.has(s.fingerprint))) continue;
            return replayTransport(f, e, lookup, ctx, "demo_replay_scenario", recordedOn(f.recordedOn?.model));
          }
        }
      }

      if (ctx.policy.demoMiss === "live" && ctx.live) return liveTransport(ctx.live);
      return fallbackTransport(ctx.fallback(), ctx);
    },
  };
}
