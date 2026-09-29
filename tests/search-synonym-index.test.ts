import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { parse } from "yaml";
import { openDb } from "@/db/client";
import { countSeededRows, resetDatabase } from "@/db/reset";
import { materials, searchSynonymGroups, tags } from "@/db/schema";
import { buildSearchSynonymIndex, listSearchSynonymGroups } from "@/lib/data/search";
import { expandTerm, type SynonymIndex } from "@/lib/retrieval/synonyms";
import { readSeedSources } from "@/lib/seed/files";
import { seededDb, type SeededDb } from "./helpers/seeded-db";

let s: SeededDb;
let idx: SynonymIndex;

beforeAll(() => {
  s = seededDb();
  idx = buildSearchSynonymIndex(s.db);
});
afterAll(() => s.sqlite.close());

describe("search_synonym_groups (seeded from taxonomy/search-synonyms.yaml)", () => {
  it("holds every YAML group verbatim, in file order, with ids 1…n", () => {
    const yamlGroups = (parse(readSeedSources()["taxonomy/search-synonyms.yaml"]) as unknown[][]).map((g) => g.map(String));
    const rows = s.db.select().from(searchSynonymGroups).orderBy(searchSynonymGroups.id).all();
    expect(rows.map((r) => r.terms)).toEqual(yamlGroups);
    expect(rows.map((r) => r.id)).toEqual(rows.map((_, i) => i + 1));
    expect(rows.flatMap((r) => r.terms).every((t) => typeof t === "string")).toBe(true); // quoted "718" stays a string
  });

  it("is replaced, not duplicated, by a second reset (it is in the reset delete order)", () => {
    resetDatabase(s.sqlite, s.bundle, { nowIso: `${s.bundle.demoToday}T12:05:00.000Z` });
    expect(countSeededRows(s.sqlite).searchSynonymGroups).toBe(s.bundle.tables.searchSynonymGroups.length);
  });
});

describe("listSearchSynonymGroups()", () => {
  it("returns curated groups, then materials (name, short name, aliases), then tags (label + synonyms)", () => {
    const curated = s.db.select().from(searchSynonymGroups).orderBy(searchSynonymGroups.id).all().map((r) => r.terms);
    const mats = s.db.select().from(materials).orderBy(materials.sortOrder).all();
    const tagRows = s.db.select().from(tags).orderBy(tags.id).all();
    expect(listSearchSynonymGroups(s.db)).toEqual([
      ...curated,
      ...mats.map((m) => [m.name, m.shortName, ...m.aliases]),
      ...tagRows.map((t) => [t.label, ...t.synonyms]),
    ]);
  });
});

describe("buildSearchSynonymIndex()", () => {
  it("expands terms that only the curated YAML groups define", () => {
    expect(expandTerm("thousandths", idx)).toEqual(["thousandths", "thou"]);
    expect(expandTerm("thinwall", idx)).toEqual(["thinwall", "thin wall", "thin walls", "thin walled"]);
  });

  it("expands terms that only material names and aliases define", () => {
    // "Ti 6-4" is a material alias, and the full name "Ti-6Al-4V (Grade 5)" exists only on the materials row.
    expect(expandTerm("Ti 6-4", idx)).toEqual(["ti 6 4", "ti 6al 4v grade 5", "ti 6al 4v", "ti", "titanium", "6 4", "grade 5", "ti64"]);
  });

  it("expands terms that only tag labels and tag synonyms define", () => {
    expect(expandTerm("vibration", idx)).toEqual(["vibration", "chatter"]);
    expect(expandTerm("Okuma", idx)).toEqual(["okuma", "genos"]);
    expect(expandTerm("Walls moving after unclamping", idx)).toEqual([
      "walls moving after unclamping",
      "sprang",
      "spring",
      "moved",
      "unclamp",
      "unclamped",
      "distortion",
    ]);
  });

  it("unions every group a term belongs to, curated members first, without duplicates", () => {
    expect(expandTerm("Ti", idx)).toEqual(["ti", "titanium", "ti 6al 4v", "ti64", "6 4", "grade 5", "ti 6al 4v grade 5", "ti 6 4"]);
    expect(expandTerm("IN718", idx)).toEqual(["in718", "inconel", "718", "inconel 718"]);
  });

  it("leaves a term alone when no group gives it a synonym", () => {
    expect(expandTerm("PEEK", idx)).toEqual(["peek"]);
    expect(expandTerm("gearbox", idx)).toEqual(["gearbox"]);
  });

  it("is deterministic", () => {
    const again = buildSearchSynonymIndex(s.db);
    expect([...again.entries]).toEqual([...idx.entries]);
    expect(again.maxPhraseTokens).toBe(idx.maxPhraseTokens);
  });

  it("is empty for a migrated database with no seed", () => {
    const empty = openDb({ file: ":memory:", create: true });
    try {
      migrate(empty, { migrationsFolder: path.join(process.cwd(), "drizzle") });
      const e = buildSearchSynonymIndex(empty);
      expect(e.entries.size).toBe(0);
      expect(e.maxPhraseTokens).toBe(0);
    } finally {
      empty.$client.close();
    }
  });
});
