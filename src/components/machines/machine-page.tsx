import type { ReactNode } from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, Printer, TriangleAlert } from "lucide-react";
import { ClassificationBadge } from "@/components/app/classification-badge";
import type { MachineCardVM, MachineDetailVM, MachineEventVM, MachineQrVM, SetupSheetVM } from "@/lib/data/machines";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MachineQr } from "./machine-qr";
import { CardStatusBadge, EventKindChip, SheetStatusBadge } from "./status-chips";

/*
 * Machine page building blocks (PLAN.md §8.6). Mobile-first: one column on a phone at the machine, with 64 px
 * actions; a side column for the QR and unit facts from lg. Presentational only (view models come in as props).
 */

/** 64 px action (PLAN.md §10: machine-page actions). */
export const MACHINE_ACTION =
  "inline-flex min-h-16 w-full items-center justify-center gap-2 rounded-md px-5 text-base font-medium transition-colors";

export function MachineSection({
  id,
  title,
  count,
  description,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="min-w-0 scroll-mt-24 rounded-lg border bg-card p-4 shadow-xs sm:p-5">
      <h2 id={`${id}-heading`} className="flex flex-wrap items-baseline gap-x-2 text-xl text-ink">
        {title}
        {typeof count === "number" ? (
          <span className="text-base font-medium text-muted-foreground tabular-nums">
            <span className="sr-only">(</span>
            {formatNumber(count)}
            <span className="sr-only">)</span>
          </span>
        ) : null}
      </h2>
      {description ? <div className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</div> : null}
      <div className="mt-4 flex flex-col gap-5">{children}</div>
    </section>
  );
}

export function SubHeading({ children, count }: { children: ReactNode; count: number }) {
  return (
    <h3 className="mb-2 flex items-baseline gap-2 text-base font-semibold text-ink">
      {children}
      <span className="text-sm font-medium text-muted-foreground tabular-nums">
        <span className="sr-only">(</span>
        {formatNumber(count)}
        <span className="sr-only">)</span>
      </span>
    </h3>
  );
}

function Nothing({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-input-border px-3 py-3 text-muted-foreground">{children}</p>;
}

/** The title with a trailing chevron that never wraps onto a line of its own (it stays with the last word). */
function TitleWithChevron({ title }: { title: string }) {
  const cut = title.lastIndexOf(" ") + 1;
  return (
    <>
      {title.slice(0, cut)}
      <span className="whitespace-nowrap">
        {title.slice(cut)}
        <ChevronRight aria-hidden="true" className="ml-1 inline size-4 align-[-3px] text-muted-foreground" />
      </span>
    </>
  );
}

/** A linked knowledge card: the whole item opens the card page, so the badge inside is display-only. */
function CardItem({ card }: { card: MachineCardVM }) {
  return (
    <li>
      <Link
        href={`/library/${card.id}`}
        data-card-id={card.id}
        className="group flex min-h-16 flex-col gap-1.5 rounded-md border border-hairline bg-surface px-3 py-3 hover:border-input-border hover:bg-muted/40"
      >
        <span className="font-semibold text-primary underline-offset-4 group-hover:underline">
          <TitleWithChevron title={card.title} />
        </span>
        <span className="text-ink">{card.statement}</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
          <span>
            <span className="sr-only">Contributor: </span>
            {card.contributorName}
          </span>
          <span>Confidence: {card.confidenceLabel}</span>
          <span className="font-mono">{card.id}</span>
          {card.status !== "approved" ? <CardStatusBadge status={card.status} label={card.statusLabel} /> : null}
          <ClassificationBadge level={card.classification} size="sm" info={false} />
        </span>
      </Link>
    </li>
  );
}

export function CardList({ cards, empty, label }: { cards: MachineCardVM[]; empty: string; label: string }) {
  if (cards.length === 0) return <Nothing>{empty}</Nothing>;
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {cards.map((c) => (
        <CardItem key={c.id} card={c} />
      ))}
    </ul>
  );
}

