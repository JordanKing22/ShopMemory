import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_MAX_TERMS, DEFAULT_STOPWORDS, quoteFtsTerm, toFtsQuery } from "@/lib/retrieval/fts-query";
import {
  buildSynonymIndex,
  expandTerm,
  normalizeTerm,
  searchTokens,
  type SynonymIndex,
} from "@/lib/retrieval/synonyms";

/** Mirrors the shape of seed-data/taxonomy/search-synonyms.yaml (inline so the test doesn't depend on seed edits). */
const GROUPS: string[][] = [
  ["ti", "titanium", "ti-6al-4v", "ti64", "6-4", "grade 5"],
  ["inconel", "in718", "718", "inconel 718"],
  ["17-4", "17-4 ph", "17-4ph"],
  ["thin-wall", "thin wall", "thinwall", "thin walls", "thin-walled"],
  ["fai", "first article", "as9102"],
  ["bracket", "brackets"],
  ["quote", "quoting", "estimate", "estimating"],
];

const DEMO_QUESTION = "How do we quote thin-wall Ti brackets for Aerovance?";

let db: Database.Database;
let syn: SynonymIndex;

/** Runs a MATCH against the in-memory FTS5 table; throws exactly when SQLite would. */
function match(q: string): string[] {
  return (db.prepare("SELECT body FROM t WHERE t MATCH ? ORDER BY rowid").all(q) as { body: string }[]).map(
    (r) => r.body,
  );
}

beforeAll(() => {
  syn = buildSynonymIndex(GROUPS);
  db = new Database(":memory:");
  db.exec("CREATE VIRTUAL TABLE t USING fts5(body, tokenize='porter unicode61 remove_diacritics 2')");
  const ins = db.prepare("INSERT INTO t(body) VALUES (?)");
  for (const body of [
    "thin-wall titanium bracket",
    "Inconel 718 manifold, deep pocket",
    "6061 aluminum plate, anodize",
    "first article inspection on the CMM",
    "17-4 PH housing heat treat",
    "Ti 6-4 fitting, grade 5 bar stock",
  ]) {
    ins.run(body);
  }
});

afterAll(() => {
  db.close();
});

describe("sanity: raw user text really does break FTS5", () => {
  it.each(["thin-wall", "Ti-6Al-4V", "AND OR NOT", '"unbalanced', "*", "NEAR(", "body:"])("%j throws raw", (raw) => {
    expect(() => match(raw)).toThrow();
  });
});

describe("searchTokens / normalizeTerm", () => {
  it("splits on anything that isn't a letter or digit and lower-cases", () => {
    expect(searchTokens("Ti-6Al-4V")).toEqual(["ti", "6al", "4v"]);
    expect(searchTokens("  THIN–wall, 0.035\"  ")).toEqual(["thin", "wall", "0", "035"]);
    expect(searchTokens("🔩 bracket 😀")).toEqual(["bracket"]);
    expect(searchTokens("")).toEqual([]);
  });

  it("applies NFKC so full-width and composed/decomposed forms agree", () => {
    expect(normalizeTerm("ＴＩ６４")).toBe("ti64");
    expect(normalizeTerm("café")).toBe(normalizeTerm("café"));
  });

  it("joins tokens with single spaces", () => {
    expect(normalizeTerm("Grade   5")).toBe("grade 5");
    expect(normalizeTerm("--")).toBe("");
  });
});

describe("buildSynonymIndex / expandTerm", () => {
  it("expands ti to include titanium (and the other group members, normalized)", () => {
    const out = expandTerm("ti", syn);
    expect(out[0]).toBe("ti");
    expect(out).toContain("titanium");
    expect(out).toEqual(["ti", "titanium", "ti 6al 4v", "ti64", "6 4", "grade 5"]);
  });

  it("is case- and punctuation-insensitive", () => {
    expect(expandTerm("TI", syn)).toEqual(expandTerm("ti", syn));
    expect(expandTerm("Ti-6Al-4V", syn)[0]).toBe("ti 6al 4v");
    expect(expandTerm("Ti-6Al-4V", syn)).toContain("titanium");
    expect(expandTerm("Thin Wall", syn)).toContain("thinwall");
  });

  it("returns the normalized term alone when it has no synonyms, and [] for nothing", () => {
    expect(expandTerm("Manifold", syn)).toEqual(["manifold"]);
    expect(expandTerm("?!", syn)).toEqual([]);
  });

  it("unions every group a term belongs to (one hop, no transitive merge)", () => {
    const idx = buildSynonymIndex([
      ["a1", "b1"],
      ["b1", "c1"],
    ]);
    expect(expandTerm("b1", idx)).toEqual(["b1", "a1", "c1"]);
    expect(expandTerm("a1", idx)).toEqual(["a1", "b1"]);
  });

  it("deduplicates members that normalize the same and ignores degenerate groups", () => {
    const idx = buildSynonymIndex([["Thin-Wall", "thin wall", "THIN WALL"], ["😀", "solo"], []]);
    expect(idx.entries.size).toBe(0);
    expect(expandTerm("solo", idx)).toEqual(["solo"]);
  });

  it("tracks the longest phrase length in tokens", () => {
    expect(syn.maxPhraseTokens).toBe(3); // ti 6al 4v
    expect(buildSynonymIndex([]).maxPhraseTokens).toBe(0);
  });

  it("returns fresh arrays (callers can't mutate the index)", () => {
    const out = expandTerm("ti", syn);
    out.push("mutated");
    expect(expandTerm("ti", syn)).not.toContain("mutated");
  });
});

