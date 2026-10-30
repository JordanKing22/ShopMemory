/**
 * Reads the NDJSON stream of POST /api/ai/[task] in the browser (docs/AI-GATEWAY.md §14), calling `onEvent` per line.
 * A pre-stream failure (non-200) still carries one `error` line. Never logs anything.
 */
import type { AIStreamEvent } from "@/lib/ai/types";

export async function readAiStream(res: Response, onEvent: (ev: AIStreamEvent) => void, signal?: AbortSignal): Promise<void> {
  if (!res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    if (signal?.aborted) {
      await reader.cancel();
      return;
    }
    const { value, done } = await reader.read();
    if (value) buf += value;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line) as AIStreamEvent);
      } catch {
        onEvent({ t: "error", code: "internal", message: "Something went wrong." });
      }
    }
    if (done) return;
  }
}

/** The visible replay label for a routed badge (CLAUDE.md hard rule 10). */
export function replayLabelOf(replay: "none" | "replay" | "scripted" | "fallback"): string | null {
  if (replay === "replay") return "REPLAY";
  if (replay === "scripted") return "REPLAY · scripted (not model output)";
  if (replay === "fallback") return "Offline fallback · scripted (not model output)";
  return null;
}
