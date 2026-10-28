/**
 * AIError: the only error type the AI gateway, its adapters and its route handlers let escape (CLAUDE.md hard
 * rule 2, PLAN.md §4.10, docs/AI-GATEWAY.md §9). Every code has a fixed, payload-free safe message and an HTTP status.
 *
 * Rules
 * - Never build an AIError from another error's message, a provider response body, a prompt or user text. The
 *   message is always SAFE_MESSAGES[code]. There is deliberately no `cause` parameter.
 * - Adapters map typed SDK errors to a code (status → code with {@link aiErrorFromStatus}); everything else becomes
 *   `internal` through {@link toAIError}, which never copies a message.
 * - withSafeErrors() (src/server/safe.ts) rethrows AIError unchanged; route handlers turn it into an NDJSON `error`
 *   event or a JSON error body with {@link AIError.status}.
 *
 * Pure: no imports from Next.js, the DB or the SDKs, so scripts, tests and the gateway core can all use it.
 */

export const AI_ERROR_CODES = [
  // Request / pipeline (raised before anything is sent; no audit row unless noted in docs/AI-GATEWAY.md)
  "invalid_request",
  "task_unknown",
  "forbidden",
  "consent_required",
  "consent_target_changed",
  "preview_stale",
  "demo_epoch_changed",
  // Provider (raised by adapters; the audit row is finalized with outcome provider_error / timeout / aborted)
  "provider_unavailable",
  "provider_auth",
  "provider_rate_limited",
  "provider_overloaded",
  "provider_timeout",
  "provider_connection",
  "provider_bad_request",
  "provider_error",
  "model_not_allowed",
  // Output handling
  "refusal",
  "invalid_output",
  "aborted",
  // Anything else
  "internal",
] as const;

export type AIErrorCode = (typeof AI_ERROR_CODES)[number];

/** Fixed, user-facing messages. They name settings and actions, never values, prompts or provider text. */
export const SAFE_MESSAGES: Readonly<Record<AIErrorCode, string>> = {
  invalid_request: "That request couldn't be read. Try again.",
  task_unknown: "That AI feature isn't available in this version of the demo.",
  forbidden: "Your role can't use that AI feature in this demo.",
  consent_required: "This needs the subject's consent before anything is sent to an AI model.",
  consent_target_changed: "The AI destination changed since consent was given. Ask for consent again.",
  preview_stale: "What will be sent has changed (the payload or the destination). Review the preview again.",
  demo_epoch_changed: "The demo was reset while this answer was streaming. Ask again.",
  provider_unavailable: "The AI provider for this mode isn't available. Check Settings.",
  provider_auth: "The AI provider rejected the credentials. Check the API key or AWS credentials in your environment.",
  provider_rate_limited: "The AI provider is rate-limiting requests. Wait a moment and try again.",
  provider_overloaded: "The AI provider is overloaded right now. Try again shortly.",
  provider_timeout: "The AI provider didn't answer in time.",
  provider_connection: "Couldn't reach the AI provider.",
  provider_bad_request: "The AI provider rejected the request.",
  provider_error: "The AI provider returned an error.",
  model_not_allowed: "The configured model isn't allowed here (for example an Ollama cloud model). Check Settings.",
  refusal: "The model declined to answer this request.",
  invalid_output: "The model's answer wasn't in the expected format.",
  aborted: "The request was cancelled.",
  internal: "Something went wrong.",
};

/** HTTP status used when the error is returned before streaming starts (or as the JSON error status). */
export const AI_ERROR_STATUS: Readonly<Record<AIErrorCode, number>> = {
  invalid_request: 400,
  task_unknown: 404,
  forbidden: 403,
  consent_required: 403,
  consent_target_changed: 409,
  preview_stale: 409,
  demo_epoch_changed: 409,
  provider_unavailable: 503,
  provider_auth: 502,
  provider_rate_limited: 503,
  provider_overloaded: 503,
  provider_timeout: 504,
  provider_connection: 502,
  provider_bad_request: 502,
  provider_error: 502,
  model_not_allowed: 503,
  refusal: 422,
  invalid_output: 502,
  aborted: 499,
  internal: 500,
};

export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly safeMessage: string;
  readonly status: number;

  constructor(code: AIErrorCode) {
    const safe = SAFE_MESSAGES[code] ?? SAFE_MESSAGES.internal;
    super(safe);
    this.name = "AIError";
    this.code = Object.hasOwn(SAFE_MESSAGES, code) ? code : "internal";
    this.safeMessage = safe;
    this.status = AI_ERROR_STATUS[this.code];
  }

  /** The shape sent to clients (NDJSON `error` event / JSON body). */
  toJSON(): { code: AIErrorCode; message: string } {
    return { code: this.code, message: this.safeMessage };
  }
}

export function isAIError(err: unknown): err is AIError {
  return err instanceof AIError;
}

export function isAIErrorCode(value: unknown): value is AIErrorCode {
  return typeof value === "string" && (AI_ERROR_CODES as readonly string[]).includes(value);
}

/** Any thrown value → AIError. AIErrors pass through; everything else becomes `internal` (the message is dropped). */
export function toAIError(err: unknown): AIError {
  return err instanceof AIError ? err : new AIError("internal");
}

/**
 * HTTP status from a provider → code. Adapters call this for typed SDK API errors (Anthropic.APIError subclasses
 * carry `status`) and for Ollama HTTP responses. Connection/timeout/abort errors have no status: adapters map
 * those classes explicitly (APIConnectionTimeoutError → provider_timeout, APIConnectionError →
 * provider_connection, APIUserAbortError / AbortError → aborted).
 */
export function aiErrorFromStatus(status: number | undefined): AIErrorCode {
  if (status === undefined) return "provider_connection";
  if (status === 400 || status === 404 || status === 409 || status === 413 || status === 422) return "provider_bad_request";
  if (status === 401 || status === 403) return "provider_auth";
  if (status === 408) return "provider_timeout";
  if (status === 429) return "provider_rate_limited";
  if (status === 503 || status === 529) return "provider_overloaded";
  if (status >= 500) return "provider_error";
  return "provider_error";
}
