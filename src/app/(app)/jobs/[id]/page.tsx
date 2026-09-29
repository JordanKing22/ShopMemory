import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClassificationBadge } from "@/components/app/classification-badge";
import { ExportControlledBanner } from "@/components/app/export-controlled-banner";
import { GatedValue } from "@/components/app/hidden-field";
import { PageHeader } from "@/components/app/page-header";
import { FinancialsSection } from "@/components/jobs/financials";
import { HoursBar } from "@/components/jobs/hours-bar";
import { LinkedCardList, MachineEventList, ReasoningLog, RelatedQuoteList } from "@/components/jobs/job-extras";
import { ChipList, Fact, JobSection } from "@/components/jobs/job-section";
import { OutcomeValue } from "@/components/jobs/outcome-value";
import { StatusChip } from "@/components/jobs/status-chip";
import type { JobDetailVM } from "@/lib/data/jobs";
import { formatDate, formatHours, formatNumber } from "@/lib/format";
import { getJobDetail } from "@/server/queries/jobs";

type Params = { id: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  const vm = await getJobDetail(id);
  return { title: vm ? `${vm.title} · Jobs` : "Job not found" };
}

/** 126.25 → "126.25", 58 → "58" (no locale). */
function num(n: number): string {
  const digits = Number.isInteger(n) ? 0 : Number.isInteger(n * 10) ? 1 : 2;
  return formatNumber(n, digits);
}

/** Inch dimensions keep their meaningful decimals: 0.035 → "0.035 in", 0.0005 → "0.0005 in" (locale-free). */
function inches(n: number | null): string {
  return n === null ? "—" : `${Number(n.toFixed(4)).toString()} in`;
}

function PersonLink({ person }: { person: { id: string; name: string } | null }) {
  if (!person) return <span className="text-muted-foreground">—</span>;
  return (
    <Link href={`/people/${encodeURIComponent(person.id)}`} className="inline-flex min-h-tap items-center font-medium text-primary underline-offset-4 hover:underline">
      {person.name}
    </Link>
  );
}

function MachineLink({ machine }: { machine: { id: string; name: string; assetTag: string } | null }) {
  if (!machine) return <span className="text-muted-foreground">—</span>;
  return (
    <span>
      <Link href={`/machines/${encodeURIComponent(machine.id)}`} className="inline-flex min-h-tap items-center font-medium text-primary underline-offset-4 hover:underline">
        {machine.name}
      </Link>
      {machine.assetTag ? <span className="block text-sm text-muted-foreground">{machine.assetTag}</span> : null}
    </span>
  );
}

/** A note when a record's label was changed by hand (e.g. J-A09, lowered with a logged reason). */
function OverrideNote({ vm }: { vm: JobDetailVM }) {
  const rec = [vm.job, vm.quote].find((r) => r !== null && r.classificationSource !== "derived");
  if (!rec) return null;
  const verb = rec.classificationSource === "override_down" ? "lowered" : "raised";
  return (
    <p data-testid="classification-override" className="mb-6 rounded-md border border-input-border bg-surface-sunken px-4 py-3 text-sm text-ink">
      <span className="font-semibold">Label {verb} by hand.</span> This record&rsquo;s classification was {verb} from the level derived from its
      links.{rec.classificationReason ? <> Reason on file: {rec.classificationReason}</> : null}
    </p>
  );
}

function onTimeText(v: boolean | null): string {
  return v === null ? "—" : v ? "Yes" : "No";
}

function subjectFor(kind: JobDetailVM["kind"]): string {
  return kind === "quote_only" ? "This quote" : kind === "internal" ? "This work order" : "This job";
}

/**
 * One job or quote (PLAN.md §9): part, customer, quote, outcome (owner/quoter), job actuals, the quoted-vs-actual bar,
 * judgment drivers, prices (owner/quoter; hidden pills otherwise), the quote reasoning log, linked cards, machine
 * events and related quotes. Accepts J-… and Q-… IDs; unknown IDs are notFound().
 */
