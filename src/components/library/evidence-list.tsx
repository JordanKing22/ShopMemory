import { BookOpenText, MessagesSquare } from "lucide-react";
import type { EvidenceVM } from "@/lib/data/cards";
import { formatDate } from "@/lib/format";

/**
 * Evidence for a card (CLAUDE.md hard rule 9): each quote shown inside its whole transcript turn with the quoted span
 * highlighted, labelled with the interview and date — or as a hand entry (hidden manual-entry sessions are
 * provenance only and are never linked).
 */
export function EvidenceList({ evidence }: { evidence: EvidenceVM[] }) {
  return (
    <ol data-testid="card-evidence" className="space-y-4">
      {evidence.map((e, i) => (
        <li
          key={e.id}
          id={`evidence-${e.id}`}
          data-evidence-source={e.source.kind}
          className="rounded-md border bg-surface p-3 sm:p-4"
        >
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {e.source.kind === "interview" ? (
              <MessagesSquare aria-hidden="true" className="size-4 shrink-0" />
            ) : (
              <BookOpenText aria-hidden="true" className="size-4 shrink-0" />
            )}
            <span className="font-medium text-ink">Evidence {i + 1}</span>
            <span aria-hidden="true">·</span>
            {e.source.kind === "interview" ? (
              <span>
                Interview: <span className="text-ink">{e.source.title}</span> · turn {e.source.turnSeq}
              </span>
            ) : (
              <span className="text-ink">{e.source.label}</span>
            )}
            <span aria-hidden="true">·</span>
            <time dateTime={e.source.date}>{formatDate(e.source.date)}</time>
            {e.supportsConfidence ? (
              <span className="rounded-full border border-primary/40 bg-accent px-2 leading-6 text-ink">
                Supports the stated confidence
              </span>
            ) : null}
          </p>
          <blockquote className="mt-2 border-l-4 border-hairline pl-3 leading-relaxed text-ink">
            {e.context ? (
              <p>
                {e.context.before}
                <span className="sr-only">Quoted: </span>
                <mark className="rounded-sm bg-signal-tint px-0.5 text-ink shadow-[inset_0_-2px_0_var(--signal-strong)]">
                  {e.context.match}
                </mark>
                {e.context.after}
              </p>
            ) : (
              <p>
                <mark className="rounded-sm bg-signal-tint px-0.5 text-ink shadow-[inset_0_-2px_0_var(--signal-strong)]">{e.quote}</mark>
              </p>
            )}
          </blockquote>
        </li>
      ))}
    </ol>
  );
}
