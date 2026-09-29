import { ArrowDown, ArrowUp, Equal } from "lucide-react";
import { formatSignedPct } from "@/lib/format";
import { cn } from "@/lib/utils";

/** At or above this overrun (percent) the variance is emphasized (signal-strong text + bold). */
export const VARIANCE_EMPHASIS_PCT = 20;

/**
 * Signed variance, e.g. "+53.7 %" with an up arrow and "over quote" for screen readers. Direction is carried by the
 * sign, the arrow and the words, never by color alone. null → "—" (no actuals yet).
 */
export function VarianceValue({ pct, className, emptyLabel = "No actual hours yet" }: { pct: number | null; className?: string; emptyLabel?: string }) {
  if (pct === null) {
    return (
      <span className={cn("text-muted-foreground", className)}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{emptyLabel}</span>
      </span>
    );
  }
  const text = formatSignedPct(pct);
  const over = text.startsWith("+");
  const under = text.startsWith("−");
  const Icon = over ? ArrowUp : under ? ArrowDown : Equal;
  const strong = over && pct >= VARIANCE_EMPHASIS_PCT;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap tabular-nums",
        strong ? "font-semibold text-signal-strong" : "text-ink",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.5} />
      <span>{text}</span>
      <span className="sr-only">{over ? " over quote" : under ? " under quote" : " on quote"}</span>
    </span>
  );
}