describe("DEFAULT_STOPWORDS", () => {
  it("contains the common English words from the spec", () => {
    for (const w of ["how", "do", "we", "the", "a", "an", "for", "of", "to", "in", "on", "and", "or", "is", "are"]) {
      expect(DEFAULT_STOPWORDS.has(w), w).toBe(true);
    }
    for (const w of ["what", "why", "with", "our", "it", "this", "that"]) expect(DEFAULT_STOPWORDS.has(w), w).toBe(true);
  });

  it("keeps short domain tokens and shop words", () => {
    for (const w of ["ti", "in718", "fai", "cmm", "down", "off", "out", "first", "won", "wall", "quote", "job"]) {
      expect(DEFAULT_STOPWORDS.has(w), w).toBe(false);
    }
  });

  it("is lower-case letters only", () => {
    for (const w of DEFAULT_STOPWORDS) expect(w).toMatch(/^[a-z]+$/);
  });
});

describe("quoteFtsTerm", () => {
  it("wraps in double quotes and doubles embedded quotes", () => {
    expect(quoteFtsTerm("thin")).toBe('"thin"');
    expect(quoteFtsTerm('say "hi"')).toBe('"say ""hi"""');
    expect(() => match(quoteFtsTerm('say "hi"'))).not.toThrow();
  });
});

describe("toFtsQuery — shape", () => {
  it("builds the demo question without synonyms", () => {
    expect(toFtsQuery(DEMO_QUESTION)).toBe('"quote" OR "thin" OR "wall" OR "ti" OR "brackets" OR "aerovance"');
  });

  it("expands synonyms, including multi-word synonyms as quoted phrases", () => {
    const q = toFtsQuery(DEMO_QUESTION, { synonyms: syn })!;
    const terms = q.split(" OR ");
    expect(terms).toContain('"titanium"');
    expect(terms).toContain('"thin wall"');
    expect(terms).toContain('"thin walled"');
    expect(terms).toContain('"ti 6al 4v"');
    expect(terms).toContain('"grade 5"');
    expect(terms).toContain('"bracket"');
    expect(terms).toContain('"estimating"');
    expect(terms).toContain('"aerovance"');
    expect(terms.slice(0, 2)).toEqual(['"quote"', '"quoting"']); // order of first appearance
    expect(new Set(terms).size).toBe(terms.length); // no duplicates
    for (const t of terms) expect(t).toMatch(/^"[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*"$/u);
  });

  it("is deterministic", () => {
    expect(toFtsQuery(DEMO_QUESTION, { synonyms: syn })).toBe(toFtsQuery(DEMO_QUESTION, { synonyms: syn }));
  });

  it("keeps 'ti' (two characters) but drops 1-character tokens", () => {
    expect(toFtsQuery("a b c ti x")).toBe('"ti"');
    expect(toFtsQuery("5 axis")).toBe('"axis"');
  });

  it("matches phrases that span tokens dropped on their own (6-4, grade 5)", () => {
    const q = toFtsQuery("6-4 bar", { synonyms: syn })!;
    expect(q.split(" OR ")).toEqual(expect.arrayContaining(['"bar"', '"6 4"', '"titanium"', '"ti"']));
    expect(toFtsQuery("6-4", { synonyms: syn })).not.toBeNull();
  });

  it("recognizes Ti-6Al-4V as a phrase and expands it", () => {
    const q = toFtsQuery("Ti-6Al-4V", { synonyms: syn })!;
    expect(q.startsWith('"ti" OR ')).toBe(true);
    expect(q.split(" OR ")).toEqual(expect.arrayContaining(['"6al"', '"4v"', '"ti 6al 4v"', '"titanium"']));
  });

  it("does not expand a stopword or 1-char token as a single-token synonym", () => {
    const idx = buildSynonymIndex([["in", "inch", "inches"], ["x", "axis"]]);
    expect(toFtsQuery("in x", { synonyms: idx })).toBeNull();
  });

  it("respects a custom stopword set", () => {
    expect(toFtsQuery("AND OR NOT", { stopwords: new Set() })).toBe('"and" OR "or" OR "not"');
    expect(toFtsQuery("titanium bracket", { stopwords: new Set(["bracket"]) })).toBe('"titanium"');
  });

  it("caps the number of distinct terms", () => {
    const text = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    expect(toFtsQuery(text)!.split(" OR ")).toHaveLength(DEFAULT_MAX_TERMS);
    expect(toFtsQuery(text, { maxTerms: 3 })).toBe('"word0" OR "word1" OR "word2"');
    expect(toFtsQuery("titanium bracket", { maxTerms: 0 })).toBe('"titanium"'); // floor of 1
  });

  it("deduplicates repeated words", () => {
    expect(toFtsQuery("Bracket bracket BRACKET")).toBe('"bracket"');
  });
});

