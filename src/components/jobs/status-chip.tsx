import { CalendarClock, CircleCheck, CircleMinus, Play, type LucideIcon } from "lucide-react";
import type { RecordStatus } from "@/lib/data/jobs";
import { cn } from "@/lib/utils";

const ICON: Record<RecordStatus, LucideIcon> = {
  complete: CircleCheck,
  in_process: Play,
  scheduled: CalendarClock,
  no_job: CircleMinus,
};

const STYLE: Record<RecordStatus, string> = {
  complete: "border-input-border bg-surface text-ink",
  in_process: "border-primary bg-accent text-ink",
  scheduled: "border-input-border bg-surface-sunken text-ink",
  no_job: "border-dashed border-input-border bg-surface text-muted-foreground",
};

/**
 * The status every role sees: the job's status, or "No job" for a quote without one. Never the win/loss outcome
 * (pending, lost and no-bid quotes all read "No job"). Icon + word, never color alone.
 */
export function StatusChip({ status, label, className }: { status: RecordStatus; label: string; className?: string }) {
  const Icon = ICON[status];
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-sm leading-5 font-medium",
        STYLE[status],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.25} />
      <span>{label}</span>
    </span>
  );
}
