/**
 * Ollama adapter (PLAN.md §4.1): native POST /api/chat with plain fetch and NDJSON parsing — never the
 * OpenAI-compatible /v1 (it can't set num_ctx per request).
 *
 * - Always think:false, keep_alive "60m" and the SAME options object on every call (chat and warm-up): changing
 *   options forces a model reload.
 * - redirect:"error"; a request timeout via AbortSignal.timeout combined with the caller's signal.
 * - Refuses a descriptor that isn't local-qualified, and a model whose /api/show reports a non-empty remote_host
 *   (an Ollama "cloud" model): those calls fail with model_not_allowed. Never a cloud fallback.
 * - JSON tasks send `format` = the task's JSON schema; the gateway still validates with zod.
 * No prompt or response text is ever logged; only timings and counts are kept.
 */
import { AIError, aiErrorFromStatus } from "@/lib/ai/errors";
import type {
  CallOptions,
  LLMProvider,
  ProviderCaps,
  ProviderDescriptor,
  ProviderHealth,
  ProviderRequest,
  ProviderResponse,
  ProviderStopReason,
  ProviderStreamEvent,
} from "@/lib/ai/types";
import { hostOf } from "@/lib/ai/endpoints";
import type { Env } from "@/lib/env";
import { mapProviderError } from "./errors";
import { assertSendable, drain } from "./messages-api";

export const OLLAMA_MIN_VERSION = "0.34.4";
export const OLLAMA_NUM_PREDICT_CAP = 1536;
export const OLLAMA_KEEP_ALIVE = "60m";
const PROBE_TIMEOUT_MS = 2000;

export interface OllamaOptions {
  num_ctx: number;
  temperature: 0;
  num_predict: number;
}

/** Built once per env and identical on every call (chat and warm-up). */
export function ollamaOptions(env: Pick<Env, "OLLAMA_NUM_CTX">): OllamaOptions {
  return Object.freeze({ num_ctx: env.OLLAMA_NUM_CTX, temperature: 0 as const, num_predict: OLLAMA_NUM_PREDICT_CAP });
}

export interface OllamaDeps {
  fetch?: typeof fetch;
  now?: () => Date;
}

