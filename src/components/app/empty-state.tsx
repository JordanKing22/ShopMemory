import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  title: ReactNode;
  /** Explains the next action (PLAN.md §10: empty states explain what to do next). */
  body: ReactNode;
  /** Optional button or link. */
  action?: ReactNode;
  /** Optional icon element (decorative); defaults to an inbox. */
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ title, body, action, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-input-border bg-surface px-6 py-10 text-center",
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-surface-sunken text-muted-foreground">
        {icon ?? <Inbox aria-hidden="true" className="size-6" />}
      </div>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <div className="max-w-prose text-muted-foreground">{body}</div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
