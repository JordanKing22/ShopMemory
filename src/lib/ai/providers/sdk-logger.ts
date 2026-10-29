/**
 * The logger handed to the provider SDKs (CLAUDE.md hard rule 2). At ANTHROPIC_LOG=debug the SDKs would log request
 * bodies and headers; this logger records only that the SDK logged something (provider + level) and DISCARDS every
 * argument, so no prompt, key or response can reach the console through it.
 */
import { log } from "@/lib/log";

type LogFn = (message: string, ...rest: unknown[]) => void;
export interface SdkLogger {
  error: LogFn;
  warn: LogFn;
  info: LogFn;
  debug: LogFn;
}

export function sdkLogger(provider: "anthropic" | "bedrock"): SdkLogger {
  const at = (level: "error" | "warn" | "info" | "debug"): LogFn => () => {
    if (level === "error" || level === "warn") log.warn("provider_sdk_log", { provider, level });
  };
  return { error: at("error"), warn: at("warn"), info: at("info"), debug: at("debug") };
}