/** "0.34.4" ≥ "0.34.10"? Numeric dot-wise comparison; pre-release suffixes ignored. */
export function versionAtLeast(version: string, min: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(/[.-]/).slice(0, 3).map((x) => Number.parseInt(x, 10) || 0);
  const a = parse(version);
  const b = parse(min);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

interface ShowInfo {
  found: boolean;
  remoteHostEmpty: boolean;
  contextLength: number | null;
}

export function createOllamaProvider(descriptor: ProviderDescriptor, env: Env, deps: OllamaDeps = {}): LLMProvider {
  const doFetch = deps.fetch ?? fetch;
  const options = ollamaOptions(env);
  const caps: ProviderCaps = { nativeJsonSchema: true, supportsEffort: false, maxContextTokens: env.OLLAMA_NUM_CTX };
  /** /api/show result for the configured model, cached once a probe succeeds. */
  let show: ShowInfo | null = null;

  const url = (path: string) => `${descriptor.baseUrl.replace(/\/+$/, "")}${path}`;

  function assertLocal(): void {
    if (descriptor.locality === "not_local" || !descriptor.baseUrl || hostOf(descriptor.baseUrl) !== descriptor.host) {
      throw new AIError("provider_unavailable");
    }
  }

  async function request(path: string, init: { method: "GET" | "POST"; body?: unknown }, signal: AbortSignal): Promise<Response> {
    const res = await doFetch(url(path), {
      method: init.method,
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: "error",
      signal,
    });
    return res;
  }

  async function probeShow(signal: AbortSignal): Promise<ShowInfo> {
    const res = await request("/api/show", { method: "POST", body: { model: descriptor.model } }, signal);
    if (res.status === 404) {
      await res.body?.cancel();
      return { found: false, remoteHostEmpty: true, contextLength: null };
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new AIError(aiErrorFromStatus(res.status));
    }
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      throw new AIError("provider_error"); // the parse error's message is discarded (it can echo input)
    }
    const remote = body.remote_host;
    const info = (body.model_info ?? {}) as Record<string, unknown>;
    const ctxKey = Object.keys(info).find((k) => k.endsWith(".context_length"));
    const ctx = ctxKey ? Number(info[ctxKey]) : NaN;
    return {
      found: true,
      remoteHostEmpty: remote === undefined || remote === null || remote === "",
      contextLength: Number.isFinite(ctx) ? ctx : null,
    };
  }

  /** Before the first call: the model must exist locally and must not be a remote ("cloud") model. */
  async function ensureModelAllowed(signal: AbortSignal): Promise<void> {
    if (show && show.found && show.remoteHostEmpty) return;
    const s = await probeShow(AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS * 5)]));
    if (!s.found) throw new AIError("provider_unavailable");
    if (!s.remoteHostEmpty) throw new AIError("model_not_allowed");
    show = s;
  }

  async function* stream(req: ProviderRequest, o: CallOptions): AsyncGenerator<ProviderStreamEvent> {
    assertLocal();
    assertSendable(req);
    const signal = AbortSignal.any([...(o.signal ? [o.signal] : []), AbortSignal.timeout(o.timeoutMs)]);
    const started = performance.now();
    let ttft: number | null = null;
    try {
      await ensureModelAllowed(signal);
      const body: Record<string, unknown> = {
        model: descriptor.model,
        messages: [{ role: "system", content: req.system }, ...req.messages.map((m) => ({ role: m.role, content: m.content }))],
        stream: true,
        think: false,
        keep_alive: OLLAMA_KEEP_ALIVE,
        options,
      };
      if (req.output.kind === "json") body.format = req.output.jsonSchema;
      const res = await request("/api/chat", { method: "POST", body }, signal);
      if (!res.ok || !res.body) {
        await res.body?.cancel();
        throw new AIError(aiErrorFromStatus(res.status));
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      let text = "";
      let final: Record<string, unknown> | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (value) buf += value;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let obj: Record<string, unknown>;
          try {
            obj = JSON.parse(line) as Record<string, unknown>;
          } catch {
            throw new AIError("provider_error");
          }
          if (typeof obj.error === "string") throw new AIError("provider_error");
          const piece = (obj.message as { content?: unknown } | undefined)?.content;
          if (typeof piece === "string" && piece.length > 0) {
            if (ttft === null) ttft = performance.now() - started;
            text += piece;
            yield { type: "text", text: piece };
          }
          if (obj.done === true) final = obj;
        }
        if (done) break;
      }
      if (!final) throw new AIError("provider_error");
      const reason = typeof final.done_reason === "string" ? final.done_reason : null;
      const stopReason: ProviderStopReason = reason === "stop" ? "end_turn" : reason === "length" ? "max_tokens" : "other";
      const ns = (v: unknown) => (typeof v === "number" ? Math.round(v / 1e6) : null);
      const response: ProviderResponse = {
        text,
        stopReason,
        rawStopReason: reason,
        servedModel: typeof final.model === "string" ? final.model : descriptor.model,
        usage: {
          inputTokens: typeof final.prompt_eval_count === "number" ? final.prompt_eval_count : null,
          outputTokens: typeof final.eval_count === "number" ? final.eval_count : null,
        },
        timings: {
          latencyMs: performance.now() - started,
          ttftMs: ttft,
          loadDurationMs: ns(final.load_duration),
          evalCount: typeof final.eval_count === "number" ? final.eval_count : null,
        },
      };
      yield { type: "done", response };
    } catch (err) {
      throw mapProviderError(err, signal);
    }
  }

  function baseHealth(deep: boolean): ProviderHealth {
    return {
      kind: "ollama",
      targetClass: "ollama_local",
      host: descriptor.host,
      model: descriptor.model,
      status: "not_checked",
      verified: "live-probe",
      checkedAt: null,
      deep,
      problems: [],
      ollama: { version: null, versionOk: null, modelPulled: null, remoteHostEmpty: null, contextLength: null, warm: null, gpuShare: null },
    };
  }

  async function health(deep = false): Promise<ProviderHealth> {
    const h = baseHealth(deep);
    h.checkedAt = (deps.now ?? (() => new Date()))().toISOString();
    if (descriptor.locality === "not_local" || !descriptor.baseUrl) {
      return { ...h, status: "misconfigured", problems: ["OLLAMA_BASE_URL is not this computer or an allowlisted on-prem host"] };
    }
    try {
      const v = await request("/api/version", { method: "GET" }, AbortSignal.timeout(PROBE_TIMEOUT_MS));
      if (!v.ok) {
        await v.body?.cancel();
        return { ...h, status: "unreachable", problems: ["Ollama didn't answer /api/version"] };
      }
      const version = String(((await v.json()) as { version?: unknown }).version ?? "");
      h.ollama!.version = version || null;
      h.ollama!.versionOk = version ? versionAtLeast(version, OLLAMA_MIN_VERSION) : null;
      if (h.ollama!.versionOk === false) h.problems.push(`Ollama ${OLLAMA_MIN_VERSION} or later is recommended`);
      // Availability needs the model check (remote_host), so even the basic probe asks /api/show.
      const s = await probeShow(AbortSignal.timeout(PROBE_TIMEOUT_MS));
      h.ollama!.modelPulled = s.found;
      h.ollama!.remoteHostEmpty = s.found ? s.remoteHostEmpty : null;
      h.ollama!.contextLength = s.contextLength;
      if (!s.found) return { ...h, status: "model_missing", problems: [...h.problems, "OLLAMA_MODEL isn't pulled on this Ollama"] };
      if (!s.remoteHostEmpty) {
        show = null;
        return { ...h, status: "model_not_allowed", problems: [...h.problems, "OLLAMA_MODEL is a remote (cloud) model; only local models are allowed"] };
      }
      show = s;
      if (deep) {
        try {
          const ps = await request("/api/ps", { method: "GET" }, AbortSignal.timeout(PROBE_TIMEOUT_MS));
          const models = ((await ps.json()) as { models?: { name?: string; model?: string; size?: number; size_vram?: number }[] }).models ?? [];
          const m = models.find((x) => x.name === descriptor.model || x.model === descriptor.model);
          h.ollama!.warm = Boolean(m);
          h.ollama!.gpuShare = m && m.size ? Math.round(((m.size_vram ?? 0) / m.size) * 100) / 100 : null;
        } catch {
          h.ollama!.warm = null;
        }
      }
      return { ...h, status: "ready" };
    } catch {
      return { ...h, status: "unreachable", problems: ["Ollama isn't responding"] };
    }
  }

  async function warm(o: CallOptions): Promise<ProviderHealth> {
    assertLocal();
    const signal = AbortSignal.any([...(o.signal ? [o.signal] : []), AbortSignal.timeout(o.timeoutMs)]);
    try {
      await ensureModelAllowed(signal);
      const res = await request(
        "/api/chat",
        { method: "POST", body: { model: descriptor.model, messages: [], stream: false, think: false, keep_alive: OLLAMA_KEEP_ALIVE, options } },
        signal,
      );
      await res.body?.cancel();
      if (!res.ok) throw new AIError(aiErrorFromStatus(res.status));
    } catch (err) {
      const e = mapProviderError(err, signal);
      const h = baseHealth(true);
      return { ...h, status: e.code === "model_not_allowed" ? "model_not_allowed" : "unreachable", problems: ["Warm-up failed"] };
    }
    return health(true);
  }

  return { descriptor, caps, stream, complete: (req, o) => drain(stream(req, o)), health, warm };
}
