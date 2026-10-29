/**
 * Replay key (PLAN.md §11.1) = (task, targetClass, promptVersion, payloadHash). Host and model are deliberately NOT
 * part of it (they are cassette and audit metadata), so a different OLLAMA_MODEL or base URL doesn't break the demo.
 */
import type { ReplayKeyInput } from "../types";

export function replayKey(k: ReplayKeyInput): string {
  return `${k.task}|${k.targetClass}|${k.promptVersion}|${k.payloadHash}`;
}
