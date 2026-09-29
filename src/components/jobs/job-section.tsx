import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface JobSectionProps {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned chips or links next to the title (e.g. a ClassificationBadge). */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}

/** A titled card on the job page (h2 under the page's single h1). */
export function JobSection({ id, title, description, aside, children, className, testId }: JobSectionProps) {
  return (
    <section
      aria-labelledby={id}
      data-testid={testId}
      className={cn("min-w-0 rounded-lg border bg-card p-4 text-card-foreground shadow-xs sm:p-5", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id={id} className="text-lg font-semibold text-ink">
          {title}
        </h2>
        {aside ? <div className="flex flex-wrap items-center gap-2 text-sm">{aside}</div> : null}
      </div>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** One fact in a <dl> grid: label above, value below. */
export function Fact({ label, children, className, testId }: { label: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd data-testid={testId} className="mt-0.5 break-words text-ink">
        {children}
      </dd>
    </div>
  );
}

/** Chips for features and judgment drivers (words, not color). */
export function ChipList({ chips, label }: { chips: { key: string; label: string }[]; label: string }) {
  if (chips.length === 0) return <span className="text-muted-foreground">None recorded</span>;
  return (
    <ul aria-label={label} className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <li key={c.key} className="rounded-full border border-input-border bg-surface-sunken px-2.5 py-0.5 text-sm leading-5 font-medium text-ink">
          {c.label}
        </li>
      ))}
    </ul>
  );
}