export default async function JobPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const vm = await getJobDetail(id);
  if (!vm) notFound();

  const { part, customer, quote, job } = vm;
  const status = job ? { status: job.status, label: job.statusLabel } : { status: "no_job" as const, label: "No job" };

  return (
    <article data-job-id={vm.id} data-classification={vm.classification} className="mx-auto max-w-7xl">
      {vm.classification === "export_controlled" ? <ExportControlledBanner subject={subjectFor(vm.kind)} className="mb-5" /> : null}

      <PageHeader
        eyebrow={
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-x-1.5">
              <li>
                <Link href="/jobs" className="inline-flex min-h-tap -mx-2 items-center px-2 text-primary underline-offset-4 hover:underline">
                  Jobs
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="font-mono">
                {vm.id}
              </li>
            </ol>
          </nav>
        }
        title={vm.title}
        badges={
          <>
            <ClassificationBadge level={vm.classification} />
            <StatusChip status={status.status} label={status.label} />
          </>
        }
        description={
          <>
            {part.partNumber} rev {part.revision} · {part.description}
            {customer ? (
              <>
                {" "}
                · {customer.name} <span className="text-muted-foreground">(fictional)</span>
              </>
            ) : (
              " · internal"
            )}
          </>
        }
      />

      <OverrideNote vm={vm} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <JobSection id="job-hours" title="Hours" description="Quoted and actual hours are visible to every role.">
            <HoursBar hours={vm.hours} />
          </JobSection>

          {quote ? (
            <JobSection id="job-quote" title={`Quote ${quote.quoteNumber}`} aside={<ClassificationBadge level={quote.classification} size="sm" />}>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                <Fact label="Quoted by">
                  <PersonLink person={quote.quotedBy} />
                </Fact>
                <Fact label="Quoted on">{formatDate(quote.quotedOn)}</Fact>
                <Fact label="Quantity">{formatNumber(quote.qty)}</Fact>
                <Fact label="Primary machine">
                  <MachineLink machine={quote.primaryMachine} />
                </Fact>
                {quote.secondaryMachine ? (
                  <Fact label="Second machine">
                    <MachineLink machine={quote.secondaryMachine} />
                  </Fact>
                ) : null}
                <Fact label="Setup (quoted)">{formatHours(quote.quotedSetupHours)}</Fact>
                <Fact label="Cycle time (quoted)">{num(quote.quotedCycleMinutes)} min per part</Fact>
                <Fact label="Quoted hours">
                  <span className="font-semibold">{formatHours(quote.quotedHours)}</span>
                </Fact>
                <Fact label="Lead time">{quote.leadTimeDays === null ? "—" : `${formatNumber(quote.leadTimeDays)} days`}</Fact>
                <Fact label="Outcome" testId="quote-outcome">
                  <OutcomeValue outcome={vm.outcome} />
                </Fact>
              </dl>
              <dl className="mt-4 space-y-3">
                <Fact label="Judgment drivers">
                  <ChipList chips={vm.judgmentDrivers} label="Judgment drivers" />
                </Fact>
                {quote.quoterNotes ? (
                  <Fact label="Quoter notes" testId="quote-notes">
                    <GatedValue value={quote.quoterNotes}>{(text) => <span className="whitespace-pre-line">{text}</span>}</GatedValue>
                  </Fact>
                ) : null}
              </dl>
            </JobSection>
          ) : null}

          {job ? (
            <JobSection id="job-job" title={`Job ${job.jobNumber}`} aside={<ClassificationBadge level={job.classification} size="sm" />}>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                <Fact label="Status">
                  <StatusChip status={job.status} label={job.statusLabel} />
                </Fact>
                <Fact label="Lead">
                  <PersonLink person={job.lead} />
                </Fact>
                <Fact label="Machine">
                  <MachineLink machine={job.machine} />
                </Fact>
                <Fact label="Started">{job.startedOn ? formatDate(job.startedOn) : "—"}</Fact>
                <Fact label="Shipped">{job.shippedOn ? formatDate(job.shippedOn) : "Not shipped yet"}</Fact>
                <Fact label="On time">{onTimeText(job.onTime)}</Fact>
                <Fact label="Actual setup">{formatHours(job.actualSetupHours)}</Fact>
                <Fact label="Actual run">{formatHours(job.actualRunHours)}</Fact>
                <Fact label="Actual total">
                  <span className="font-semibold">{formatHours(job.actualHours)}</span>
                </Fact>
                <Fact label="Scrapped">{formatNumber(job.scrapQty)}</Fact>
                <Fact label="NCRs">{formatNumber(job.ncrCount)}</Fact>
              </dl>
              {job.debrief ? (
                <dl className="mt-4">
                  <Fact label="Debrief">
                    <span className="whitespace-pre-line">{job.debrief}</span>
                  </Fact>
                </dl>
              ) : null}
            </JobSection>
          ) : (
            <JobSection id="job-job" title="Job">
              <p className="text-muted-foreground">No job has been opened for this quote.</p>
            </JobSection>
          )}

          {vm.reasoningLogs.length > 0 ? (
            <JobSection id="job-reasoning" title="Quote reasoning log" description="The quoter's own reasoning behind the number, in their words.">
              <div className="space-y-6">
                {vm.reasoningLogs.map((log) => (
                  <ReasoningLog key={log.id} log={log} />
                ))}
              </div>
            </JobSection>
          ) : null}

          <JobSection
            id="job-cards"
            title="Linked knowledge cards"
            description={vm.linkedCards.length > 0 ? `Cards that point at this ${vm.kind === "quote_only" ? "quote" : "job or its quote"}.` : undefined}
          >
            {vm.linkedCards.length > 0 ? (
              <LinkedCardList cards={vm.linkedCards} />
            ) : (
              <p className="text-muted-foreground">
                No knowledge cards link to this record yet. Browse the{" "}
                <Link href="/library" className="font-medium text-primary underline-offset-4 hover:underline">
                  Knowledge Library
                </Link>{" "}
                for related know-how.
              </p>
            )}
          </JobSection>

          {job ? (
            <JobSection id="job-events" title="Machine events during this job">
              {vm.machineEvents.length > 0 ? (
                <MachineEventList events={vm.machineEvents} />
              ) : (
                <p className="text-muted-foreground">No machine issues, alarms or repairs were recorded against this job.</p>
              )}
            </JobSection>
          ) : null}

          <JobSection id="job-related" title="Other quotes for this part">
            {vm.relatedQuotes.length > 0 ? (
              <RelatedQuoteList quotes={vm.relatedQuotes} />
            ) : (
              <p className="text-muted-foreground">This is the only {quote ? "quote" : "record"} for this part.</p>
            )}
          </JobSection>
        </div>

        <aside aria-label="Part, customer and prices" className="min-w-0 space-y-6">
          <JobSection id="job-part" title="Part" aside={<ClassificationBadge level={part.classification} size="sm" />}>
            <p className="font-semibold text-ink">
              {part.partNumber} <span className="font-normal text-muted-foreground">rev {part.revision}</span>
            </p>
            <p className="text-ink">{part.description}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact label="Material" className="col-span-2">
                {part.materialName}
              </Fact>
              <Fact label="Family">{part.familyLabel}</Fact>
              <Fact label="Complexity">{formatNumber(part.complexity)} of 5</Fact>
              <Fact label="Min wall">{inches(part.minWallIn)}</Fact>
              <Fact label="Wall height">{inches(part.maxWallHeightIn)}</Fact>
              <Fact label="Tightest tolerance">{inches(part.tightestTolIn)}</Fact>
              <Fact label="Envelope">{part.envelopeIn ? `${part.envelopeIn} in` : "—"}</Fact>
              <Fact label="Features" className="col-span-2">
                <ChipList chips={part.features} label="Part features" />
              </Fact>
              <Fact label="Export-control label" className="col-span-2">
                {part.exportControlLabel}
                <span className="block text-sm text-muted-foreground">A demo label that drives routing, not an export-classification determination.</span>
              </Fact>
              {part.notes ? (
                <Fact label="Notes" className="col-span-2">
                  {part.notes}
                </Fact>
              ) : null}
            </dl>
          </JobSection>

          {customer ? (
            <JobSection id="job-customer" title="Customer" aside={<ClassificationBadge level={customer.classification} size="sm" />}>
              <p className="font-semibold text-ink">
                {customer.name} <span className="font-normal text-muted-foreground">(fictional)</span>
              </p>
              <p className="text-sm text-muted-foreground">
                {customer.industryLabel}
                {customer.isNewCustomer ? " · new customer" : ""}
              </p>
              <dl className="mt-3">
                <Fact label="Documented quality requirements">{customer.qualityRequirements ?? "None documented"}</Fact>
              </dl>
            </JobSection>
          ) : null}

          <FinancialsSection financials={vm.financials} />
        </aside>
      </div>
    </article>
  );
}
