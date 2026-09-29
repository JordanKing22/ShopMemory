"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ListFilter, Loader2, X } from "lucide-react";
import type { JobActiveFilterVM, JobFilterGroupVM } from "@/lib/data/jobs";
import { cn } from "@/lib/utils";

/**
 * Jobs filters (customer, person, machine, status, classification and, for the owner and quoters only, outcome).
 * None is free text, so they live in the URL (shareable; PLAN.md §9). Changing a select navigates at once
 * (client-side, no scroll jump); without JavaScript the form is a plain GET with an Apply button.
 * The outcome group is only in the props for roles that may see win/loss; the server ignores it for other roles.
 */
export interface JobFiltersProps {
  groups: JobFilterGroupVM[];
  activeFilters: JobActiveFilterVM[];
}

function fromGroups(groups: JobFilterGroupVM[]): Record<string, string> {
  return Object.fromEntries(groups.map((g) => [g.key, g.selected ?? ""]));
}

function hrefFor(groups: JobFilterGroupVM[], sel: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const g of groups) {
    const v = sel[g.key];
    if (v) params.set(g.key, v);
  }
  const qs = params.toString();
  return qs ? `/jobs?${qs}` : "/jobs";
}

/** Visible label overrides: the person filter matches the quoter or the job lead; customers are fictional. */
const HINT: Record<string, string> = {
  customer: "Customer (fictional)",
  person: "Quoted or led by",
};

export function JobFilters({ groups, activeFilters }: JobFiltersProps) {
  const router = useRouter();
  const [pending, startNav] = useTransition();

  // The selects show local state (so two quick changes both apply) and re-sync whenever the URL's filters change,
  // e.g. after "Clear all" (React's "adjust state when a prop changes" pattern: no remount, so focus stays put).
  const applied = groups.map((g) => `${g.key}=${g.selected ?? ""}`).join("&");
  const [prevApplied, setPrevApplied] = useState(applied);
  const [sel, setSel] = useState<Record<string, string>>(() => fromGroups(groups));
  if (applied !== prevApplied) {
    setPrevApplied(applied);
    setSel(fromGroups(groups));
  }

  function change(key: string, value: string) {
    const next = { ...sel, [key]: value };
    setSel(next);
    startNav(() => router.push(hrefFor(groups, next), { scroll: false }));
  }

  const count = activeFilters.length;

  return (
    <section aria-label="Filters" data-testid="jobs-filters" className="space-y-3">
      <details open={count > 0 || undefined} className="group rounded-lg border bg-card text-card-foreground shadow-xs">
        <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-2 font-medium text-ink select-none [&::-webkit-details-marker]:hidden">
          <ListFilter aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
          <span>Filters</span>
          {count > 0 ? (
            <span className="rounded-full bg-primary px-2 text-sm leading-6 text-primary-foreground">{count} active</span>
          ) : (
            <span className="min-w-0 truncate text-sm font-normal text-muted-foreground">customer, person, machine, status and more</span>
          )}
          {pending ? (
            <>
              <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin text-muted-foreground" />
              <span className="sr-only">Updating</span>
            </>
          ) : null}
          <ChevronDown aria-hidden="true" className="ml-auto size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <form
          method="get"
          action="/jobs"
          onSubmit={(e) => {
            e.preventDefault();
            startNav(() => router.push(hrefFor(groups, sel), { scroll: false }));
          }}
          className="grid gap-x-4 gap-y-3 border-t px-4 pt-3 pb-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6"
        >
          {groups.map((g) => (
            <div key={g.key} className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={`job-filter-${g.key}`} className="text-sm font-medium text-ink">
                {HINT[g.key] ?? g.label}
              </label>
              <select
                id={`job-filter-${g.key}`}
                name={g.key}
                data-testid={`job-filter-${g.key}`}
                value={sel[g.key] ?? ""}
                onChange={(e) => change(g.key, e.currentTarget.value)}
                className={cn(
                  "min-h-tap w-full min-w-0 rounded-md border border-input-border bg-surface px-3 text-ink shadow-xs",
                  sel[g.key] ? "border-primary font-medium" : "",
                )}
              >
                <option value="">Any {g.label.toLowerCase()}</option>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <noscript>
            <button type="submit" className="inline-flex min-h-tap items-center rounded-md bg-primary px-4 font-medium text-primary-foreground">
              Apply filters
            </button>
          </noscript>
        </form>
      </details>

      {count > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Filtered by:</span>
          <ul className="flex flex-wrap gap-2">
            {activeFilters.map((f) => (
              <li key={f.key}>
                <Link
                  href={f.removeHref}
                  scroll={false}
                  aria-label={`Remove filter ${f.label}: ${f.valueLabel}`}
                  className="inline-flex min-h-tap items-center gap-1.5 rounded-full border border-primary/50 bg-accent px-3 text-sm text-ink hover:bg-muted"
                >
                  <span>
                    <span className="text-muted-foreground">{f.label}:</span> {f.valueLabel}
                  </span>
                  <X aria-hidden="true" className="size-4 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href="/jobs"
            scroll={false}
            className="inline-flex min-h-tap items-center rounded-md px-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Clear all filters
          </Link>
        </div>
      ) : null}
    </section>
  );
}