function SheetItem({ sheet }: { sheet: SetupSheetVM }) {
  return (
    <li data-document-id={sheet.id} className="flex flex-col gap-1.5 rounded-md border border-hairline bg-surface px-3 py-3">
      <span className="font-semibold text-ink">{sheet.title}</span>
      <span className="text-sm text-ink">
        {sheet.part ? (
          <>
            <span className="text-muted-foreground">Part </span>
            <span className="font-mono">{sheet.part.partNumber}</span>
            {sheet.part.revision ? ` rev ${sheet.part.revision}` : null}
            <span aria-hidden="true"> · </span>
            <span className="sr-only">, </span>
            {sheet.part.description}
          </>
        ) : (
          <span className="text-muted-foreground">General setup for this machine (no specific part)</span>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
        <SheetStatusBadge status={sheet.status} label={sheet.statusLabel} />
        <span>
          Cites {formatNumber(sheet.citedCardCount)} {sheet.citedCardCount === 1 ? "card" : "cards"}
        </span>
        <span className="font-mono">{sheet.id}</span>
        <ClassificationBadge level={sheet.classification} size="sm" />
      </span>
    </li>
  );
}

export function SheetList({ sheets }: { sheets: SetupSheetVM[] }) {
  if (sheets.length === 0) return <Nothing>No setup sheets for this machine yet.</Nothing>;
  return (
    <ul aria-label="Setup sheets" className="flex flex-col gap-3">
      {sheets.map((s) => (
        <SheetItem key={s.id} sheet={s} />
      ))}
    </ul>
  );
}

function EventItem({ event }: { event: MachineEventVM }) {
  return (
    <li data-event-id={event.id} className="flex flex-col gap-1.5 rounded-md border border-hairline bg-surface px-3 py-3">
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <EventKindChip kind={event.kind} label={event.kindLabel} />
        <time dateTime={event.occurredOn} className="text-sm font-medium text-ink">
          {formatDate(event.occurredOn)}
        </time>
        <ClassificationBadge level={event.classification} size="sm" />
      </span>
      <span className="text-ink">{event.summary}</span>
      {event.job || event.personName ? (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {event.job ? (
            <Link
              href={`/jobs/${event.job.id}`}
              className="inline-flex min-h-tap items-center gap-1 rounded-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Job <span className="font-mono">{event.job.jobNumber}</span>
            </Link>
          ) : null}
          {event.personName ? (
            <span>
              <span className="sr-only">Person: </span>
              {event.personName}
            </span>
          ) : null}
        </span>
      ) : null}
    </li>
  );
}

export function EventList({ events, windowDays }: { events: MachineEventVM[]; windowDays: number }) {
  if (events.length === 0) return <Nothing>Nothing logged on this unit in the last {windowDays} days.</Nothing>;
  return (
    <ul aria-label={`Events in the last ${windowDays} days`} className="flex flex-col gap-3">
      {events.map((e) => (
        <EventItem key={e.id} event={e} />
      ))}
    </ul>
  );
}

function LoopbackHint({ qr }: { qr: MachineQrVM }) {
  if (!qr.loopback) return null;
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-signal-strong" />
      <span>
        This address only works on this computer. To scan from a phone or tablet, set{" "}
        <code className="font-mono text-ink">PUBLIC_BASE_URL</code> to an address that device can reach.
      </span>
    </p>
  );
}

/** QR code (data-testid="machine-qr" on the figure: the inline SVG plus the URL it encodes) and the print action. */
export function QrPanel({ vm }: { vm: MachineDetailVM }) {
  return (
    <section aria-labelledby="qr-heading" className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-xs sm:p-5">
      <h2 id="qr-heading" className="text-xl text-ink">
        QR code
      </h2>
      <p className="text-sm text-muted-foreground">Scan it to open this page on a phone or tablet at the machine.</p>
      <figure data-testid="machine-qr" data-qr-url={vm.qr.url} className="flex flex-col items-center gap-2">
        <MachineQr qr={vm.qr} className="size-44 rounded-sm border border-hairline" />
        <figcaption className="max-w-full text-center font-mono text-sm break-all text-ink">{vm.qr.url}</figcaption>
      </figure>
      <LoopbackHint qr={vm.qr} />
      <Link href={`/machines/${vm.id}/print`} className={cn(MACHINE_ACTION, "bg-primary text-primary-foreground hover:bg-primary/90")}>
        <Printer aria-hidden="true" className="size-5 shrink-0" />
        Print label
      </Link>
    </section>
  );
}

/** Unit facts: make and model, kind, where it sits, when it arrived, what it can do. */
export function MachineFacts({ vm }: { vm: MachineDetailVM }) {
  const rows: [string, ReactNode][] = [
    ["Asset tag", <span key="tag" className="font-mono">{vm.assetTag}</span>],
    ["Make and model", `${vm.make} ${vm.model}`],
    ["Kind", vm.kindLabel],
    ["Location", vm.locationCell ?? "Not recorded"],
    ["Installed", `${vm.yearInstalled} (${vm.acquired === "new" ? "bought new" : "bought used"})`],
  ];
  return (
    <section aria-labelledby="facts-heading" className="rounded-lg border bg-card p-4 shadow-xs sm:p-5">
      <h2 id="facts-heading" className="text-xl text-ink">
        About this unit
      </h2>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {vm.capabilities.length > 0 ? (
        <>
          <h3 className="mt-4 text-sm font-semibold text-ink">Capabilities</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {vm.capabilities.map((c) => (
              <li key={c} className="rounded-full border border-input-border bg-surface px-2.5 py-0.5 text-sm text-ink">
                {c}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/** Link to every card linked to this machine in the Library (a facet, so it may live in the URL). */
export function LibraryAction({ vm }: { vm: MachineDetailVM }) {
  return (
    <Link
      href={`/library?machine=${encodeURIComponent(vm.id)}`}
      className={cn(MACHINE_ACTION, "border border-input-border bg-surface text-ink hover:bg-muted")}
    >
      <BookOpen aria-hidden="true" className="size-5 shrink-0" />
      All cards for this machine
    </Link>
  );
}

/** Jump links to the sections below: the page is long on a phone. */
export function SectionNav({ items }: { items: { id: string; label: string; count?: number }[] }) {
  return (
    <nav aria-label="On this page" className="lg:hidden">
      <ul className="flex flex-wrap gap-2">
        {items.map((i) => (
          <li key={i.id}>
            <a
              href={`#${i.id}`}
              className="inline-flex min-h-tap items-center gap-1.5 rounded-full border border-input-border bg-surface px-3 text-sm font-medium text-ink hover:bg-muted"
            >
              {i.label}
              {typeof i.count === "number" ? <span className="text-muted-foreground tabular-nums">{formatNumber(i.count)}</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
