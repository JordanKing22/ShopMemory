import { cn } from "@/lib/utils";

/**
 * REPLAY tag (CLAUDE.md hard rule 10): signal-orange fill with INK text, never white. `scripted` adds
 * "· scripted (not model output)" for hand-written answers.
 */
export function ReplayTag({ className, label = "REPLAY" }: { className?: string; label?: string }) {
  return (
    <span
      data-replay=""
      className={cn(
        "inline-flex min-h-6 items-center rounded-sm bg-signal px-1.5 text-sm leading-tight font-semibold tracking-wide text-ink",
        className,
      )}
    >
      {label}
    </span>
  );
}
