import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SpofFlagProps {
  /** Optional holder name: "Single point of failure: Ray Delgado". */
  holder?: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * "Single point of failure" flag (PLAN.md §6 SPOF rule, §8.1). Icon + words, signal-strong stroke on paper;
 * never color alone and never an unexplained abbreviation.
 */
export function SpofFlag({ holder, size = "md", className }: SpofFlagProps) {
  return (
    <span
      data-spof=""
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border-2 border-signal-strong bg-surface font-medium text-signal-strong",
        size === "sm" ? "px-1.5 py-px text-sm leading-5" : "px-2 py-0.5 text-sm leading-5",
        className,
      )}
    >
      <UserRound aria-hidden="true" className={cn("shrink-0", size === "sm" ? "size-3.5" : "size-4")} strokeWidth={2.5} />
      <span>
        Single point of failure
        {holder ? <span className="text-ink">: {holder}</span> : null}
      </span>
    </span>
  );
}
