import { cn } from "@/lib/utils";
import { CELL_RAMP, rampStep, textHex } from "./ramp";
import { LEVEL_SHORT, METRICS, type RiskMetric } from "./copy";

interface Tick {
  at: number;
  label: string;
}

/**
 * Scale legend for the heat map (PLAN.md §8.1): the 12 fills of the blue ramp over the metric's range, with the band
 * thresholds (20 / 35 / 50) marked for risk, three discrete swatches for the expertise level, and the neutral tile for
 * "no recorded expertise". Decorative swatches are aria-hidden; a sentence carries the same information for readers.
 */
export function HeatLegend({ metric, thresholds, className }: { metric: RiskMetric; thresholds: { high: number; elevated: number; watch: number }; className?: string }) {
  const m = METRICS[metric];
  const empty = (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <span aria-hidden="true" className="inline-flex size-5 items-center justify-center rounded-[3px] border border-hairline bg-paper leading-none">
        –
      </span>
      not a holder
    </span>
  );

  if (metric === "expertise") {
    return (
      <div className={cn("flex min-w-0 flex-col gap-1", className)}>
        <div className="text-sm font-medium text-muted-foreground">{m.legend}</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {([1, 2, 3] as const).map((level) => {
            const s = rampStep(level, 3);
            return (
              <span key={level} className="inline-flex items-center gap-1.5 text-sm text-ink">
                <span
                  aria-hidden="true"
                  className="inline-flex size-5 items-center justify-center rounded-[3px] text-sm font-semibold"
                  style={{ backgroundColor: s.hex, color: textHex(s) }}
                >
                  {level}
                </span>
                {LEVEL_SHORT[level]}
              </span>
            );
          })}
          {empty}
        </div>
      </div>
    );
  }

  const ticks: Tick[] =
    metric === "risk"
      ? [
          { at: 0, label: "0" },
          { at: thresholds.watch, label: String(thresholds.watch) },
          { at: thresholds.elevated, label: String(thresholds.elevated) },
          { at: thresholds.high, label: String(thresholds.high) },
          { at: 100, label: "100" },
        ]
      : [
          { at: 0, label: "0" },
          { at: 50, label: "50" },
          { at: 100, label: "100 %" },
        ];
  const description =
    metric === "risk"
      ? `Darker blue means higher risk, from 0 to 100. Bands: Watch from ${thresholds.watch}, Elevated from ${thresholds.elevated}, High from ${thresholds.high}.`
      : "Darker blue means more of the person's know-how is captured in approved cards, from 0 to 100 %.";

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div className="flex flex-wrap items-center gap-x-3">
        <span className="text-sm font-medium text-muted-foreground">{m.legend}</span>
        {empty}
      </div>
      <p className="sr-only">{description}</p>
      <div aria-hidden="true" className="w-full max-w-72 min-w-48 px-3">
        <div className="flex h-3 gap-px overflow-hidden rounded-sm">
          {CELL_RAMP.map((s) => (
            <span key={s.step} className="flex-1" style={{ backgroundColor: s.hex }} />
          ))}
        </div>
        <div className="relative h-7">
          {ticks.map((t) => (
            <span
              key={t.at}
              className="absolute top-0 flex -translate-x-1/2 flex-col items-center text-sm leading-5 text-muted-foreground tabular-nums"
              style={{ left: `${t.at}%` }}
            >
              <span className={cn("w-px bg-ink", t.at === 0 || t.at === 100 ? "h-1" : "h-2")} />
              <span className="whitespace-nowrap">{t.label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
