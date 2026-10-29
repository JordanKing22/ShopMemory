/** Test helpers: recording fetch stubs and canned Anthropic SSE / Ollama NDJSON streams. No network is ever used. */

export interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  redirect?: RequestRedirect;
}

export type Handler = (req: Recorded) => Response | Promise<Response>;

export function recordingFetch(handler: Handler): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const f = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).forEach((v, k) => (headers[k] = v));
    let body: unknown = init?.body ?? null;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        // keep the raw string
      }
    }
    const rec: Recorded = { url, method: init?.method ?? "GET", headers, body, redirect: init?.redirect };
    calls.push(rec);
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    return handler(rec);
  };
  return { fetch: f as typeof fetch, calls };
}

export function sse(events: { type: string; [k: string]: unknown }[]): Response {
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A complete Messages API stream with the given text chunks and stop reason. */
export function messageStream(chunks: string[], opts: { stopReason?: string; model?: string; stopDetails?: unknown } = {}): Response {
  return sse([
    {
      type: "message_start",
      message: {
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: opts.model ?? "claude-sonnet-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 1 },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ...chunks.map((text) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })),
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: opts.stopReason ?? "end_turn", stop_sequence: null, ...(opts.stopDetails ? { stop_details: opts.stopDetails } : {}) },
      usage: { output_tokens: 7 },
    },
    { type: "message_stop" },
  ]);
}

export function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

export function ndjson(lines: unknown[]): Response {
  return new Response(lines.map((l) => JSON.stringify(l)).join("\n") + "\n", { status: 200, headers: { "content-type": "application/x-ndjson" } });
}
