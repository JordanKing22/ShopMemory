/* eslint-disable no-console -- the one console writer for app code */
/**
 * The only place app code may write to the console (CLAUDE.md hard rule 2).
 * Accepts an event name plus flat primitive fields. Keys that could carry payloads are dropped,
 * long strings are truncated, and secret-looking values are scrubbed.
 */
export type SafeValue = string | number | boolean | null | undefined;
export type SafeFields = Record<string, SafeValue>;

const BLOCKED_KEY =
  /prompt|payload|messages?|content|text|body|transcript|key|secret|token|authorization|password|cookie/i;

const SECRET_PATTERNS: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, "[redacted-key]"],
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "[redacted-aws-key-id]"],
  [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]"],
  [/\b[A-Za-z0-9/+]{40}\b/g, "[redacted-40]"],
];

const MAX_LEN = 120;

export function scrub(value: string): string {
  let out = value;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out.length > MAX_LEN ? `${out.slice(0, MAX_LEN)}…` : out;
}

export function sanitizeFields(fields: SafeFields = {}): SafeFields {
  const out: SafeFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (BLOCKED_KEY.test(k)) continue;
    out[k] = typeof v === "string" ? scrub(v) : v;
  }
  return out;
}

type Level = "info" | "warn" | "error";

function emit(level: Level, event: string, fields?: SafeFields) {
  const line = JSON.stringify({ level, event: scrub(event), ...sanitizeFields(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const log = {
  info: (event: string, fields?: SafeFields) => emit("info", event, fields),
  warn: (event: string, fields?: SafeFields) => emit("warn", event, fields),
  error: (event: string, fields?: SafeFields) => emit("error", event, fields),
};
