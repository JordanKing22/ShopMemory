"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import { Loader2, Search, SearchX, TriangleAlert } from "lucide-react";
import { searchLibraryAction, type LibrarySearchState } from "@/app/actions/library";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import type { LibraryPageVM } from "@/lib/data/cards";
import { cn } from "@/lib/utils";
import { CardRow } from "./card-row";
import { FacetFilters } from "./facet-filters";

/**
 * The Knowledge Library list: free-text search (a POST Server Action: the text never goes into the URL), URL facets,
 * and the result rows. Search results render here from the action's state; the facet-filtered default list comes
 * from the server. When the facets change while a search is showing, the same search re-runs with the new facets.
 */
const SEARCH_FORM_ID = "library-search-form";
const QUERY_MAX = 200; // mirrors LIBRARY_QUERY_MAX; the Server Action enforces it

const INITIAL: LibrarySearchState = { status: "idle" };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function LibraryBrowser({ vm }: { vm: LibraryPageVM }) {
  const [state, dispatch, pending] = useActionState(searchLibraryAction, INITIAL);
  const lastRerun = useRef<string | null>(null);

  const ok = state.status === "ok" ? state : null;
  const searching = ok !== null && ok.searched;
  const stale = searching && ok.facetsKey !== vm.facetsKey;

  // Facets changed (URL navigation) while a search is showing: re-run it once for the new facets.
  useEffect(() => {
    if (!ok || !stale) return;
    const key = `${vm.facetsKey}\n${ok.query}`;
    if (lastRerun.current === key) return;
    lastRerun.current = key;
    const fd = new FormData();
    fd.set("q", ok.query);
    fd.set("intent", "search");
    for (const [k, v] of Object.entries(vm.facets)) if (typeof v === "string" && v) fd.set(k, v);
    startTransition(() => dispatch(fd));
  }, [ok, stale, vm.facets, vm.facetsKey, dispatch]);

  const rows = searching ? ok.rows : vm.rows;
  const filtered = vm.activeFilters.length > 0;

  let heading: string;
  if (searching) heading = `${plural(ok.rows.length, "card matches", "cards match")} “${ok.query}”`;
  else if (filtered) heading = `${plural(vm.rows.length, "card", "cards")} of ${vm.totalCards}`;
  else heading = `All ${plural(vm.totalCards, "card", "cards")}`;

  return (
    <div className="space-y-4">
      <form
        id={SEARCH_FORM_ID}
        action={dispatch}
        role="search"
        aria-label="Search the Knowledge Library"
        className="rounded-lg border bg-card p-3 text-card-foreground shadow-xs sm:p-4"
      >
        <label htmlFor="library-search" className="mb-1.5 block text-sm font-medium text-ink">
          Search cards
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
            <input
              id="library-search"
              data-testid="library-search"
              name="q"
              type="search"
              autoComplete="off"
              spellCheck={false}
              maxLength={QUERY_MAX}
              defaultValue={ok ? ok.query : ""}
              aria-describedby="library-search-hint"
              placeholder="Words from a title, statement, cue or tag"
              className="min-h-tap w-full min-w-0 rounded-md border border-input-border bg-surface py-2 pr-3 pl-10 text-ink shadow-xs placeholder:text-muted-foreground"
            />
          </div>
          {/* Current facets ride along in the POST body (non-text filters, re-validated on the server). */}
          {Object.entries(vm.facets).map(([k, v]) => (typeof v === "string" && v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
          <div className="flex gap-2">
            <Button type="submit" name="intent" value="search" className="min-h-tap flex-1 px-5 sm:flex-none" disabled={pending}>
              {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Search aria-hidden="true" />}
              Search
            </Button>
            {ok ? (
              <Button type="submit" name="intent" value="clear" variant="outline" className="min-h-tap flex-1 px-4 sm:flex-none" disabled={pending}>
                Clear search
              </Button>
            ) : null}
          </div>
        </div>
        <p id="library-search-hint" className="mt-1.5 text-sm text-muted-foreground">
          Searches every card&apos;s title, statement and tags, including other names for the same thing from the
          shop&apos;s synonym list. Filters below narrow the search too.
        </p>
        {state.status === "error" ? (
          <p role="alert" className="mt-2 flex items-start gap-2 text-sm font-medium text-destructive">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {state.message}
          </p>
        ) : null}
        {ok && !ok.searched ? (
          <p role="status" className="mt-2 text-sm text-ink">
            That search had no words to look up (short and very common words such as “how” or “the” are skipped), so
            every card is listed.
          </p>
        ) : null}
      </form>

      <FacetFilters groups={vm.facetGroups} activeFilters={vm.activeFilters} />

      <section aria-labelledby="library-results-heading" aria-busy={pending || stale} className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="library-results-heading" className="text-lg font-semibold text-ink" aria-live="polite">
            {heading}
          </h2>
          <p className="text-sm text-muted-foreground">
            {searching ? "Best matches first." : "Approved cards first, then pending review, drafts and rejected cards."}
          </p>
        </div>

        {rows.length === 0 ? (
          searching ? (
            <EmptyState
              icon={<SearchX aria-hidden="true" className="size-6" />}
              title="No cards match that search"
              body={
                <>
                  Try fewer words, a different word for the same thing, or the name of a machine, material, customer or
                  person.{filtered ? " The filters narrow the search too: clear them to search every card." : null}
                </>
              }
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button form={SEARCH_FORM_ID} type="submit" name="intent" value="clear" variant="outline" className="min-h-tap">
                    Clear search
                  </Button>
                  {filtered ? (
                    <Link
                      href="/library"
                      scroll={false}
                      className="inline-flex min-h-tap items-center rounded-md px-3 font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Clear all filters
                    </Link>
                  ) : null}
                </div>
              }
            />
          ) : (
            <EmptyState
              title="No cards match these filters"
              body="Remove a filter above, or clear them all to see every card in the library."
              action={
                <Link
                  href="/library"
                  scroll={false}
                  className="inline-flex min-h-tap items-center rounded-md border border-input-border bg-surface px-4 font-medium text-ink hover:bg-muted"
                >
                  Clear all filters
                </Link>
              }
            />
          )
        ) : (
          <ul className={cn("grid gap-3 transition-opacity", (pending || stale) && "opacity-60")}>
            {rows.map((r) => (
              <CardRow key={r.id} row={r} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
