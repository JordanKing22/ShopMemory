"use client";

import { useId } from "react";
import Link from "next/link";
import { BookOpen, Mic, UserRound } from "lucide-react";
import { ClassificationBadge } from "@/components/app/classification-badge";
import { HiddenField } from "@/components/app/hidden-field";
import { RiskBandChip, RISK_BAND_LABEL } from "@/components/app/risk-band-chip";
import { SpofFlag } from "@/components/app/spof-flag";
import { Button } from "@/components/ui/button";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { RiskCardRef, RiskCellVM, RiskPersonVM, RiskTopicVM } from "@/lib/data/risk";
import { MINUS, formatNumber } from "@/lib/format";
import { CARD_TYPE_LABEL, LEVEL_LABEL, LEVEL_SHORT, approvedCardsText, departureChipText, explainCell } from "./copy";

export interface CellSheetBodyProps {
  cell: RiskCellVM;
  person: RiskPersonVM;
  topic: RiskTopicVM;
  cards: Record<string, RiskCardRef>;
  /** Names of the other holders at the best backup level B (empty when B = 0). */
  backupNames: string[];
  /** True when delta mode has a baseline that differs for this cell. */
  changed: boolean;
}

const fixed2 = (n: number) => formatNumber(n, 2);

/**
 * Body of the cell sheet (PLAN.md §8.1): why the score is what it is, the inputs behind it, the approved cards, the
 * pending drafts, and the next actions. Rendered inside <SheetContent data-testid="risk-cell-sheet">.
 *
 * U, T and D are gated values: the machinist/trainee view model has no number for them, only the "Hidden for … role"
 * label (T and D are hidden with U because, with risk, E and f on screen, either would let U be solved for). For
 * those roles the equation is shown in symbols, never with rounded factors.
 */
