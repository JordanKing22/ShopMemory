/**
 * Pure display formatters shared by every screen (PLAN.md §10: en-US, UTC, tabular numbers).
 * No Date.now(), no runtime locale: output is identical on Windows, Ubuntu, server and client,
 * so render paths never hydrate differently.
 *
 * Percent inputs are in percent units: formatPct(18.2) → "18.2 %" (not 0.182).
 * formatMoneyUSD must only be called for values the actor may see (canSee(role, "prices")); the data layer
 * already omits hidden values, so the number never reaches the client for other roles.
 */
export { formatDate, formatMonthDay } from "@/lib/time";

/** True minus sign (U+2212): the hyphen-minus reads as a dash in tables. */
export const MINUS = "−";
/** Shown when a number is missing or not finite. */
export const NOT_AVAILABLE = "—";

const nf = (min: number, max: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: true });

const oneDecimal = nf(1, 1);
const integer = nf(0, 0);
const decimalsCache = new Map<number, Intl.NumberFormat>();
function fixed(digits: number): Intl.NumberFormat {
  const d = Math.max(0, Math.min(6, Math.trunc(digits)));
  let f = decimalsCache.get(d);
  if (!f) {
    f = nf(d, d);
    decimalsCache.set(d, f);
  }
  return f;
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function finite(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Replace a leading ASCII hyphen-minus with the true minus sign. */
function trueMinus(s: string): string {
  return s.startsWith("-") ? `${MINUS}${s.slice(1)}` : s;
}

/** Formats with `f`, and never shows "-0.0": a value that rounds to zero is printed unsigned. */
function formatAbsAware(f: Intl.NumberFormat, n: number): { text: string; sign: -1 | 0 | 1 } {
  const text = f.format(Math.abs(n));
  const roundsToZero = Number(text.replace(/,/g, "")) === 0;
  const sign: -1 | 0 | 1 = roundsToZero ? 0 : n < 0 ? -1 : 1;
  return { text, sign };
}

/** 41.5 → "41.5 h" (always one decimal, so hour columns line up). */
export function formatHours(h: number | null | undefined): string {
  if (!finite(h)) return NOT_AVAILABLE;
  const { text, sign } = formatAbsAware(oneDecimal, h);
  return `${sign < 0 ? MINUS : ""}${text} h`;
}

/** 53.66 → "+53.7 %", −3.4 → "−3.4 %" (U+2212), 0.01 → "0.0 %". Input is in percent units. */
export function formatSignedPct(p: number | null | undefined, digits = 1): string {
  if (!finite(p)) return NOT_AVAILABLE;
  const { text, sign } = formatAbsAware(fixed(digits), p);
  return `${sign > 0 ? "+" : sign < 0 ? MINUS : ""}${text} %`;
}

/** 18.2 → "18.2 %". Input is in percent units. */
export function formatPct(p: number | null | undefined, digits = 1): string {
  if (!finite(p)) return NOT_AVAILABLE;
  const { text, sign } = formatAbsAware(fixed(digits), p);
  return `${sign < 0 ? MINUS : ""}${text} %`;
}

/** Signed whole-number delta for delta mode: 14 → "+14", −16 → "−16", 0 → "0". */
export function formatSignedInt(n: number | null | undefined): string {
  if (!finite(n)) return NOT_AVAILABLE;
  const { text, sign } = formatAbsAware(integer, n);
  return `${sign > 0 ? "+" : sign < 0 ? MINUS : ""}${text}`;
}

/** 14884.62 → "$14,884.62". Only render for roles where canSee(role, "prices") is true. */
export function formatMoneyUSD(n: number | null | undefined): string {
  if (!finite(n)) return NOT_AVAILABLE;
  if (Number(usd.format(Math.abs(n)).replace(/[$,]/g, "")) === 0) return usd.format(0);
  return trueMinus(usd.format(n));
}

/** 20 → "20 mo" (whole months; use monthsBetween() from @/lib/time to compute them). */
export function formatMonths(m: number | null | undefined): string {
  if (!finite(m)) return NOT_AVAILABLE;
  return `${trueMinus(integer.format(Math.trunc(m)))} mo`;
}

/** Tenure in whole years (floor): 31.7 → "31 yrs", 1.2 → "1 yr", 0.4 → "0 yrs". */
export function formatYears(y: number | null | undefined): string {
  if (!finite(y)) return NOT_AVAILABLE;
  const whole = Math.max(0, Math.floor(y));
  return `${integer.format(whole)} ${whole === 1 ? "yr" : "yrs"}`;
}

/** 1234 → "1,234"; digits > 0 gives fixed decimals: formatNumber(3.14159, 2) → "3.14". */
export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (!finite(n)) return NOT_AVAILABLE;
  const { text, sign } = formatAbsAware(fixed(digits), n);
  return `${sign < 0 ? MINUS : ""}${text}`;
}

/** The structural slice of a routing target the header needs (matches getRoutingSummary()'s targets). */
export interface ProviderLineTarget {
  targetClass: string;
  providerLabel: string;
  model: string;
  host: string;
  region?: string;
  isLoopback: boolean;
  /** Ollama only: this_computer · on_prem · on_prem_unencrypted · not_local. */
  locality?: string;
  /** Bedrock only: inference-profile scope (global · geo · none · unknown). */
  crossRegion?: string;
  /** Bedrock only: the endpoint host is a FIPS endpoint. */
  fips?: boolean;
}

/** Header wording for a Bedrock profile scope that can reach other regions ("" = nothing to add). */
export const CROSS_REGION_SUFFIX: Readonly<Record<string, string>> = {
  global: "global cross-region",
  unknown: "cross-region scope unknown (treated as global)",
};

function ollamaWhere(t: ProviderLineTarget): string {
  if (t.isLoopback) return "this computer";
  switch (t.locality) {
    case "on_prem":
      return "on-prem";
    case "on_prem_unencrypted":
      return "on-prem · unencrypted";
    default:
      return t.host ? `${t.host} · not local` : "not local";
  }
}

/**
 * The header/provider line (PLAN.md §4.11), e.g. "Anthropic API · claude-sonnet-5-5",
 * "Amazon Bedrock · us-east-1" (a geography or in-region profile; the long model ID is in the details panel),
 * "Amazon Bedrock · us-east-1 · global cross-region" (a global profile may run in commercial regions worldwide),
 * "Amazon Bedrock · us-east-1 · cross-region scope unknown (treated as global)" (e.g. an application profile ARN),
 * "Amazon Bedrock · us-gov-west-1 · FIPS · allowlisted" (a qualifying GovCloud endpoint),
 * "Ollama · qwen3.5:4b · this computer", "Ollama · qwen3.5:4b · on-prem · unencrypted".
 * "this computer" appears ONLY for a loopback host (CLAUDE.md hard rule 10). There is deliberately no
 * "geo cross-region" suffix (PLAN.md doesn't specify one, and GovCloud "us-gov." IDs are geography profiles).
 */
export function formatProviderLine(t: ProviderLineTarget): string {
  const parts = [t.providerLabel];
  if (t.targetClass.startsWith("bedrock")) {
    parts.push(t.region || "region not set");
    const scope = t.crossRegion && Object.hasOwn(CROSS_REGION_SUFFIX, t.crossRegion) ? CROSS_REGION_SUFFIX[t.crossRegion] : "";
    if (scope) parts.push(scope);
    if (t.targetClass === "bedrock_govcloud") {
      if (t.fips) parts.push("FIPS");
      parts.push("allowlisted");
    }
  } else if (t.model) parts.push(t.model);
  if (t.targetClass === "ollama_local") parts.push(ollamaWhere(t));
  return parts.join(" · ");
}

/** Short provider name for phone headers: "Anthropic", "Bedrock", "Ollama". */
export function formatProviderShort(t: Pick<ProviderLineTarget, "providerLabel">): string {
  const label = t.providerLabel;
  if (label.startsWith("Anthropic")) return "Anthropic";
  if (label.includes("Bedrock")) return "Bedrock";
  return label;
}
