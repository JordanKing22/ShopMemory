import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons or links shown at the right (wrap below the title on narrow screens). */
  actions?: ReactNode;
  /** Small line above the title, e.g. a record ID or breadcrumb. */
  eyebrow?: ReactNode;
  /** Chips next to the title, e.g. a ClassificationBadge. */
  badges?: ReactNode;
  className?: string;
}

/** The one <h1> of a page, with optional description, chips and actions. */
export function PageHeader({ title, description, actions, eyebrow, badges, className }: PageHeaderProps) {
  return (
    <header className={cn("mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0 flex-1 basis-80">
        {eyebrow ? <div className="mb-1 text-sm font-medium text-muted-foreground">{eyebrow}</div> : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight text-ink sm:text-[1.75rem]">{title}</h1>
          {badges ? <div className="flex flex-wrap items-center gap-2">{badges}</div> : null}
        </div>
        {description ? <div className="mt-1.5 max-w-prose text-muted-foreground">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3 print:hidden">{actions}</div> : null}
    </header>
  );
}
