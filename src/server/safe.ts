import "server-only";
/**
 * Error hygiene for Server Actions and route handlers (CLAUDE.md hard rule 2, PLAN.md §4.10).
 * Errors that leave a wrapped function are either a SafeError (fixed code + fixed, payload-free message) or a
 * generic "internal" SafeError. Raw error messages and stacks can carry payload snippets (V8 embeds input text,
 * SDK errors embed request bodies), so they are never logged, rethrown or shown. Phase 3 extends this for AIError.
 */
import { unstable_rethrow } from "next/navigation";
import { log } from "@/lib/log";

export class SafeError extends Error {
  readonly code: string;
  readonly safeMessage: string;

  constructor(code: string, safeMessage: string) {
    super(safeMessage);
    this.name = "SafeError";
    this.code = code;
    this.safeMessage = safeMessage;
  }
}

export function isSafeError(err: unknown): err is SafeError {
  return err instanceof SafeError;
}

/** A short, enum-like identifier for the log line: an SQLite-style code or an Error class name, never a message. */
function errorCode(err: unknown): string {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{0,39}$/.test(code)) return code;
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string" && /^[A-Za-z]{1,40}$/.test(name)) return name;
  }
  return "unknown";
}

/**
 * Wraps an async Server Action or route handler. SafeErrors pass through; Next.js control-flow errors
 * (redirect(), notFound(), dynamic-rendering bailouts) are rethrown untouched; anything else is logged by code only
 * and replaced with SafeError("internal", "Something went wrong.").
 */
export function withSafeErrors<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  name?: string,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    try {
      return await fn(...args);
    } catch (err) {
      unstable_rethrow(err);
      if (err instanceof SafeError) throw err;
      log.error("action_failed", { code: errorCode(err), action: name });
      throw new SafeError("internal", "Something went wrong.");
    }
  };
}