describe("toFtsQuery — null when nothing searchable remains", () => {
  it.each([
    ["empty string", ""],
    ["whitespace", "   \n\t "],
    ["only stopwords", "How do we do it? What is the...?"],
    ["AND OR NOT (all stopwords)", "AND OR NOT"],
    ["only punctuation", "*** -- () : ^ + \"\" ''"],
    ["only emoji", "😀🔩🛠️"],
    ["single characters", "a b c 1 2 3"],
  ])("%s", (_label, text) => {
    expect(toFtsQuery(text)).toBeNull();
    expect(toFtsQuery(text, { synonyms: syn })).toBeNull();
  });
});

describe("toFtsQuery — every non-null output is valid FTS5", () => {
  const inputs = [
    DEMO_QUESTION,
    "Ti-6Al-4V",
    "thin-wall",
    'He said "use the 0.040 rule" and "don\'t push it"',
    '"',
    '""',
    "*",
    "ti*",
    "NEAR",
    "NEAR(titanium bracket, 3)",
    "AND OR NOT",
    "titanium AND NOT bracket",
    "body: titanium",
    "^titanium +bracket -inconel",
    "(thin OR wall)",
    "bracket 🔩 titanium 😀",
    "17-4 PH, 316L & IN718 — ½ in. wall ²",
    "Ünïcödé café naïve",
    "钛 支架 薄壁",
    "`'; DROP TABLE t; --",
    "{curly} [square] <angle> |pipe| \\back\\slash",
    "grade 5",
    "6-4",
  ];

  it.each(inputs)("%j", (text) => {
    for (const opts of [{}, { synonyms: syn }, { synonyms: syn, stopwords: new Set<string>() }]) {
      const q = toFtsQuery(text, opts);
      if (q === null) continue;
      expect(() => match(q)).not.toThrow();
    }
  });

  it("the demo question matches the row containing 'thin-wall titanium bracket'", () => {
    const q = toFtsQuery(DEMO_QUESTION, { synonyms: syn })!;
    expect(match(q)).toContain("thin-wall titanium bracket");
    // Even without synonyms the porter tokenizer still finds it via thin / wall / brackets.
    expect(match(toFtsQuery(DEMO_QUESTION)!)).toContain("thin-wall titanium bracket");
  });

  it("synonyms reach rows the raw words would miss", () => {
    // "Ti" alone doesn't occur in the titanium bracket row; the synonym expansion to "titanium" finds it.
    expect(match(toFtsQuery("Ti")!)).not.toContain("thin-wall titanium bracket");
    expect(match(toFtsQuery("Ti", { synonyms: syn })!)).toContain("thin-wall titanium bracket");
    expect(match(toFtsQuery("FAI", { synonyms: syn })!)).toContain("first article inspection on the CMM");
    expect(match(toFtsQuery("Inconel", { synonyms: syn })!)).toContain("Inconel 718 manifold, deep pocket");
  });

  it("works with bm25() ranking on a real query", () => {
    const q = toFtsQuery("thin-wall titanium", { synonyms: syn })!;
    const rows = db.prepare("SELECT body FROM t WHERE t MATCH ? ORDER BY bm25(t)").all(q) as { body: string }[];
    expect(rows[0].body).toBe("thin-wall titanium bracket");
  });

  it("a very long query is still valid", () => {
    const text = Array.from({ length: 500 }, (_, i) => `term${i} thin-wall "x" *`).join(" ");
    const q = toFtsQuery(text, { synonyms: syn, maxTerms: 1000 })!;
    expect(() => match(q)).not.toThrow();
  });
});
