/**
 * SDK / fetch errors → AIError (docs/AI-GATEWAY.md §8). Never reads err.message, err.error, response bodies or
 * headers: only the error CLASS and the HTTP status decide the code, so nothing provider-written can reach a log,
 * an AIError or the audit.
 */
import Anthropic from "@anthropic-ai/sdk";
import { AIError, aiErrorFromStatus } from "@/lib/ai/errors";

export function mapProviderError(err: unknown, signal?: AbortSignal): AIError {
  if (err instanceof AIError) return err;
  if (signal?.aborted) {
    const reason = signal.reason as { name?: unknown } | undefined;
    return new AIError(reason && reason.name === "TimeoutError" ? "provider_timeout" : "aborted");
  }
  if (err instanceof Anthropic.APIUserAbortError) return new AIError("aborted");
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AIError("provider_timeout");
  if (err instanceof Anthropic.APIConnectionError) return new AIError("provider_connection");
  if (err instanceof Anthropic.APIError) return new AIError(aiErrorFromStatus(typeof err.status === "number" ? err.status : undefined));
  const name = err && typeof err === "object" ? (err as { name?: unknown }).name : undefined;
  if (name === "AbortError") return new AIError("aborted");
  if (name === "TimeoutError") return new AIError("provider_timeout");
  if (err instanceof TypeError) return new AIError("provider_connection"); // fetch network failure
  return new AIError("provider_error");
}
