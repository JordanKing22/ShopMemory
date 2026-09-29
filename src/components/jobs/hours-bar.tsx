import type { ReactNode } from "react";
import type { HoursVM } from "@/lib/data/jobs";
import { formatHours } from "@/lib/format";
import { cn } from "@/lib/utils";
import { VarianceValue } from "./variance-value";

/**
 * Quoted vs actual hours as two horizontal bars on one shared scale (PLAN.md §9), visible to every role (§4.8).
 *
 * Accessible by construction: every value is printed as text next to its bar (the bars are aria-hidden decoration),
 * the variance is printed with its sign, an arrow and words, and the overrun segment carries a stripe texture as well
 * as the orange fill, so nothing depends on color. Marks follow the dataviz spec: bars ≤ 24 px thick, square at the
 * baseline with a 4 px rounded data end, a 2 px surface gap between the within-quote and overrun segments.
 * Palette (validated with the dataviz checker on white: lightness, chroma, CVD and contrast all pass):
 * quoted #6A86D8 · actual (within quote) primary #1D4ED8 · hours over the quote signal #F26B1D.
 */

const QUOTED_FILL = "bg-[#6a86d8]";
const OVERRUN_STYLE = {
  backgroundImage: "repeating-linear-gradient(135deg, rgba(22,24,28,0.28) 0 2px, transparent 2px 7px)",
} as const;

function pctOf(value: number, max: number): string {
  if (!(max > 0)) return "0%";
  return `${Math.max(0, Math.min(100, (value / max) * 100)).toFixed(2)}%`;
}

function Row({ label, value, detail, children }: { label: string; value: ReactNode; detail?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 sm:grid-cols-[4.75rem_minmax(0,1fr)_minmax(0,auto)]">
      <span className="text-sm font-medium text-ink">{label}</span>
      <div className="relative h-5 min-w-0 rounded-r-[4px] bg-surface-sunken">{children}</div>
      <div className="col-start-2 text-sm leading-tight sm:col-start-auto sm:text-right">
        <span className="font-semibold tabular-nums text-ink">{value}</span>
        {detail ? <span className="block text-muted-foreground">{detail}</span> : null}
      </div>
    </div>
  );
}

function split(setup: number | null, run: number | null): ReactNode {
  if (setup === null && run === null) return null;
  return `setup ${formatHours(setup)} · run ${formatHours(run)}`;
}

export function HoursBar({ hours, className }: { hours: HoursVM; className?: string }) {
  const { quotedHours: quoted, actualHours: actual } = hours;
  const max = Math.max(quoted ?? 0, actual ?? 0);
  const over = quoted !== null && actual !== null && actual > quoted;
  const withinQuote = quoted !== null && actual !== null ? Math.min(actual, quoted) : (actual ?? 0);
  const delta = hours.deltaHours;

  let actualNote: string | null = null;
  if (actual === null) {
    actualNote =
      hours.state === "no_job"
        ? "No job for this quote, so there are no actual hours."
        : hours.state === "scheduled"
          ? "Scheduled: no actual hours yet."
          : "In process: actual hours are recorded when the job ships.";
  }

  return (
    <figure data-testid="hours-bar" aria-labelledby="hours-bar-caption" className={cn("min-w-0 space-y-3", className)}>
      <figcaption id="hours-bar-caption" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-medium text-ink">Quoted vs actual hours</span>
        {hours.state === "internal" ? (
          <span className="text-sm text-muted-foreground">Internal work order: not quoted, so there is no variance.</span>
        ) : (
          <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="text-muted-foreground">Variance</span>
            <VarianceValue pct={hours.variancePct} className="text-base" emptyLabel="No variance until actual hours exist" />
            {delta !== null && delta !== 0 ? (
              <span className="text-muted-foreground">
                ({formatHours(Math.abs(delta))} {delta > 0 ? "over" : "under"} quote)
              </span>
            ) : null}
          </span>
        )}
      </figcaption>

      <div className="space-y-2.5">
        {quoted !== null ? (
          <Row label="Quoted" value={formatHours(quoted)} detail={split(hours.quotedSetupHours, hours.quotedRunHours)}>
            <div aria-hidden="true" className={cn("absolute inset-y-0 left-0 rounded-r-[4px]", QUOTED_FILL)} style={{ width: pctOf(quoted, max) }} />
          </Row>
        ) : null}

        {actual !== null ? (
          <Row label="Actual" value={formatHours(actual)} detail={split(hours.actualSetupHours, hours.actualRunHours)}>
            <div aria-hidden="true" className="absolute inset-y-0 left-0 flex gap-[2px]" style={{ width: pctOf(actual, max) }}>
              <div className={cn("h-full bg-primary", over ? "" : "rounded-r-[4px]")} style={{ flexGrow: withinQuote, flexBasis: 0 }} />
              {over && quoted !== null ? (
                <div className="h-full rounded-r-[4px] bg-signal" style={{ ...OVERRUN_STYLE, flexGrow: actual - quoted, flexBasis: 0 }} />
              ) : null}
            </div>
            {quoted !== null && actual < quoted ? (
              // Where the quote ended, so an under-run reads as a gap rather than just a shorter bar.
              <div aria-hidden="true" className="absolute -inset-y-1 w-0.5 bg-ink" style={{ left: `calc(${pctOf(quoted, max)} - 1px)` }} />
            ) : null}
          </Row>
        ) : quoted !== null && actualNote ? (
          <div className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[4.75rem_minmax(0,1fr)]">
            <span className="text-sm font-medium text-ink">Actual</span>
            <span className="text-sm text-muted-foreground">{actualNote}</span>
          </div>
        ) : null}
      </div>

      {over ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <span aria-hidden="true" className="inline-block h-3 w-5 rounded-[2px] bg-signal" style={OVERRUN_STYLE} />
          Hours over the quote
        </p>
      ) : null}
    </figure>
  );
}
