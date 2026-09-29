"use server";
/**
 * Knowledge Library search (PLAN.md §8.3). Free text never goes into a URL (CLAUDE.md "Next.js conventions"), so the
 * search box posts here and the results render client-side. The form carries the current facets as hidden fields
 * (non-text filters, re-validated server-side exactly like the page's searchParams).
 *
 * Used with useActionState: (previous state, FormData) → new state. Validation failures come back as a fixed message
 * that never echoes the input; unexpected failures are logged by code only (withSafeErrors) and come back as a
 * generic message, so the page never falls into its error boundary because of a search.
 */
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { LIBRARY_FACET_KEYS, LIBRARY_QUERY_MAX, type CardRowVM } from "@/lib/data/cards";
import { assertCan, requireActor } from "@/server/actor";
import { searchLibraryCards } from "@/server/queries/cards";
import { withSafeErrors } from "@/server/safe";

export type LibrarySearchState =
  | { status: "idle" }
  | {
      status: "ok";
      /** The trimmed search text, returned to the same viewer so the box and the results heading can show it. */
      query: string;
      /** Canonical query of the facets the results were filtered by (compare with the page's facetsKey). */
      facetsKey: string;
      /** false when the text had no searchable word: `rows` is then the default list. */
      searched: boolean;
      rows: CardRowVM[];
    }
  | { status: "error"; message: string };

const MSG_TOO_LONG = `Search text can be up to ${LIBRARY_QUERY_MAX} characters. Shorten it and try again.`;
const MSG_UNREADABLE = "That search couldn't be read. Try again.";
const MSG_FAILED = "Search isn't available right now. Try again.";

const FacetValue = z.string().max(64).optional();
const SearchInput = z.object({
  q: z.string(),
  intent: z.enum(["search", "clear"]),
  // Shape only; values are checked against the enums and existing IDs by resolveLibraryFacets().
  facets: z.object({
    type: FacetValue,
    status: FacetValue,
    person: FacetValue,
    topic: FacetValue,
    machine: FacetValue,
    material: FacetValue,
    customer: FacetValue,
    classification: FacetValue,
  } satisfies Record<(typeof LIBRARY_FACET_KEYS)[number], typeof FacetValue>),
});

function stringField(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  return typeof v === "string" ? v : undefined;
}

const runSearch = withSafeErrors(async (formData: unknown): Promise<LibrarySearchState> => {
  const actor = await requireActor();
  assertCan(actor, "searchLibrary");
  if (!(formData instanceof FormData)) return { status: "error", message: MSG_UNREADABLE };

  const parsed = SearchInput.safeParse({
    q: stringField(formData, "q") ?? "",
    intent: stringField(formData, "intent") ?? "search",
    facets: Object.fromEntries(LIBRARY_FACET_KEYS.map((k) => [k, stringField(formData, k) || undefined])),
  });
  if (!parsed.success) return { status: "error", message: MSG_UNREADABLE };

  const query = parsed.data.q.trim();
  if (parsed.data.intent === "clear" || query === "") return { status: "idle" };
  if (query.length > LIBRARY_QUERY_MAX) return { status: "error", message: MSG_TOO_LONG };

  const result = await searchLibraryCards(query, parsed.data.facets);
  return { status: "ok", query, facetsKey: result.facetsKey, searched: result.searched, rows: result.rows };
}, "searchLibrary");

export async function searchLibraryAction(_prev: LibrarySearchState, formData: FormData): Promise<LibrarySearchState> {
  try {
    return await runSearch(formData);
  } catch (err) {
    unstable_rethrow(err);
    return { status: "error", message: MSG_FAILED };
  }
}
