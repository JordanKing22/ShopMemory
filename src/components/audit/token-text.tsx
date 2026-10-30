import type { TokenSegment } from "@/lib/audit/types";
import { cn } from "@/lib/utils";

/** Redacted text with each [[…]] token highlighted (signal-orange outline, ink text; PLAN.md §4.6). */
export function TokenText({ segments, className }: { segments: TokenSegment[] | null; className?: string }) {
  if (!segments || segments.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("break-words whitespace-pre-wrap", className)}>
      {segments.map((s, i) =>
        s.token ? (
          <mark key={i} data-token="" className="rounded-sm bg-signal-tint px-0.5 text-ink outline-2 outline-signal-strong outline-solid">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}
