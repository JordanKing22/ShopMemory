import { formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface CoverageMeterProps {
  /** 0..100, or null when there is nothing to measure. */
  pct: number | null;
  /** Visible word after the number, e.g. "captured". */
  suffix?: string;
  /** Screen-reader text when pct is null. */
  emptyLabel?: string;
  className?: string;
}

/**
 * A number with a small decorative bar (the number carries the meaning; the bar is aria-hidden). Primary fill on a
 * sunken track, so it reads on a projector without relying on color alone.
 */
export function CoverageMeter({ pct, suffix, emptyLabel = "Not applicable", className }: CoverageMeterProps) {
  if (pct === null) {
    return (
      <span className={cn("text-muted-foreground", className)}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{emptyLabel}</span>
      </span>
    );
  }
  const width = Math.max(0, Math.min(100, pct));
  return (
    <span className={cn("inline-flex items-center gap-2 whitespace-nowrap", className)}>
      <span className="font-medium text-ink tabular-nums">
        {formatPct(pct)}
        {suffix ? <span className="font-normal text-muted-foreground"> {suffix}</span> : null}
      </span>
      <span aria-hidden="true" className="relative h-2 w-16 shrink-0 overflow-hidden rounded-full border border-input-border bg-surface-sunken">
        <span className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${width}%` }} />
      </span>
    </span>
  );
}
