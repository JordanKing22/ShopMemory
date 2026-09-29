import Link from "next/link";
import { BookOpen, Wrench } from "lucide-react";
import { ClassificationBadge } from "@/components/app/classification-badge";
import type { LinkedCardVM, MachineEventVM, ReasoningLogVM, RelatedQuoteVM } from "@/lib/data/jobs";
import { formatDate, formatHours, formatNumber } from "@/lib/format";
import { Fact } from "./job-section";
import { OutcomeValue } from "./outcome-value";
import { StatusChip } from "./status-chip";
import { VarianceValue } from "./variance-value";

/** Cards linked to this job or its quote (card_links), each opening its Library page. */
export function LinkedCardList({ cards }: { cards: LinkedCardVM[] }) {
  return (
    <ul data-testid="job-linked-cards" className="flex flex-col gap-2">
      {cards.map((c) => (
        <li key={c.id}>
          <Link
            href={c.href}
            data-card-id={c.id}
            className="flex min-h-tap items-start gap-3 rounded-md border bg-surface px-3 py-2.5 hover:border-primary"
          >
            <BookOpen aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium break-words text-primary">{c.title}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span className="font-mono">{c.id}</span>
                <span aria-hidden="true">·</span>
                <span>{c.typeLabel}</span>
                <span aria-hidden="true">·</span>
                <span>Contributed by {c.contributor.name}</span>
                {c.status !== "approved" ? (
                  <span className="rounded-full border border-dashed border-input-border px-2 leading-5 text-ink">{c.statusLabel}</span>
                ) : null}
              </span>
              {c.mention ? <span className="mt-0.5 block text-sm text-ink italic">&ldquo;{c.mention}&rdquo;</span> : null}
              <span className="mt-1.5 block">
                <ClassificationBadge level={c.classification} size="sm" info={false} />
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Machine events recorded against this job (issues, alarms, crashes…), newest first. */
export function MachineEventList({ events }: { events: MachineEventVM[] }) {
  return (
    <ol data-testid="job-machine-events" className="flex flex-col gap-3">
      {events.map((e) => (
        <li key={e.id} className="rounded-md border bg-surface px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-medium text-ink">{formatDate(e.occurredOn)}</span>
            <span aria-hidden="true" className="text-muted-foreground">
              ·
            </span>
            <span className="text-ink">{e.kindLabel}</span>
            <span aria-hidden="true" className="text-muted-foreground">
              ·
            </span>
            <Link
              href={`/machines/${encodeURIComponent(e.machine.id)}`}
              className="inline-flex min-h-tap items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
            >
              <Wrench aria-hidden="true" className="size-4 shrink-0" />
              {e.machine.name}
            </Link>
            <ClassificationBadge level={e.classification} size="sm" />
          </div>
          <p className="mt-1 text-ink">{e.summary}</p>
        </li>
      ))}
    </ol>
  );
}

function confidenceText(n: number | null): string {
  return n === null ? "Not stated" : `${formatNumber(n)} of 5`;
}

/** The quoter's own reasoning, captured by the Quote Reasoning Log (seeded in this demo). */
export function ReasoningLog({ log }: { log: ReasoningLogVM }) {
  const rows: [string, string | null][] = [
    ["What drove the number most", log.mainDriver],
    ["Why this machine", log.machineRationale],
    ["How the hours were built", log.hoursRationale],
    ["What would change the quote", log.whatWouldChange],
    ["What a newer quoter would miss", log.juniorWouldMiss],
  ];
  return (
    <article data-testid="job-reasoning-log" className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span>
          By{" "}
          <Link href={`/people/${encodeURIComponent(log.person.id)}`} className="inline-flex min-h-tap items-center font-medium text-primary underline-offset-4 hover:underline">
            {log.person.name}
          </Link>
        </span>
        <span aria-hidden="true">·</span>
        <span>Recorded {formatDate(log.createdAt)}</span>
        <ClassificationBadge level={log.classification} size="sm" />
      </div>
      <dl className="space-y-3">
        {rows
          .filter((r): r is [string, string] => !!r[1])
          .map(([label, text]) => (
            <Fact key={label} label={label}>
              {text}
            </Fact>
          ))}
        {log.riskPricedIn ? (
          <Fact label="Risk priced in">
            <span>{log.riskPricedIn}</span>
            {log.riskBucketLabel ? (
              <span className="mt-1 block text-sm text-muted-foreground">
                Priced in as: <span className="font-medium text-ink">{log.riskBucketLabel}</span>
              </span>
            ) : null}
          </Fact>
        ) : null}
        <Fact label="Quoter's confidence">{confidenceText(log.confidence1to5)}</Fact>
        {log.varianceReview ? <Fact label="Variance review (after the job shipped)">{log.varianceReview}</Fact> : null}
      </dl>
    </article>
  );
}

/** Other quotes for the same part (repeat orders), newest first. Outcomes stay gated. */
export function RelatedQuoteList({ quotes }: { quotes: RelatedQuoteVM[] }) {
  return (
    <ul data-testid="job-related-quotes" className="flex flex-col gap-2">
      {quotes.map((q) => (
        <li key={q.quoteId} data-quote-id={q.quoteId} className="rounded-md border bg-surface px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={q.href} className="inline-flex min-h-tap items-center font-semibold text-primary underline-offset-4 hover:underline">
              {q.quoteNumber}
            </Link>
            {q.jobNumber ? <span className="text-sm text-muted-foreground">Job {q.jobNumber}</span> : null}
            <ClassificationBadge level={q.classification} size="sm" info={false} />
          </div>
          <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <Fact label="Quoted">
              {formatDate(q.quotedOn)} by {q.quotedBy.name}
            </Fact>
            <Fact label="Qty · quoted">
              {formatNumber(q.qty)} · {formatHours(q.quotedHours)}
            </Fact>
            <Fact label="Actual · variance">
              <span className="flex flex-wrap items-center gap-x-2">
                <span>{formatHours(q.actualHours)}</span>
                <VarianceValue pct={q.variancePct} />
              </span>
            </Fact>
            <Fact label="Status · outcome">
              <span className="flex flex-wrap items-center gap-2">
                <StatusChip status={q.status} label={q.statusLabel} />
                <OutcomeValue outcome={q.outcome} compact />
              </span>
            </Fact>
          </dl>
        </li>
      ))}
    </ul>
  );
}
