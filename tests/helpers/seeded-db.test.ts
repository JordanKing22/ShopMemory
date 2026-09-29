import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeCards, searchSynonymGroups } from "@/db/schema";
import { countSeededRows } from "@/db/reset";
import { bundleRowCounts } from "@/lib/seed/bundle";
import { actorFor, seedBundle, seededDb, type SeededDb } from "./seeded-db";

describe("seededDb()", () => {
  let a: SeededDb;
  let b: SeededDb;

  beforeAll(() => {
    a = seededDb();
    b = seededDb();
  });
  afterAll(() => {
    a.sqlite.close();
    b.sqlite.close();
  });

  it("loads every seeded table with exactly the bundle's row counts", () => {
    const counts = countSeededRows(a.sqlite);
    expect(counts).toEqual(bundleRowCounts(a.bundle));
    expect(counts.people).toBe(8);
    expect(counts.knowledgeCards).toBe(90);
    expect(counts.searchSynonymGroups).toBeGreaterThan(0);
  });

  it("returns a drizzle handle over the same connection, with the full schema", () => {
    expect(a.db.$client).toBe(a.sqlite);
    expect(a.db.select({ id: knowledgeCards.id }).from(knowledgeCards).all()).toHaveLength(a.bundle.tables.knowledgeCards.length);
    expect(a.db.select().from(searchSynonymGroups).all()).toEqual(a.bundle.tables.searchSynonymGroups);
  });

  it("builds the bundle once per worker and gives each call its own database", () => {
    expect(b.bundle).toBe(a.bundle);
    expect(seedBundle()).toBe(a.bundle);
    expect(b.sqlite).not.toBe(a.sqlite);
    a.sqlite.prepare("DELETE FROM search_synonym_groups").run();
    expect(countSeededRows(a.sqlite).searchSynonymGroups).toBe(0);
    expect(countSeededRows(b.sqlite).searchSynonymGroups).toBe(b.bundle.tables.searchSynonymGroups.length);
  });

  it("keeps full-text search in sync", () => {
    const n = (b.sqlite.prepare("SELECT count(*) AS n FROM cards_fts").get() as { n: number }).n;
    expect(n).toBe(b.bundle.tables.knowledgeCards.length);
  });
});

describe("actorFor()", () => {
  it("builds the data-layer actor shape", () => {
    expect(actorFor("machinist", "PER-02")).toEqual({ role: "machinist", personId: "PER-02" });
    expect(actorFor("owner")).toEqual({ role: "owner", personId: null });
  });
});
