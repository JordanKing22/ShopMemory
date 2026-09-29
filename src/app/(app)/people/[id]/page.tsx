import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { ClassificationBadge } from "@/components/app/classification-badge";
import { PageHeader } from "@/components/app/page-header";
import { RiskBandChip } from "@/components/app/risk-band-chip";
import { SpofFlag } from "@/components/app/spof-flag";
import { StatTile } from "@/components/app/stat-tile";
import { PersonCardGroups } from "@/components/people/card-groups";
import { DepartureValue } from "@/components/people/departure-value";
import { PersonInterviewList } from "@/components/people/interview-list";
import { ProfileSection } from "@/components/people/section";
import { PersonTopicGroups } from "@/components/people/topic-groups";
import { formatDate, formatNumber, formatPct } from "@/lib/format";
import { getPersonProfile } from "@/server/queries/people";

type Params = { id: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  const person = await getPersonProfile(id);
  return { title: person ? `${person.fullName} · People` : "Person not found" };
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}

function priorExperience(years: number): string | null {
  if (!(years > 0)) return null;
  const text = formatNumber(years, Number.isInteger(years) ? 0 : 1);
  return `plus ${text} ${years === 1 ? "year" : "years"} before joining`;
}

/**
 * Person profile (PLAN.md §9): header facts with the role-gated planned departure (PLAN.md §4.8), knowledge captured
 * (deep coverage, PLAN.md §6), topics held by level, cards by status, interviews given, and jobs/quotes counts.
 * Unknown IDs and the persona-only owner are notFound().
 */
export default async function PersonPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const person = await getPersonProfile(id);
  if (!person) notFound();

  const prior = priorExperience(person.priorExperienceYears);
  const { coverage, topRisk, work } = person;

  return (
    <article data-person-id={person.id} className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow={
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-x-1.5">
              <li>
                <Link href="/people" className="inline-flex min-h-tap -mx-2 items-center px-2 text-primary underline-offset-4 hover:underline">
                  People
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="font-mono">
                {person.id}
              </li>
            </ol>
          </nav>
        }
        title={person.fullName}
        badges={
          <>
            <ClassificationBadge level={person.classification} />
            {person.isMe ? <span className="rounded-full bg-accent px-2.5 py-0.5 text-sm font-medium text-ink">You</span> : null}
          </>
        }
        description={person.bio ?? undefined}
      />

      <dl className="mb-6 grid gap-x-8 gap-y-4 rounded-lg border bg-card p-4 text-card-foreground shadow-xs sm:grid-cols-2 sm:p-5 xl:grid-cols-4">
        <Fact label="Job title">{person.jobTitle}</Fact>
        <Fact label="Department">{person.departmentLabel}</Fact>
        <Fact label="Tenure">
          <span className="font-medium">{person.tenureLongLabel}</span>
          <span className="block text-sm text-muted-foreground">
            Hired {formatDate(person.hireDate)}
            {prior ? `, ${prior}` : ""}
          </span>
        </Fact>
        <Fact label="Planned departure">
          <DepartureValue departure={person.departure} />
        </Fact>
      </dl>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <ProfileSection
            id="person-captured"
            title="Knowledge captured"
            description="Estimates from approved cards only. Drafts and cards waiting for review don't count until they're approved."
            aside={
              <Link href="/risk" className="inline-flex min-h-tap items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
                Knowledge Risk map
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            }
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <div data-testid="person-deep-coverage">
                <StatTile
                  tone="signal"
                  label="Deep coverage"
                  value={coverage.deepCoveragePct === null ? "—" : formatPct(coverage.deepCoveragePct)}
                  sub={
                    coverage.deepTopicCount > 0
                      ? `of the know-how on ${coverage.deepTopicCount} level-3 ${coverage.deepTopicCount === 1 ? "topic" : "topics"}`
                      : "No level-3 topics"
                  }
                />
              </div>
              <StatTile
                label="Captured, all topics"
                value={coverage.capturedPct === null ? "—" : formatPct(coverage.capturedPct)}
                sub={`across ${coverage.topicCount} ${coverage.topicCount === 1 ? "topic" : "topics"} held`}
              />
              <StatTile
                label="Approved cards"
                value={formatNumber(coverage.approvedCardCount)}
                sub={coverage.pendingCardCount > 0 ? `${coverage.pendingCardCount} more waiting for approval` : "none waiting for approval"}
              />
            </div>
            {topRisk ? (
              <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 text-ink">
                <span className="text-muted-foreground">Highest risk:</span>
                <span className="font-medium">{topRisk.topicLabel}</span>
                <RiskBandChip band={topRisk.band} score={topRisk.risk} size="sm" />
                {topRisk.spof ? <SpofFlag size="sm" /> : null}
              </p>
            ) : null}
          </ProfileSection>

          <ProfileSection
            id="person-topics"
            title="Topics held"
            description={`Grouped by ${person.firstName}'s expertise level, as assessed by the shop. Captured share and risk are the same numbers as the Knowledge Risk map.`}
          >
            <PersonTopicGroups groups={person.topicGroups} />
          </ProfileSection>

          <ProfileSection id="person-cards" title="Cards" description={`Knowledge cards credited to ${person.firstName}.`}>
            <PersonCardGroups groups={person.cardGroups} firstName={person.firstName} />
          </ProfileSection>
        </div>

        {/* A plain column, not <aside>: a complementary landmark nested inside <main> fails axe's landmark rules. */}
        <div className="min-w-0 space-y-6">
          <ProfileSection id="person-interviews" title="Interviews given">
            <PersonInterviewList interviews={person.interviews} handEnteredCardCount={person.handEnteredCardCount} firstName={person.firstName} />
          </ProfileSection>

          <ProfileSection id="person-work" title="Jobs and quotes">
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-md border bg-surface px-3 py-2">
                <dt className="text-sm text-muted-foreground">Jobs led</dt>
                <dd className="text-2xl font-semibold text-ink tabular-nums">{formatNumber(work.jobsLed)}</dd>
              </div>
              <div className="rounded-md border bg-surface px-3 py-2">
                <dt className="text-sm text-muted-foreground">Quotes prepared</dt>
                <dd className="text-2xl font-semibold text-ink tabular-nums">{formatNumber(work.quotesPrepared)}</dd>
              </div>
            </dl>
            {work.jobsLed + work.quotesPrepared > 0 ? (
              <Link
                href={work.jobsHref}
                className="mt-3 inline-flex min-h-tap items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
              >
                View {person.firstName}&apos;s jobs and quotes
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No jobs led or quotes prepared in the demo data.</p>
            )}
          </ProfileSection>
        </div>
      </div>
    </article>
  );
}
