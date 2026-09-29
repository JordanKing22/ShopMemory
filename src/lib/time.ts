/**
 * Two clocks (PLAN.md §5.1):
 * - Domain dates use DEMO_TODAY (fixed in seed-data/shop.yaml) and the demo clock for runtime domain records.
 * - Only audit/event/session timestamps use real time.
 * All formatting is en-US + UTC so Windows and Ubuntu render identically and hydration never mismatches.
 */

export const DEFAULT_DEMO_TODAY = "2026-09-15";

/** Parse a YYYY-MM-DD (or full ISO) string as a UTC date. */
export function parseDate(value: string): Date {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return d;
}

/** Whole months from `from` to `to` (floor; negative if `to` is earlier). The one month rule used everywhere. */
export function monthsBetween(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return months;
}

/** Fractional years from `from` to `to` (365.25-day years), for tenure. */
export function yearsBetween(from: string, to: string): number {
  return (parseDate(to).getTime() - parseDate(from).getTime()) / (365.25 * 24 * 3600 * 1000);
}

/** Add whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The demo clock for domain records created at runtime (approvals, card created_on, document dates):
 * DEMO_TODAY's date plus the real time of day.
 */
export function demoClockIso(demoToday: string, realNow: Date): string {
  const time = realNow.toISOString().slice(10); // "THH:MM:SS.sssZ"
  return `${demoToday}${time}`;
}

const dateFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
});

/** "Sep 15, 2026" */
export function formatDate(value: string): string {
  return dateFmt.format(parseDate(value));
}

const monthDayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

/** "Sep 11" (used by interview templates). */
export function formatMonthDay(value: string): string {
  return monthDayFmt.format(parseDate(value));
}
