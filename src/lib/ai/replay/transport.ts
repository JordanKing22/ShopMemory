/**
 * ReplayTransport (PLAN.md §11.1): receives the identical ProviderRequest + descriptor a live adapter would, and streams
 * a cassette entry. Cloud replays stream the TOKENIZED text (the gateway's restorer does the work, exactly as live);
 * local replays stream ctx.detokenize(text), emulating what a live Ollama returns. Deterministic chunks of 12 code
 * points; latency per DEMO_REPLAY_SPEED, capped (structured ≤ 2 s, local ≤ 8 s) regardless of recorded timings.
 * Also the offline-fallback and live wrappers, so R2 always calls one ResolvedTransport.
 */
import { AIError } from "../errors";
import type {
  CallOptions,
  CassetteEntry,
  CassetteFile,
  LLMProvider,
  OfflineFallback,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamEvent,
  ResolvedTransport,
  TransportContext,
  TransportLookup,
  TransportPolicy,
} from "../types";

export const REPLAY_CHUNK = 12;
const STRUCTURED_CAP_MS = 2000;
const LOCAL_CAP_MS = 8000;

export function chunkText(text: string, size = REPLAY_CHUNK): string[] {
  const cps = [...text];
  const out: string[] = [];
  for (let i = 0; i < cps.length; i += size) out.push(cps.slice(i, i + size).join(""));
  return out;
}

/** Planned sleeps: [ttft, perChunk], scaled down to the cap. */
export function replayTiming(
  speed: TransportPolicy["replaySpeed"],
  opts: { isCloud: boolean; structured: boolean; chunks: number; recordedTtftMs: number | null },
): { ttftMs: number; perChunkMs: number } {
  if (speed === "instant") return { ttftMs: 0, perChunkMs: 0 };
  let ttft = speed === "fast" ? 100 : opts.isCloud ? 700 : Math.min(opts.recordedTtftMs ?? 2000, 3000);
  let per = speed === "fast" ? 5 : 25;
  const cap = opts.structured ? STRUCTURED_CAP_MS : opts.isCloud ? Number.POSITIVE_INFINITY : LOCAL_CAP_MS;
  const total = ttft + per * Math.max(0, opts.chunks - 1);
  if (total > cap) {
    const f = cap / total;
    ttft = Math.floor(ttft * f);
    per = Math.floor(per * f);
  }
  return { ttftMs: ttft, perChunkMs: per };
}

async function* streamText(
  text: string,
  timing: { ttftMs: number; perChunkMs: number },
  base: Omit<ProviderResponse, "text" | "timings">,
  ctx: TransportContext,
  o: CallOptions,
): AsyncGenerator<ProviderStreamEvent> {
  const started = performance.now();
  const chunks = chunkText(text);
  let ttft: number | null = null;
  const nap = async (ms: number) => {
    if (o.signal?.aborted) throw new AIError("aborted");
    if (ms > 0) {
      try {
        await ctx.sleep(ms, o.signal);
      } catch {
        throw new AIError("aborted");
      }
    }
    if (o.signal?.aborted) throw new AIError("aborted");
  };
  for (let i = 0; i < chunks.length; i++) {
    await nap(i === 0 ? timing.ttftMs : timing.perChunkMs);
    if (ttft === null) ttft = performance.now() - started;
    yield { type: "text", text: chunks[i] };
  }
  if (chunks.length === 0) await nap(timing.ttftMs);
  yield { type: "done", response: { ...base, text, timings: { latencyMs: performance.now() - started, ttftMs: ttft } } };
}

async function drainStream(events: AsyncIterable<ProviderStreamEvent>): Promise<ProviderResponse> {
  for await (const ev of events) if (ev.type === "done") return ev.response;
  throw new AIError("provider_error");
}

export function replayTransport(
  file: CassetteFile,
  entry: CassetteEntry,
  lookup: TransportLookup,
  ctx: TransportContext,
  kind: "demo_replay_exact" | "demo_replay_scenario",
  recordedOnModel: string | null,
): ResolvedTransport {
  const isCloud = lookup.descriptor.isCloud;
  const text = isCloud ? entry.response.text : ctx.detokenize(entry.response.text);
  const stream = (_req: ProviderRequest, o: CallOptions) =>
    streamText(
      text,
      replayTiming(ctx.policy.replaySpeed, {
        isCloud,
        structured: lookup.structured === true,
        chunks: chunkText(text).length,
        recordedTtftMs: entry.response.ttftMs,
      }),
      {
        stopReason: entry.response.stopReason,
        rawStopReason: entry.response.stopReason,
        servedModel: file.provenance === "recorded" ? (file.recordedOn?.model ?? null) : null,
        usage: entry.response.usage,
      },
      ctx,
      o,
    );
  return {
    transport: kind,
    provenance: file.provenance,
    recordedOnModel,
    cassetteEntry: `${file.id}#${entry.id}`,
    stream,
    complete: (req, o) => drainStream(stream(req, o)),
  };
}

export function fallbackTransport(fallback: OfflineFallback, ctx: TransportContext): ResolvedTransport {
  const stream = (_req: ProviderRequest, o: CallOptions) =>
    streamText(
      fallback.text,
      replayTiming(ctx.policy.replaySpeed === "realistic" ? "fast" : ctx.policy.replaySpeed, { isCloud: true, structured: true, chunks: chunkText(fallback.text).length, recordedTtftMs: null }),
      { stopReason: "end_turn", rawStopReason: null, servedModel: null, usage: { inputTokens: null, outputTokens: null } },
      ctx,
      o,
    );
  return { transport: "demo_fallback", provenance: null, recordedOnModel: null, cassetteEntry: null, stream, complete: (req, o) => drainStream(stream(req, o)) };
}

export function liveTransport(live: LLMProvider | null): ResolvedTransport {
  if (!live) {
    const stream = async function* (): AsyncGenerator<ProviderStreamEvent> {
      throw new AIError("provider_unavailable");
    };
    return { transport: "live", provenance: null, recordedOnModel: null, cassetteEntry: null, stream, complete: async () => Promise.reject(new AIError("provider_unavailable")) };
  }
  return {
    transport: "live",
    provenance: null,
    recordedOnModel: null,
    cassetteEntry: null,
    stream: (req, o) => live.stream(req, o),
    complete: (req, o) => live.complete(req, o),
  };
}
