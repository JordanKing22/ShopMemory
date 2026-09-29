import Link from "next/link";
import { RiskBandChip } from "@/components/app/risk-band-chip";
import { SpofFlag } from "@/components/app/spof-flag";
import type { PersonTopicGroupVM, PersonTopicVM } from "@/lib/data/people";
import { CoverageMeter } from "./coverage-meter";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function TopicRow({ topic }: { topic: PersonTopicVM }) {
  const hasCards = topic.approvedCardCount + topic.pendingCardCount > 0;
  return (
    <li
      data-testid={`person-topic-${topic.topicId}`}
      data-band={topic.band}
      data-spof={topic.spof ? "true" : "false"}
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
    >
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-medium text-ink">{topic.label}</p>
        <p className="text-sm text-muted-foreground">
          {topic.categoryLabel}
          <span aria-hidden="true"> · </span>
          <span className="sr-only">, </span>
          {plural(topic.approvedCardCount, "approved card", "approved cards")}
          {topic.pendingCardCount > 0 ? (
            <>
              <span aria-hidden="true"> · </span>
              <span className="sr-only">, </span>
              {topic.pendingCardCount} pending
            </>
          ) : null}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <CoverageMeter pct={topic.capturedPct} suffix="captured" />
        <RiskBandChip band={topic.band} score={topic.risk} size="sm" />
        {topic.spof ? <SpofFlag size="sm" /> : null}
        {hasCards ? (
          <Link
            href={topic.libraryHref}
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Cards<span className="sr-only"> on {topic.shortLabel}</span>
          </Link>
        ) : null}
      </div>
    </li>
  );
}

/** "Topics held", grouped by level (3 deep → 1 working), each with captured share and cell risk. */
export function PersonTopicGroups({ groups }: { groups: PersonTopicGroupVM[] }) {
  if (groups.length === 0) return <p className="text-muted-foreground">No topics are assessed for this person yet.</p>;
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.level} data-level={g.level}>
          <h3 className="flex flex-wrap items-baseline gap-x-2 font-semibold text-ink">
            <span>Level {g.level}</span>
            <span className="text-sm font-normal text-muted-foreground">
              {g.label} · {plural(g.topics.length, "topic", "topics")}
            </span>
          </h3>
          <ul className="divide-y divide-hairline">
            {g.topics.map((t) => (
              <TopicRow key={t.topicId} topic={t} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
