import "server-only";
/**
 * Server wrappers for the Knowledge Library (src/lib/data/cards.ts). Each one awaits connection() first (so the
 * route stays dynamic and never ships prerendered seed data), then resolves the actor from the DB, then calls the
 * pure function (docs/DATA-LAYER.md).
 */
import { cache } from "react";
import { connection } from "next/server";
import {
  cardDetail,
  libraryFacetsQuery,
  libraryPage,
  resolveLibraryFacets,
  searchCards,
  type CardDetailVM,
  type CardSearchResult,
  type LibraryFacets,
  type LibraryPageVM,
} from "@/lib/data/cards";
import { requireActor } from "@/server/actor";
import { getDb } from "@/server/db";

/** The /library list for raw searchParams (facets only; free-text search goes through the Server Action). */
export async function getLibraryPage(rawFacets: Readonly<Record<string, unknown>>): Promise<LibraryPageVM> {
  await connection();
  const actor = await requireActor();
  return libraryPage(getDb(), actor, rawFacets);
}

/** A card page view model, or null for an unknown ID (the page calls notFound()). Memoized per request. */
export const getCardDetail = cache(async (id: string): Promise<CardDetailVM | null> => {
  await connection();
  const actor = await requireActor();
  return cardDetail(getDb(), actor, id);
});

/**
 * FTS search for the library Server Action. The caller has validated `query` (length) and passes raw facet values,
 * which are re-validated here exactly as the page validates searchParams.
 */
export async function searchLibraryCards(
  query: string,
  rawFacets: Readonly<Record<string, unknown>>,
): Promise<CardSearchResult & { facets: LibraryFacets; facetsKey: string }> {
  await connection();
  const actor = await requireActor();
  const db = getDb();
  const facets = resolveLibraryFacets(db, rawFacets);
  return { ...searchCards(db, actor, query, facets), facets, facetsKey: libraryFacetsQuery(facets) };
}
