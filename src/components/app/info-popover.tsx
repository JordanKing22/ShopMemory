"use client";

import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Click / tap / Enter / Space to open extra detail. Used instead of hover tooltips so the information is
 * reachable by keyboard and on touch screens (PLAN.md §10: no hover-only information).
 * The trigger is a real <button>, so never place an InfoPopover inside a link or another button.
 */
export interface InfoPopoverProps {
  /** Visible trigger content (server-rendered JSX is fine). */
  trigger: React.ReactNode;
  /** Accessible name when the trigger content alone isn't descriptive (e.g. an icon). */
  triggerLabel?: string;
  /**
   * Accessible name for the popover panel (Radix renders it as role="dialog", which needs a name).
   * Defaults to the trigger's own accessible name via aria-labelledby.
   */
  panelLabel?: string;
  /** Popover body. */
  children: React.ReactNode;
  /** Extra classes for the trigger button. */
  triggerClassName?: string;
  /** Extra classes for the popover panel. */
  className?: string;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
}

export function InfoPopover({
  trigger,
  triggerLabel,
  panelLabel,
  children,
  triggerClassName,
  className,
  align = "start",
  side = "bottom",
}: InfoPopoverProps) {
  const triggerId = React.useId();
  return (
    <Popover>
      <PopoverTrigger
        id={triggerId}
        type="button"
        aria-label={triggerLabel}
        className={cn(
          "inline-flex items-center rounded-md text-left transition-colors hover:bg-accent/60 data-[state=open]:bg-accent",
          triggerClassName,
        )}
      >
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        collisionPadding={16}
        aria-label={panelLabel}
        aria-labelledby={panelLabel ? undefined : triggerId}
        className={cn("w-80 max-w-[calc(100vw-2rem)] text-sm leading-relaxed", className)}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
