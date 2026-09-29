import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  /** Supporting line under the value, e.g. "both Ray Delgado, retiring in 20 months". */
  sub?: ReactNode;
  /** Optional icon (decorative; pass an element with aria-hidden). */
  icon?: ReactNode;
  /** "signal" adds an orange left rule (signal-strong: orange strokes never use the fill color) for the tile the demo points at. */
  tone?: "default" | "signal";
  className?: string;
}

/** A KPI tile: label, big tabular number, optional sub-line. Uses <dl> semantics. */
export function StatTile({ label, value, sub, icon, tone = "default", className }: StatTileProps) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border bg-card px-4 py-3 text-card-foreground shadow-xs",
        tone === "signal" && "border-l-4 border-l-signal-strong",
        className,
      )}
    >
      <dl className="min-w-0">
        <dt className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {icon}
          <span className="min-w-0">{label}</span>
        </dt>
        <dd className="mt-1 text-[1.75rem] leading-tight font-semibold tabular-nums text-ink">{value}</dd>
        {sub ? <dd className="mt-0.5 text-sm text-muted-foreground">{sub}</dd> : null}
      </dl>
    </div>
  );
}
