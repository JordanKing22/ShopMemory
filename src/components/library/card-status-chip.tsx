import { CircleCheck, CircleX, Clock, History, PencilLine, type LucideIcon } from "lucide-react";
import type { CardStatus } from "@/db/schema/enums";
import { cn } from "@/lib/utils";

/**
 * Card status as icon + words (never color alone). `label` comes from the view model, e.g. "Approved" or
 * "Draft — awaiting Maya Chen". Safe in Server and Client Components (no hooks, no data imports).
 */
const ICON: Record<CardStatus, LucideIcon> = {
  approved: CircleCheck,
  pending_review: Clock,
  draft: PencilLine,
  rejected: CircleX,
  superseded: History,
};

const STYLE: Record<CardStatus, { chip: string; icon: string }> = {
  approved: { chip: "border-primary/40 bg-accent text-ink", icon: "text-primary" },
  // Orange strokes use signal-strong; the fill is the soft tint with ink text.
  pending_review: { chip: "border-signal-strong bg-signal-tint text-ink", icon: "text-signal-strong" },
  draft: { chip: "border-dashed border-input-border bg-surface-sunken text-ink", icon: "text-muted-foreground" },
  rejected: { chip: "border-destructive/60 bg-surface text-ink", icon: "text-destructive" },
  superseded: { chip: "border-hairline bg-surface text-muted-foreground", icon: "text-muted-foreground" },
};

export interface CardStatusChipProps {
  status: CardStatus;
  label: string;
  className?: string;
}

export function CardStatusChip({ status, label, className }: CardStatusChipProps) {
  const Icon = ICON[status];
  return (
    <span
      data-card-status={status}
      className={cn(
        "inline-flex w-fit max-w-full items-center gap-1.5 rounded-md border px-2 py-px text-sm leading-5 font-medium",
        STYLE[status].chip,
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", STYLE[status].icon)} strokeWidth={2.25} />
      <span className="min-w-0">{label}</span>
    </span>
  );
}
