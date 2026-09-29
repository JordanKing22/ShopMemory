"use client";

import { useMemo, useOptimistic, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ListFilter, Loader2, X } from "lucide-react";
import type { ActiveFilterVM, FacetGroupVM } from "@/lib/data/cards";
import { cn } from "@/lib/utils";

/**
 * Library facets (type, status, contributor, topic, machine, material, customer, classification). They are not free
 * text, so they live in the URL (shareable, and the Risk page links straight to /library?person=…&topic=…).
 * Changing a select navigates at once (client-side, no scroll jump); without JavaScript the form is a plain GET
 * with an Apply button. The free-text search box is a separate form that never touches the URL.
 */
export interface FacetFiltersProps {
  groups: FacetGroupVM[];
  activeFilters: ActiveFilterVM[];
}

type Selection = Record<string, string>;

function hrefFor(groups: FacetGroupVM[], sel: Selection): string {
  const params = new URLSearchParams();
  for (const g of groups) {
    const v = sel[g.key];
    if (v) params.set(g.key, v);
  }
  const qs = params.toString();
  return qs ? `/library?${qs}` : "/library";
}

export function FacetFilters({ groups, activeFilters }: FacetFiltersProps) {
  const router = useRouter();
  const [pending, startNav] = useTransition();
  const selected = useMemo<Selection>(() => Object.fromEntries(groups.map((g) => [g.key, g.selected ?? ""])), [groups]);
  const [shown, setShown] = useOptimistic(selected);

  function change(key: string, value: string) {
    const next = { ...shown, [key]: value };
    startNav(() => {
      setShown(next);
      router.push(hrefFor(groups, next), { scroll: false });
    });
  }

  const count = activeFilters.length;

  return (
    <section aria-label="Filters" className="space-y-3">
      <details open={count > 0 || undefined} className="group rounded-lg border bg-card text-card-foreground shadow-xs">
        <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-2 font-medium text-ink select-none [&::-webkit-details-marker]:hidden">
          <ListFilter aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
          <span>Filters</span>
          {count > 0 ? (
            <span className="rounded-full bg-primary px-2 text-sm leading-6 text-primary-foreground">{count} active</span>
          ) : (
            <span className="text-sm font-normal text-muted-foreground">type, status, contributor, topic and more</span>
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
          action="/library"
          onSubmit={(e) => {
            e.preventDefault();
            startNav(() => router.push(hrefFor(groups, shown), { scroll: false }));
          }}
          className="grid gap-x-4 gap-y-3 border-t px-4 pt-3 pb-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {groups.map((g) => (
            <div key={g.key} className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={`library-facet-${g.key}`} className="text-sm font-medium text-ink">
                {g.label}
              </label>
              <select
                id={`library-facet-${g.key}`}
                name={g.key}
                data-testid={`library-facet-${g.key}`}
                value={shown[g.key] ?? ""}
                onChange={(e) => change(g.key, e.currentTarget.value)}
                className={cn(
                  "min-h-tap w-full min-w-0 rounded-md border border-input-border bg-surface px-3 text-ink shadow-xs",
                  shown[g.key] ? "border-primary font-medium" : "",
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
            <button
              type="submit"
              className="inline-flex min-h-tap items-center rounded-md bg-primary px-4 font-medium text-primary-foreground"
            >
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
            href="/library"
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
