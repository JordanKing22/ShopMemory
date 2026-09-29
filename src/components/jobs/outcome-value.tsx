import { CircleCheck, CircleMinus, CircleX, Hourglass, type LucideIcon } from "lucide-react";
import { HiddenField } from "@/components/app/hidden-field";
import type { Gated } from "@/lib/data/gate";
import type { OutcomeVM, QuoteOutcome } from "@/lib/data/jobs";
import { cn } from "@/lib/utils";

const ICON: Record<QuoteOutcome, LucideIcon> = {
  won: CircleCheck,
  lost: CircleX,
  no_bid: CircleMinus,
  pending: Hourglass,
};

export interface OutcomeValueProps {
  /** Gated by winLoss; null = an internal work order (never quoted). */
  outcome: Gated<OutcomeVM> | null;
  /** Let the "Hidden for … role" pill wrap onto two lines (dense table cells). */
  compact?: boolean;
  className?: string;
}

/**
 * A quote's win/loss outcome and lost reason (owner and quoters), or the visible "Hidden for {Role} role" pill.
 * The data layer already dropped the value for other roles, so nothing is hidden with CSS here.
 */
export function OutcomeValue({ outcome, compact = false, className }: OutcomeValueProps) {
  if (outcome === null) {
    return (
      <span className={cn("text-muted-foreground", className)}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">Not quoted (internal work order)</span>
      </span>
    );
  }
  if (outcome.hidden) {
    return <HiddenField label={outcome.label} className={cn(compact && "whitespace-normal", className)} />;
  }
  const v = outcome.value;
  const Icon = ICON[v.outcome];
  return (
    <span data-outcome={v.outcome} className={cn("inline-flex items-start gap-1.5 text-ink", className)}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2.25} />
      <span>
        <span className="font-medium">{v.outcomeLabel}</span>
        {v.lostReasonLabel ? (
          <>
            <span aria-hidden="true"> · </span>
            <span className="sr-only">, reason: </span>
            <span className="text-muted-foreground">{v.lostReasonLabel}</span>
          </>
        ) : null}
      </span>
    </span>
  );
}
