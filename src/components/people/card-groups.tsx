import Link from "next/link";
import { ClassificationBadge } from "@/components/app/classification-badge";
import { CardStatusChip } from "@/components/library/card-status-chip";
import type { PersonCardGroupVM } from "@/lib/data/people";

/**
 * The person's cards by status (approved, pending review, draft, rejected, superseded), each row a link to
 * /library/{id}. The classification badge sits inside the link, so it is non-interactive (info={false}).
 */
export function PersonCardGroups({ groups, firstName }: { groups: PersonCardGroupVM[]; firstName: string }) {
  if (groups.length === 0) {
    return <p className="text-muted-foreground">No cards credited to {firstName} yet.</p>;
  }
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.status} data-status={g.status}>
          <h3 className="flex items-center gap-2 font-semibold text-ink">
            <CardStatusChip status={g.status} label={g.label} />
            <span className="text-sm font-normal text-muted-foreground">
              {g.cards.length} {g.cards.length === 1 ? "card" : "cards"}
            </span>
          </h3>
          <ul className="mt-2 divide-y divide-hairline">
            {g.cards.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/library/${c.id}`}
                  data-testid={`person-card-${c.id}`}
                  className="flex min-h-tap flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-2 hover:bg-muted/60"
                >
                  <span className="w-16 shrink-0 font-mono text-sm text-muted-foreground">{c.id}</span>
                  <span className="min-w-0 flex-1 basis-56 font-medium text-ink">{c.title}</span>
                  <span className="text-sm text-muted-foreground">{c.typeLabel}</span>
                  <ClassificationBadge level={c.classification} size="sm" info={false} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
