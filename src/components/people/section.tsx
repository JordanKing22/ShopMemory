import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ProfileSectionProps {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned link or note next to the title. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A titled card on the person profile (h2 under the page's single h1). */
export function ProfileSection({ id, title, description, aside, children, className }: ProfileSectionProps) {
  return (
    <section aria-labelledby={id} className={cn("min-w-0 rounded-lg border bg-card p-4 text-card-foreground shadow-xs sm:p-5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="text-lg font-semibold text-ink">
          {title}
        </h2>
        {aside ? <div className="text-sm">{aside}</div> : null}
      </div>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}
