/**
 * Coverage and risk constants and per-factor formulas (PLAN.md §6).
 *
 * Everything here is a transparent heuristic, not a validated instrument: the UI labels the scores
 * "estimate" and shows these inputs on click. Change a constant only together with PLAN.md §6 and
 * the golden test (tests/coverage.test.ts), because the scripted demo quotes the resulting numbers.
 *
 * Pure module: no I/O, no clock, no randomness. Dates are passed in by the caller.
 */
import type { CardType, Confidence } from "@/db/schema/enums";
import { monthsBetween, yearsBetween } from "@/lib/time";

/** Tacit expertise level E(p,t): 0 none · 1 working · 2 independent · 3 deep (the go-to person). */
export type ExpertiseLevel = 0 | 1 | 2 | 3;

/** Highest tacit level; E/3 is the "how much there is to lose" factor. */
export const MAX_LEVEL = 3;

/** Weighted card points per expertise level needed for full capture: f = min(1, C / (K·E)). */
export const K = 4;

/** Card-type weight. Rules and stories count fully; everything else slightly less. */
export const TYPE_WEIGHT: Readonly<Record<CardType, number>> = {
  quoting_rule: 1.0,
  failure_story: 1.0,
  setup_tip: 0.8,
  machine_quirk: 0.8,
  customer_quirk: 0.8,
  inspection_gotcha: 0.8,
};

/** Stated-confidence weight (not applied to failure stories, see {@link cardWeight}). */
export const CONF_WEIGHT: Readonly<Record<Confidence, number>> = {
  always: 1.0,
  usually: 1.0,
  sometimes: 0.75,
  not_stated: 0.75,
  not_sure: 0.5,
};

/** Failure stories are events, not rules, so their confidence weight is always this value. */
export const FAILURE_STORY_CONF_WEIGHT = 1.0;

/** w(c) = TYPE_WEIGHT[type] × CONF_WEIGHT[confidence]; failure_story always uses confidence weight 1.0. */
export function cardWeight(type: CardType, confidence: Confidence): number {
  const conf = type === "failure_story" ? FAILURE_STORY_CONF_WEIGHT : CONF_WEIGHT[confidence];
  return TYPE_WEIGHT[type] * conf;
}

/** Urgency factor parameters: U = no date ? U_NO_DATE : clamp(1 − (m − U_GRACE_MONTHS)/U_RAMP_MONTHS, U_MIN, U_MAX). */
export const U_NO_DATE = 0.25;
export const U_GRACE_MONTHS = 12;
export const U_RAMP_MONTHS = 48;
export const U_MIN = 0.25;
export const U_MAX = 1;

/** Tenure factor parameters: T = T_BASE + T_SPAN · min(1, y / T_FULL_YEARS). */
export const T_BASE = 0.6;
export const T_SPAN = 0.4;
export const T_FULL_YEARS = 30;

/** Backup discount parameter: D = 1 − D_MAX_DISCOUNT · min(1, B / E). */
export const D_MAX_DISCOUNT = 0.6;

/** Risk bands on the rounded 0–100 risk: high ≥ 50 · elevated 35–49 · watch 20–34 · low < 20. */
export const RISK_BANDS = ["high", "elevated", "watch", "low"] as const;
export type RiskBand = (typeof RISK_BANDS)[number];
export const BAND_THRESHOLDS: Readonly<{ high: number; elevated: number; watch: number }> = {
  high: 50,
  elevated: 35,
  watch: 20,
};

/**
 * Single-point-of-failure rule: the holder has E = SPOF_LEVEL, the best backup is ≤ SPOF_MAX_BACKUP,
 * the holder's share of the topic's expertise mass is > SPOF_MIN_SHARE, and capture f < SPOF_MAX_CAPTURED.
 */
export const SPOF_LEVEL = 3;
export const SPOF_MAX_BACKUP = 1;
export const SPOF_MIN_SHARE = 0.5;
export const SPOF_MAX_CAPTURED = 0.5;

/** Clamp `x` into [lo, hi]. */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * m(p): whole months from DEMO_TODAY to the planned departure, using the one shared
 * `monthsBetween()` (so the displayed "retires in N months" and the factor always agree).
 * `null` when no departure is planned. Negative when the date is already past.
 */
export function monthsToDeparture(demoToday: string, plannedDepartureDate: string | null): number | null {
  return plannedDepartureDate === null ? null : monthsBetween(demoToday, plannedDepartureDate);
}

/** U(p) = no date ? 0.25 : clamp(1 − (m − 12)/48, 0.25, 1). Never increases as m grows. */
export function urgencyFactor(months: number | null): number {
  if (months === null) return U_NO_DATE;
  return clamp(1 - (months - U_GRACE_MONTHS) / U_RAMP_MONTHS, U_MIN, U_MAX);
}

/** y(p): fractional years from hire date to DEMO_TODAY (365.25-day years), floored at 0 for future hires. */
export function tenureYears(hireDate: string, demoToday: string): number {
  return Math.max(0, yearsBetween(hireDate, demoToday));
}

/** T(p) = 0.6 + 0.4 · min(1, y/30), with y floored at 0. */
export function tenureFactor(years: number): number {
  return T_BASE + T_SPAN * Math.min(1, Math.max(0, years) / T_FULL_YEARS);
}

/** D(p,t) = 1 − 0.6 · min(1, B/E). Returns 1 (no discount) for E = 0, where risk is 0 anyway. */
export function backupDiscount(bestBackupLevel: number, level: number): number {
  if (level <= 0) return 1;
  return 1 - D_MAX_DISCOUNT * Math.min(1, Math.max(0, bestBackupLevel) / level);
}

/** f(p,t) = E = 0 ? 0 : min(1, C / (K·E)). */
export function capturedFraction(capturedPoints: number, level: number): number {
  if (level <= 0) return 0;
  return Math.min(1, Math.max(0, capturedPoints) / (K * level));
}

/** Band for a (rounded) risk score. Bands are applied to the displayed integer so label and number agree. */
export function riskBand(risk: number): RiskBand {
  if (risk >= BAND_THRESHOLDS.high) return "high";
  if (risk >= BAND_THRESHOLDS.elevated) return "elevated";
  if (risk >= BAND_THRESHOLDS.watch) return "watch";
  return "low";
}

/**
 * SPOF(p,t): E = 3, B ≤ 1, E/ΣE > 0.5 and f < 0.5. At most one person per topic can satisfy the
 * share condition, so a topic has at most one SPOF.
 */
export function isSpof(args: { level: number; bestBackupLevel: number; topicMass: number; captured: number }): boolean {
  const { level, bestBackupLevel, topicMass, captured } = args;
  return (
    level === SPOF_LEVEL &&
    bestBackupLevel <= SPOF_MAX_BACKUP &&
    topicMass > 0 &&
    level / topicMass > SPOF_MIN_SHARE &&
    captured < SPOF_MAX_CAPTURED
  );
}
