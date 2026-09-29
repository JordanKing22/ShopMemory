import Link from "next/link";
import { ClassificationBadge } from "@/components/app/classification-badge";
import type { CardRowVM } from "@/lib/data/cards";
import { CardStatusChip } from "./card-status-chip";

/**
 * One Knowledge Library result. The title link is stretched over the whole row (after:inset-0), so the row is one
 * tap target without nesting controls; the classification badge is therefore non-interactive (info={false}).
 */
export function CardRow({ row }: { row: CardRowVM }) {
  return (
    <li
      data-testid={`card-result-${row.id}`}
      data-status={row.status}
      data-classification={row.classification}
      className="relative rounded-lg border bg-card p-4 text-card-foreground shadow-xs transition-colors hover:border-primary has-[a:focus-visible]:border-primary"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h3 className="min-w-0 flex-1 basis-64 text-base leading-snug font-semibold text-ink">
          <Link href={`/library/${row.id}`} className="rounded-sm after:absolute after:inset-0 after:rounded-lg hover:underline">
            {row.title}
          </Link>
        </h3>
        <ClassificationBadge level={row.classification} size="sm" info={false} />
      </div>
      <dl className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
        <div>
          <dt className="sr-only">Card ID</dt>
          <dd className="font-mono">{row.id}</dd>
        </div>
        <div>
          <dt className="sr-only">Type</dt>
          <dd>{row.typeLabel}</dd>
        </div>
        <div>
          <dt className="sr-only">Contributor</dt>
          <dd className="text-ink">
            {row.contributor.name}
            {row.isMine ? <span className="text-muted-foreground"> (you)</span> : null}
          </dd>
        </div>
        <div>
          <dt className="sr-only">Expert confidence</dt>
          <dd>Confidence: {row.confidenceLabel}</dd>
        </div>
        <div className="max-w-full">
          <dt className="sr-only">Status</dt>
          <dd>
            <CardStatusChip status={row.status} label={row.statusLabel} />
          </dd>
        </div>
      </dl>
      {row.topics.length > 0 ? (
        <div className="mt-3">
          <span className="sr-only">Topics:</span>
          <ul className="flex flex-wrap gap-1.5">
            {row.topics.map((t) => (
              <li key={t.id} className="rounded-full bg-surface-sunken px-2 py-px text-sm text-ink">
                {t.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}
