import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export interface HiddenFieldProps {
  /** Full visible text, normally hiddenLabel(role) → "Hidden for Machinist role". */
  label: string;
  className?: string;
}

/**
 * The visible pill that stands in for a role-gated value (CLAUDE.md UI conventions; PLAN.md §4.8).
 * The value itself is never in the page: the data layer omits it before rendering.
 */
export function HiddenField({ label, className }: HiddenFieldProps) {
  return (
    <span
      data-hidden-field=""
      className={cn(
        "inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full border border-dashed border-input-border bg-surface-sunken px-2.5 py-0.5 text-sm font-medium leading-5 text-muted-foreground",
        className,
      )}
    >
      <Lock aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.25} />
      <span>{label}</span>
    </span>
  );
}

/** Structural twin of Gated<T> from src/lib/data/gate.ts (kept structural so this file stays dependency-free). */
export type GatedLike<T> = { hidden: true; label: string } | { hidden: false; value: T };

export interface GatedValueProps<T> {
  value: GatedLike<T>;
  /** Renders the visible value, e.g. (v) => formatMoneyUSD(v). */
  children: (value: T) => ReactNode;
  /** Classes for the HiddenField pill when the value is hidden. */
  hiddenClassName?: string;
}

/**
 * Renders a gated view-model field: the value when visible, otherwise the "Hidden for {Role} role" pill.
 * Usable from Server Components (the render function never crosses to the client).
 */
export function GatedValue<T>({ value, children, hiddenClassName }: GatedValueProps<T>) {
  if (value.hidden) return <HiddenField label={value.label} className={hiddenClassName} />;
  return <>{children(value.value)}</>;
}
