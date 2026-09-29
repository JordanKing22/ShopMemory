import { CircleCheck, CircleX, Clock, History, PencilLine, type LucideIcon } from "lucide-react";
import type { TimelineEventVM } from "@/lib/data/cards";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICON: Record<TimelineEventVM["kind"], { icon: LucideIcon; tone: string }> = {
  created: { icon: PencilLine, tone: "text-muted-foreground" },
  approved: { icon: CircleCheck, tone: "text-primary" },
  awaiting: { icon: Clock, tone: "text-signal-strong" },
  rejected: { icon: CircleX, tone: "text-destructive" },
  superseded: { icon: History, tone: "text-muted-foreground" },
};

/** Status timeline: created → approved on …, or "Draft — awaiting {name}", or rejected with the review notes. */
export function CardTimeline({ events }: { events: TimelineEventVM[] }) {
  return (
    <ol className="space-y-4">
      {events.map((ev, i) => {
        const { icon: Icon, tone } = ICON[ev.kind];
        const date = ev.kind === "created" || ev.kind === "approved" ? ev.date : null;
        return (
          <li key={`${ev.kind}-${i}`} data-timeline={ev.kind} className="flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-surface">
              <Icon aria-hidden="true" className={cn("size-4", tone)} strokeWidth={2.25} />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="font-medium text-ink">{ev.text}</p>
              {date ? (
                <p className="text-sm text-muted-foreground">
                  <time dateTime={date}>{formatDate(date)}</time>
                </p>
              ) : null}
              {ev.kind === "rejected" && ev.notes ? (
                <div className="mt-2 rounded-md border bg-surface-sunken p-3 text-sm leading-relaxed text-ink">
                  <p className="font-medium">Review notes</p>
                  <p className="mt-1">{ev.notes}</p>
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
