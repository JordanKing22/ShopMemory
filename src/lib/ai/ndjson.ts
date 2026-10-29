/**
 * NDJSON streaming for POST /api/ai/[task] (docs/AI-GATEWAY.md §14): one JSON object per line. The first event decides
 * the status: an `error` before anything else (a pre-R1 failure) answers with that error's HTTP status and that single
 * line; otherwise 200 and the rest streams. An iterator failure becomes one safe `error` line.
 */
import { AI_ERROR_STATUS } from "./errors";
import type { AIStreamEvent } from "./types";

const HEADERS = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } as const;
const line = (ev: AIStreamEvent) => `${JSON.stringify(ev)}\n`;
const INTERNAL: AIStreamEvent = { t: "error", code: "internal", message: "Something went wrong." };

export async function ndjsonResponse(events: AsyncIterable<AIStreamEvent>): Promise<Response> {
  const it = events[Symbol.asyncIterator]();
  let first: IteratorResult<AIStreamEvent>;
  try {
    first = await it.next();
  } catch {
    return new Response(line(INTERNAL), { status: 500, headers: HEADERS });
  }
  if (first.done) return new Response("", { status: 200, headers: HEADERS });
  if (first.value.t === "error") {
    await it.return?.();
    return new Response(line(first.value), { status: AI_ERROR_STATUS[first.value.code] ?? 500, headers: HEADERS });
  }
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(line(first.value)));
    },
    async pull(controller) {
      try {
        const next = await it.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(line(next.value)));
      } catch {
        controller.enqueue(encoder.encode(line(INTERNAL)));
        controller.close();
      }
    },
    async cancel() {
      await it.return?.(); // client disconnected: closes the run (the audit row finalizes as aborted)
    },
  });
  return new Response(body, { status: 200, headers: HEADERS });
}
