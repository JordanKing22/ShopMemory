import { ClassificationBadge } from "@/components/app/classification-badge";
import type { PersonInterviewVM } from "@/lib/data/people";
import { formatDate } from "@/lib/format";

/**
 * Interviews the person gave (title, date, mode, classification). List only: there is no transcript page yet, so
 * rows are not links. Hidden manual-entry sessions never reach this list; the page shows their card count instead.
 */
export function PersonInterviewList({
  interviews,
  handEnteredCardCount,
  firstName,
}: {
  interviews: PersonInterviewVM[];
  handEnteredCardCount: number;
  firstName: string;
}) {
  return (
    <div className="space-y-3">
      {interviews.length > 0 ? (
        <ul className="divide-y divide-hairline">
          {interviews.map((i) => (
            <li key={i.id} data-testid={`person-interview-${i.id}`} className="py-3 first:pt-0">
              <p className="font-medium text-ink">{i.title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span>{i.modeLabel}</span>
                <span aria-hidden="true">·</span>
                <span>{formatDate(i.date)}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {i.cardCount} {i.cardCount === 1 ? "card" : "cards"}
                </span>
                <ClassificationBadge level={i.classification} size="sm" />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">No recorded interviews with {firstName} yet.</p>
      )}
      {handEnteredCardCount > 0 ? (
        <p data-testid="person-hand-entered" className="text-sm text-muted-foreground">
          {interviews.length > 0 ? "Plus " : ""}
          {handEnteredCardCount} {handEnteredCardCount === 1 ? "card" : "cards"} entered by hand (binder or manual entry).
        </p>
      ) : null}
      {interviews.length > 0 ? (
        <p className="text-sm text-muted-foreground">Each card shows the exact words it came from: open a card to read its evidence.</p>
      ) : null}
    </div>
  );
}
