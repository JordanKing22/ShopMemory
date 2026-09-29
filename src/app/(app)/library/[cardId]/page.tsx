import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Info, UserRound } from "lucide-react";
import { ClassificationBadge } from "@/components/app/classification-badge";
import { ExportControlledBanner } from "@/components/app/export-controlled-banner";
import { PageHeader } from "@/components/app/page-header";
import { CardLinks } from "@/components/library/card-links";
import { CardStatusChip } from "@/components/library/card-status-chip";
import { CardTimeline } from "@/components/library/card-timeline";
import { EvidenceList } from "@/components/library/evidence-list";
import type { CardDetailVM } from "@/lib/data/cards";
import { getCardDetail } from "@/server/queries/cards";

type Params = { cardId: string };

/** Generic title (no DB read): card titles can carry customer or export-controlled detail. */
export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { cardId } = await params;
  const id = /^[A-Za-z0-9-]{1,40}$/.test(cardId) ? cardId : "Card";
  return { title: `${id} · Knowledge Library` };
}

function Section({ id, title, children, description }: { id: string; title: string; children: ReactNode; description?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-lg border bg-card p-4 text-card-foreground shadow-xs sm:p-5">
      <h2 id={id} className="text-lg font-semibold text-ink">
        {title}
      </h2>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Bullets({ items, empty }: { items: string[]; empty?: string }) {
  if (items.length === 0) return <p className="text-muted-foreground">{empty ?? "None noted."}</p>;
  return (
    <ul className="list-disc space-y-1.5 pl-5 leading-relaxed marker:text-muted-foreground">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

function coverageNote(card: CardDetailVM): string | null {
  if (card.status === "approved") return null;
  if (card.status === "rejected") return "Rejected: this card doesn't count toward knowledge coverage.";
  if (card.status === "superseded") return "Superseded: a newer version of this card replaces it.";
  return `Not approved yet: this card counts toward knowledge coverage only after ${card.contributor.name} approves it.`;
}

const CONFIDENCE_HELP: Record<CardDetailVM["confidence"], string> = {
  always: "The contributor said this holds every time.",
  usually: "The contributor said this usually holds.",
  sometimes: "The contributor said this holds only sometimes.",
  not_sure: "The contributor wasn't sure this holds.",
  not_stated: "The contributor didn't say how often this holds.",
};

export default async function CardPage({ params }: { params: Promise<Params> }) {
  const { cardId } = await params;
  const card = await getCardDetail(cardId);
  if (!card) notFound();

  const ec = card.classification === "export_controlled";
  const note = coverageNote(card);
  const hasWhen = card.appliesWhen.length > 0 || card.doesNotApplyWhen.length > 0;

  return (
    <article data-card-id={card.id} data-classification={card.classification} className="mx-auto max-w-6xl">
      {ec ? <ExportControlledBanner subject="This card" className="mb-5" /> : null}

      <PageHeader
        eyebrow={
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-x-1.5">
              <li>
                <Link href="/library" className="inline-flex min-h-tap -mx-2 items-center px-2 text-primary underline-offset-4 hover:underline">
                  Knowledge Library
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="font-mono">
                {card.id}
              </li>
            </ol>
          </nav>
        }
        title={card.title}
        badges={
          <>
            <ClassificationBadge level={card.classification} />
            <span className="inline-flex items-center rounded-md border border-input-border bg-surface px-2 py-px text-sm leading-5 font-medium text-ink">
              {card.typeLabel}
            </span>
            <CardStatusChip status={card.status} label={card.statusLabel} />
          </>
        }
      />

      {note ? (
        <p role="note" className="mb-5 flex items-start gap-2 rounded-md border border-signal-strong bg-signal-tint px-4 py-3 text-sm text-ink">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-signal-strong" />
          {note}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <Link
            data-testid="card-contributor"
            href={`/people/${card.contributor.id}`}
            className="flex min-h-tap items-center gap-3 rounded-lg border bg-card p-3 text-card-foreground shadow-xs hover:border-primary sm:p-4"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-primary">
              <UserRound aria-hidden="true" className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-ink">Contributed by {card.contributor.name}</span>
              <span className="block text-sm text-muted-foreground">
                {card.contributor.jobTitle}
                {card.isMine ? " · you" : ""}
              </span>
            </span>
          </Link>

          <Section id="card-statement" title="Statement">
            <p className="text-lg leading-relaxed text-ink">{card.statement}</p>
          </Section>

          {hasWhen ? (
            <Section id="card-when" title="When it applies">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="mb-1.5 text-sm font-semibold text-ink">Applies when</h3>
                  <Bullets items={card.appliesWhen} />
                </div>
                <div>
                  <h3 className="mb-1.5 text-sm font-semibold text-ink">Doesn&apos;t apply when</h3>
                  <Bullets items={card.doesNotApplyWhen} />
                </div>
              </div>
            </Section>
          ) : null}

          {card.thresholds.length > 0 ? (
            <Section id="card-thresholds" title="Numbers" description="In the contributor's words, next to the normalized value.">
              <ul className="space-y-3">
                {card.thresholds.map((t, i) => (
                  <li key={i} className="rounded-md border bg-surface p-3">
                    <p className="text-sm text-muted-foreground">{t.quantity}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink">
                      <q className="italic">{t.verbatim}</q>
                      {t.normalized ? (
                        <>
                          <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                          <span className="sr-only">normalized:</span>
                          <span className="font-mono font-semibold">{t.normalized}</span>
                        </>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {card.rationale ? (
            <Section id="card-rationale" title="Why">
              <p className="leading-relaxed">{card.rationale}</p>
            </Section>
          ) : null}

          {card.cues.length > 0 ? (
            <Section id="card-cues" title="What you'll notice">
              <Bullets items={card.cues} />
            </Section>
          ) : null}

          {card.actions.length > 0 ? (
            <Section id="card-actions" title="What to do">
              <Bullets items={card.actions} />
            </Section>
          ) : null}

          {card.commonMistake ? (
            <Section id="card-mistake" title="Common mistake">
              <p className="leading-relaxed">{card.commonMistake}</p>
            </Section>
          ) : null}

          {card.openQuestions.length > 0 ? (
            <Section id="card-open-questions" title="Open questions">
              <Bullets items={card.openQuestions} />
            </Section>
          ) : null}

          <Section
            id="card-evidence-heading"
            title="Evidence"
            description={`The exact words this card relies on, highlighted inside what ${card.contributor.name} said.`}
          >
            <EvidenceList evidence={card.evidence} />
          </Section>
        </div>

        <aside aria-label="Card details" className="min-w-0 space-y-6">
          <Section id="card-status" title="Status">
            <CardTimeline events={card.timeline} />
          </Section>

          <Section id="card-confidence" title="Expert confidence">
            <p className="font-semibold text-ink">{card.confidenceLabel}</p>
            <p className="mt-1 text-sm text-muted-foreground">{CONFIDENCE_HELP[card.confidence]}</p>
          </Section>

          {card.topics.length > 0 ? (
            <Section id="card-topics" title="Topics">
              <ul className="flex flex-wrap gap-2">
                {card.topics.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/library?topic=${encodeURIComponent(t.id)}`}
                      className="inline-flex min-h-tap items-center rounded-full border border-input-border bg-surface px-3 text-sm text-ink hover:border-primary"
                    >
                      {t.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section id="card-links" title="Linked records">
            {card.links.length > 0 ? (
              <CardLinks links={card.links} />
            ) : (
              <p className="text-sm text-muted-foreground">No linked jobs, quotes, machines or customers.</p>
            )}
          </Section>

          {card.tags.length > 0 ? (
            <Section id="card-tags" title="Tags">
              <p className="text-sm text-ink">{card.tags.join(" · ")}</p>
            </Section>
          ) : null}

          <Section id="card-version" title="Version">
            <p className="text-sm text-ink">
              Version {card.version}
              {card.supersedesId ? (
                <>
                  {" "}
                  · replaces{" "}
                  <Link href={`/library/${card.supersedesId}`} className="font-mono text-primary underline-offset-4 hover:underline">
                    {card.supersedesId}
                  </Link>
                </>
              ) : (
                " · no earlier versions"
              )}
            </p>
            {card.classificationOverride ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Classification {card.classificationOverride.direction === "up" ? "raised" : "lowered"} by hand
                {card.classificationOverride.reason ? `: ${card.classificationOverride.reason}` : "."}
              </p>
            ) : null}
          </Section>
        </aside>
      </div>
    </article>
  );
}
