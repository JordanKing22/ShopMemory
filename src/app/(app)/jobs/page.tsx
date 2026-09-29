import type { Metadata } from "next";
import Link from "next/link";
import { Info } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { HiddenField } from "@/components/app/hidden-field";
import { InfoPopover } from "@/components/app/info-popover";
import { PageHeader } from "@/components/app/page-header";
import { JobFilters } from "@/components/jobs/job-filters";
import { JobsTable } from "@/components/jobs/jobs-table";
import { formatNumber } from "@/lib/format";
import { getJobsPage } from "@/server/queries/jobs";

export const metadata: Metadata = { title: "Jobs and quotes" };

/**
 * Jobs and quotes (PLAN.md §9): every quote with its job, plus the internal work orders, newest first by quoted date.
 * Quoted vs actual hours and variance are visible to every role; win/loss is owner/quoter only (PLAN.md §4.8) and
 * prices never appear in the list. Filters are non-text facets in searchParams.
 */
export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const vm = await getJobsPage(await searchParams);
  const shown = vm.rows.length;

  return (
    <div className="mx-auto flex min-w-0 max-w-7xl flex-col gap-4">
      <PageHeader
        className="mb-2"
        title="Jobs and quotes"
        description="Every quote the shop has sent and the jobs that came from them, newest first, with quoted against actual hours."
        actions={
          <InfoPopover
            triggerClassName="min-h-tap gap-2 px-3 text-sm font-medium text-primary"
            panelLabel="How to read this list"
            trigger={
              <>
                <Info aria-hidden="true" className="size-4 shrink-0" />
                How to read this list
              </>
            }
            align="end"
          >
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <span className="font-semibold text-ink">Variance:</span> actual hours against quoted hours, as a percentage of the quote. &ldquo;+53.7 %&rdquo;
                means the job took 53.7 % longer than quoted.
              </li>
              <li>
                <span className="font-semibold text-ink">Status:</span> the job&rsquo;s status, or &ldquo;No job&rdquo; when the quote didn&rsquo;t turn into one.
              </li>
              <li>
                <span className="font-semibold text-ink">Outcome:</span> won, lost (with the reason), no bid or pending. Shown to the owner and quoters only.
              </li>
              <li>
                <span className="font-semibold text-ink">Prices</span> are on each job&rsquo;s page, for the owner and quoters only.
              </li>
            </ul>
            <p className="mt-2">All customers, parts and jobs are fictional.</p>
          </InfoPopover>
        }
      />

      <JobFilters groups={vm.filterGroups} activeFilters={vm.activeFilters} />

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p aria-live="polite" data-testid="jobs-count" className="text-sm text-muted-foreground">
          {`Showing ${formatNumber(shown)} of ${formatNumber(vm.totalCount)} quotes and work orders`}
        </p>
        {vm.outcomeHiddenLabel ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>Win/loss outcomes:</span>
            <HiddenField label={vm.outcomeHiddenLabel} />
          </p>
        ) : null}
      </div>

      {shown > 0 ? (
        <JobsTable rows={vm.rows} outcomeHiddenLabel={vm.outcomeHiddenLabel} />
      ) : vm.totalCount > 0 ? (
        <EmptyState
          title="No jobs or quotes match these filters"
          body="Remove a filter above, or clear them all to see every quote and work order."
          action={
            <Link
              href="/jobs"
              className="inline-flex min-h-tap items-center rounded-md bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90"
            >
              Clear all filters
            </Link>
          }
        />
      ) : (
        <EmptyState title="No jobs or quotes" body='The demo data has no quotes. Run "npm run seed" to load the fictional shop.' />
      )}
    </div>
  );
}