export function CellSheetBody({ cell, person, topic, cards, backupNames, changed }: CellSheetBodyProps) {
  const noteId = useId();
  const inputsId = useId();
  const cardsId = useId();
  const approved = cell.approvedCardIds.map((id) => cards[id]).filter((c): c is RiskCardRef => Boolean(c));
  const { U, T, D } = cell.factors;
  const factorsHidden = U.hidden || T.hidden || D.hidden;
  const libraryHref = `/library?person=${encodeURIComponent(person.id)}&topic=${encodeURIComponent(topic.id)}`;
  const f = cell.capturedPct / 100;

  let uDetail = "";
  if (!person.departure.hidden) {
    uDetail = person.departure.value ? departureChipText(person.departure.value).toLowerCase() : "no planned departure";
  }

  return (
    <>
      <SheetHeader className="gap-2 border-b pr-14">
        <p className="text-sm font-medium text-muted-foreground">Knowledge risk · estimate</p>
        <SheetTitle className="text-xl leading-tight">
          {person.fullName} <span className="text-muted-foreground">×</span> {topic.label}
        </SheetTitle>
        <SheetDescription className="text-ink">{explainCell(person.firstName, topic.shortLabel, cell)}</SheetDescription>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <RiskBandChip band={cell.band} score={cell.risk} />
          {cell.spof ? <SpofFlag size="sm" /> : null}
        </div>
        {changed && cell.before ? (
          <p className="text-sm text-muted-foreground">
            At the last reset: risk {cell.before.risk} ({RISK_BAND_LABEL[cell.before.band]}) · {formatNumber(cell.before.capturedPct, 0)} % captured
          </p>
        ) : null}
      </SheetHeader>

      <div className="flex flex-col gap-6 p-4">
        <section aria-labelledby={inputsId}>
          <h3 id={inputsId} className="mb-2 font-semibold text-ink">
            Inputs behind the score
          </h3>
          <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,auto)] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Expertise level E</dt>
            <dd className="text-right text-ink">
              <span className="font-semibold tabular-nums">{cell.level}</span> · {LEVEL_LABEL[cell.level]}
            </dd>
            <dt className="text-muted-foreground">Approved-card points C</dt>
            <dd className="text-right font-semibold tabular-nums text-ink">{formatNumber(cell.capturedPoints, 2)}</dd>
            <dt className="text-muted-foreground">Captured f = C ÷ (4 × E)</dt>
            <dd className="text-right font-semibold tabular-nums text-ink">{formatNumber(cell.capturedPct, 0)} %</dd>
            <dt className="text-muted-foreground">Departure factor U</dt>
            <dd data-testid="risk-factor-departure" className="flex justify-end text-right text-ink">
              {U.hidden ? (
                <HiddenField label={U.label} />
              ) : (
                <span>
                  <span className="font-semibold tabular-nums">{fixed2(U.value)}</span>
                  {uDetail ? <span className="text-muted-foreground"> ({uDetail})</span> : null}
                </span>
              )}
            </dd>
            <dt className="text-muted-foreground">Tenure factor T</dt>
            <dd data-testid="risk-factor-tenure" className="flex flex-wrap items-center justify-end gap-x-1 text-right text-ink">
              {T.hidden ? <HiddenField label={T.label} /> : <span className="font-semibold tabular-nums">{fixed2(T.value)}</span>}
              <span className="text-muted-foreground">({person.tenureLabel})</span>
            </dd>
            <dt className="text-muted-foreground">Best backup level B</dt>
            <dd className="text-right text-ink">
              <span className="font-semibold tabular-nums">{cell.factors.B}</span> · {LEVEL_SHORT[cell.factors.B as 0 | 1 | 2 | 3] ?? "none"}
              {backupNames.length > 0 ? <span className="block text-muted-foreground">{backupNames.join(", ")}</span> : null}
            </dd>
            <dt className="text-muted-foreground">Backup discount D</dt>
            <dd data-testid="risk-factor-backup" className="flex justify-end text-right text-ink">
              {D.hidden ? <HiddenField label={D.label} /> : <span className="font-semibold tabular-nums">{fixed2(D.value)}</span>}
            </dd>
            <dt className="font-medium text-ink">Risk</dt>
            <dd className="text-right font-semibold tabular-nums text-ink">
              {cell.risk} · {RISK_BAND_LABEL[cell.band]}
            </dd>
          </dl>
          <p data-testid="risk-equation" className="mt-3 rounded-md bg-surface-sunken px-3 py-2 font-mono text-sm leading-6 break-words text-ink">
            {factorsHidden ? (
              <>
                100 × (E/3) × (1 {MINUS} f) × U × T × D ≈ {cell.risk}
              </>
            ) : (
              <>
                100 × ({cell.level}/3) × (1 {MINUS} {fixed2(f)}) × {fixed2(U.value)} × {fixed2(T.value)} × {fixed2(D.value)} ≈ {cell.risk}
              </>
            )}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {factorsHidden
              ? "A transparent estimate, not a validated instrument. The departure factor, and the tenure and backup factors that would reveal it, are hidden for your role."
              : "Factors are rounded to two decimals. A transparent estimate, not a validated instrument."}
          </p>
        </section>

        <section aria-labelledby={cardsId}>
          <h3 id={cardsId} className="mb-2 font-semibold text-ink">
            Approved cards ({approved.length})
          </h3>
          {approved.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {person.firstName} has {approvedCardsText(0)} on this topic yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {approved.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/library/${encodeURIComponent(c.id)}`}
                    className="flex min-h-tap flex-col gap-1 rounded-md border border-hairline px-3 py-2 hover:bg-accent"
                  >
                    <span className="text-sm font-medium text-ink">{c.title}</span>
                    <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <span className="font-mono">{c.id}</span>
                      <span>{CARD_TYPE_LABEL[c.type]}</span>
                      <ClassificationBadge level={c.classification} size="sm" info={false} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-sm text-muted-foreground">
            {cell.pendingCount === 0
              ? "No drafts pending review."
              : `${cell.pendingCount} draft${cell.pendingCount === 1 ? "" : "s"} pending review (not counted until approved).`}
          </p>
        </section>

        <section aria-label="Next steps" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start gap-3">
            <Button asChild variant="outline" className="border-input-border">
              <Link href={libraryHref}>
                <BookOpen aria-hidden="true" />
                Open in Library
              </Link>
            </Button>
            <div className="flex flex-col gap-1">
              <Button type="button" disabled aria-describedby={noteId}>
                <Mic aria-hidden="true" />
                Interview {person.firstName}
              </Button>
              <p id={noteId} className="text-sm text-muted-foreground">
                Interviews arrive in Phase 5
              </p>
            </div>
          </div>
          <Link
            href={`/people/${encodeURIComponent(person.id)}`}
            className="inline-flex min-h-tap w-fit items-center gap-2 rounded-md text-sm font-medium text-primary underline"
          >
            <UserRound aria-hidden="true" className="size-4" />
            {person.firstName}&rsquo;s profile
          </Link>
        </section>
      </div>
    </>
  );
}
