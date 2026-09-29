/**
 * Search vocabulary from the database (PLAN.md §5.3). Library and Ask search expand user terms with synonyms that
 * come only from seeded data: the curated groups from seed-data/taxonomy/search-synonyms.yaml
 * (`search_synonym_groups`), every material's name, short name and aliases, and every tag's label and synonyms.
 *
 * Pure and synchronous (better-sqlite3), no Next.js imports, so Vitest and tsx can run it. The vocabulary is the same
 * for every role (it holds no record content, prices or contacts), so it takes no actor. Deterministic: groups are
 * read in a fixed order (curated groups by id, materials by sort order, tags by id).
 */
import { asc } from "drizzle-orm";
import type { Db } from "@/db/client";
import { materials, searchSynonymGroups, tags } from "@/db/schema";
import { buildSynonymIndex, type SynonymIndex } from "@/lib/retrieval/synonyms";

/** Every synonym group the database defines, in index order: curated groups, then materials, then tags. */
export function listSearchSynonymGroups(db: Db): string[][] {
  const curated = db
    .select({ terms: searchSynonymGroups.terms })
    .from(searchSynonymGroups)
    .orderBy(asc(searchSynonymGroups.id))
    .all()
    .map((r) => [...r.terms]);
  const materialGroups = db
    .select({ name: materials.name, shortName: materials.shortName, aliases: materials.aliases })
    .from(materials)
    .orderBy(asc(materials.sortOrder), asc(materials.id))
    .all()
    .map((m) => [m.name, m.shortName, ...m.aliases]);
  const tagGroups = db
    .select({ label: tags.label, synonyms: tags.synonyms })
    .from(tags)
    .orderBy(asc(tags.id))
    .all()
    .map((t) => [t.label, ...t.synonyms]);
  return [...curated, ...materialGroups, ...tagGroups];
}

/** One `SynonymIndex` over every group in the database (see `listSearchSynonymGroups`). */
export function buildSearchSynonymIndex(db: Db): SynonymIndex {
  return buildSynonymIndex(listSearchSynonymGroups(db));
}
