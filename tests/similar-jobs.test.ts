import { describe, expect, it } from "vitest";
import { CLASS_RANK, type Classification } from "@/db/schema/enums";
import { parseQueryFeatures, phraseRegExp, type QueryVocabulary } from "@/lib/retrieval/query-features";
import {
  DEFAULT_PANEL_SHOWN,
  DEFAULT_SIMILAR_JOBS_LIMIT,
  rankSimilarJobs,
  scoreJob,
  SIMILARITY_BANDS,
  SIMILARITY_WEIGHTS,
  similarJobsPanel,
  type JobForSimilarity,
  type SimilarityQuery,
} from "@/lib/retrieval/similar-jobs";

const DEMO_QUESTION = "How do we quote thin-wall Ti brackets for Aerovance?";

/** Vocabulary in the shape the seed loader will build (fictional names, test-local). */
const VOCAB: QueryVocabulary = {
  customers: [
    { id: "CUS-01", names: ["Aerovance"] },
    { id: "CUS-02", names: ["Halvorsen Flight Controls", "Halvorsen", "HFC"] },
    { id: "CUS-05", names: ["Graymoor Defense Systems", "Graymoor"] },
    { id: "CUS-06", names: ["Velmont"] },
  ],
  materials: [
    { id: "mat-ti64", names: ["Ti", "titanium", "Ti-6Al-4V", "6-4"] },
    { id: "mat-7075", names: ["7075", "7075-T6", "7075 aluminum"] },
    { id: "mat-174ph", names: ["17-4", "17-4 PH", "17-4PH"] },
    { id: "mat-in718", names: ["Inconel", "Inconel 718", "718"] },
  ],
  features: {
    thin_wall: ["thin-wall", "thin wall", "thin walls", "thin-walled"],
    five_axis: ["5-axis", "five axis", "five-axis"],
    first_article: ["first article", "FAI"],
    deep_pocket: ["deep pocket"],
  },
  families: {
    bracket: ["bracket"],
    housing: ["housing"],
    manifold: ["manifold"],
    assembly: ["assembly"],
    box: ["box"],
  },
};

// ---------------------------------------------------------------------------------------------------------------
// parseQueryFeatures
// ---------------------------------------------------------------------------------------------------------------

describe("parseQueryFeatures", () => {
  it("parses the demo question (spec example)", () => {
    const spec: QueryVocabulary = {
      customers: [{ id: "CUS-01", names: ["Aerovance"] }],
      materials: [{ id: "mat-ti64", names: ["Ti", "titanium", "Ti-6Al-4V", "6-4"] }],
      features: { thin_wall: ["thin-wall", "thin wall", "thin walls", "thin-walled"] },
      families: { bracket: ["bracket"] },
    };
    expect(parseQueryFeatures(DEMO_QUESTION, spec)).toEqual({
      customerIds: ["CUS-01"],
      materialIds: ["mat-ti64"],
      features: ["thin_wall"],
      families: ["bracket"],
    });
    expect(parseQueryFeatures(DEMO_QUESTION, VOCAB)).toEqual({
      customerIds: ["CUS-01"],
      materialIds: ["mat-ti64"],
      features: ["thin_wall"],
      families: ["bracket"],
    });
  });

  it("is case-insensitive", () => {
    const f = parseQueryFeatures("AEROVANCE TITANIUM THIN WALL BRACKET", VOCAB);
    expect(f).toEqual({ customerIds: ["CUS-01"], materialIds: ["mat-ti64"], features: ["thin_wall"], families: ["bracket"] });
  });

  it("matches whole words only", () => {
    const f = parseQueryFeatures("Tin plating on a tiny Aerovances-like tithe; 71750 and a housingx", VOCAB);
    expect(f).toEqual({ customerIds: [], materialIds: [], features: [], families: [] });
  });

  it("treats word boundaries as punctuation too (Ti-6Al-4V contains Ti; possessives)", () => {
    expect(parseQueryFeatures("Aerovance's Ti-6Al-4V job", VOCAB)).toMatchObject({
      customerIds: ["CUS-01"],
      materialIds: ["mat-ti64"],
    });
    expect(parseQueryFeatures("(Ti)", VOCAB).materialIds).toEqual(["mat-ti64"]);
  });

  it("is plural-tolerant for family words only", () => {
    expect(parseQueryFeatures("brackets", VOCAB).families).toEqual(["bracket"]);
    expect(parseQueryFeatures("Bracket", VOCAB).families).toEqual(["bracket"]);
    expect(parseQueryFeatures("housings and manifolds", VOCAB).families).toEqual(["housing", "manifold"]);
    expect(parseQueryFeatures("sub-assemblies", VOCAB).families).toEqual(["assembly"]);
    expect(parseQueryFeatures("boxes", VOCAB).families).toEqual(["box"]);
    expect(parseQueryFeatures("bracketry", VOCAB).families).toEqual([]);
    // Customers/materials are not pluralized.
    expect(parseQueryFeatures("Velmonts", VOCAB).customerIds).toEqual([]);
  });

  it("treats whitespace and hyphen runs inside a phrase as equivalent, other punctuation literally", () => {
    expect(parseQueryFeatures("thin - wall", VOCAB).features).toEqual(["thin_wall"]);
    expect(parseQueryFeatures("thin–wall", VOCAB).features).toEqual(["thin_wall"]);
    expect(parseQueryFeatures("thin\n   wall", VOCAB).features).toEqual(["thin_wall"]);
    expect(parseQueryFeatures("thin-walled housing", VOCAB).features).toEqual(["thin_wall"]);
    expect(parseQueryFeatures("a 6.4 hour job", VOCAB).materialIds).toEqual([]);
    expect(parseQueryFeatures("6-4 bar", VOCAB).materialIds).toEqual(["mat-ti64"]);
  });

  it("lets the longest match in a category claim its span", () => {
    const vocab: QueryVocabulary = {
      customers: [],
      materials: [
        { id: "mat-ti-generic", names: ["Ti"] },
        { id: "mat-ti64", names: ["Ti-6Al-4V"] },
      ],
      features: {},
      families: {},
    };
    expect(parseQueryFeatures("Ti-6Al-4V", vocab).materialIds).toEqual(["mat-ti64"]);
    expect(parseQueryFeatures("Ti-6Al-4V and some other Ti", vocab).materialIds).toEqual(["mat-ti64", "mat-ti-generic"]);
  });

  it("returns every ID for an ambiguous alias (identical span)", () => {
    const vocab: QueryVocabulary = {
      customers: [
        { id: "CUS-A", names: ["Acme"] },
        { id: "CUS-B", names: ["Acme"] },
      ],
      materials: [],
      features: {},
      families: {},
    };
    expect(parseQueryFeatures("Acme parts", vocab).customerIds).toEqual(["CUS-A", "CUS-B"]);
  });

  it("orders results by first mention and deduplicates", () => {
    const f = parseQueryFeatures("Velmont housing vs Aerovance bracket vs Velmont again, 17-4 then Inconel then 17-4 PH", VOCAB);
    expect(f.customerIds).toEqual(["CUS-06", "CUS-01"]);
    expect(f.families).toEqual(["housing", "bracket"]);
    expect(f.materialIds).toEqual(["mat-174ph", "mat-in718"]);
  });

  it("finds several features and multi-word customer names", () => {
    const f = parseQueryFeatures("Graymoor Defense Systems 5-axis FAI with a deep pocket", VOCAB);
    expect(f.customerIds).toEqual(["CUS-05"]);
    expect(f.features).toEqual(["five_axis", "first_article", "deep_pocket"]);
  });

  it("handles empty input and empty vocabularies", () => {
    expect(parseQueryFeatures("", VOCAB)).toEqual({ customerIds: [], materialIds: [], features: [], families: [] });
    expect(parseQueryFeatures(DEMO_QUESTION, { customers: [], materials: [], features: {}, families: {} })).toEqual({
      customerIds: [],
      materialIds: [],
      features: [],
      families: [],
    });
  });

  it("ignores blank phrases and escapes regex metacharacters in phrases", () => {
    expect(phraseRegExp("   ")).toBeNull();
    const vocab: QueryVocabulary = {
      customers: [{ id: "CUS-X", names: ["", "A.B (Co)", "C++"] }],
      materials: [],
      features: {},
      families: {},
    };
    expect(parseQueryFeatures("ordered by A.B (Co) today", vocab).customerIds).toEqual(["CUS-X"]);
    expect(parseQueryFeatures("ordered by AxB (Co) today", vocab).customerIds).toEqual([]);
    expect(parseQueryFeatures("C++ shop", vocab).customerIds).toEqual(["CUS-X"]);
  });

  it("is deterministic and stateless across calls (global regex lastIndex doesn't leak)", () => {
    const a = parseQueryFeatures(DEMO_QUESTION, VOCAB);
    const b = parseQueryFeatures(DEMO_QUESTION, VOCAB);
    expect(b).toEqual(a);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Scorer fixture mirroring PLAN.md §7.6
// ---------------------------------------------------------------------------------------------------------------

function job(p: Partial<JobForSimilarity> & Pick<JobForSimilarity, "id">): JobForSimilarity {
  return {
    status: "complete",
    customerId: null,
    materialId: "mat-6061",
    features: [],
    family: "plate",
    minWallIn: null,
    complexity: 2,
    classification: "customer_confidential",
    quotedHours: 10,
    actualHours: 10,
    ...p,
  };
}

const JOBS: JobForSimilarity[] = [
  // Deliberately not in ID order, so the sort is exercised.
  job({ id: "J-A10", customerId: "CUS-05", materialId: "mat-174ph", family: "manifold", features: ["deep_pocket", "heat_treat"], complexity: 5, classification: "export_controlled", quotedHours: 96, actualHours: 118.5 }),
  job({ id: "J-A06", customerId: "CUS-06", materialId: "mat-ti64", family: "housing", features: ["thin_wall", "five_axis"], minWallIn: 0.04, complexity: 5, classification: "export_controlled", quotedHours: 50, actualHours: 55 }),
  job({ id: "J-A04", customerId: "CUS-01", materialId: "mat-ti64", family: "bracket", features: ["thin_wall", "first_article"], minWallIn: 0.05, complexity: 4, quotedHours: 44, actualHours: 42.5 }),
  job({ id: "J-A03", customerId: "CUS-01", materialId: "mat-ti64", family: "bracket", features: ["thin_wall", "five_axis"], minWallIn: 0.038, complexity: 4, quotedHours: 27, actualHours: 41.5 }),
  job({ id: "J-A02", customerId: "CUS-01", materialId: "mat-ti64", family: "bracket", features: ["thin_wall", "five_axis", "first_article"], minWallIn: 0.045, complexity: 4, quotedHours: 32, actualHours: 33.5 }),
  job({ id: "J-A05", customerId: "CUS-01", materialId: "mat-7075", family: "bracket", features: ["five_axis"], complexity: 3, quotedHours: 20, actualHours: 21 }),
  // Generated-style neighbours that must stay below J-A06.
  job({ id: "J-G11", customerId: "CUS-01", materialId: "mat-6061", family: "bracket", features: ["anodize"], complexity: 2 }),
  job({ id: "J-G12", customerId: "CUS-01", materialId: "mat-ti64", family: "fitting", features: ["first_article"], complexity: 3 }),
  job({ id: "J-G13", customerId: "CUS-06", materialId: "mat-ti64", family: "bracket", features: ["five_axis"], complexity: 3, classification: "export_controlled" }),
  // Unrelated jobs.
  job({ id: "J-G20", customerId: "CUS-03", materialId: "mat-316", family: "instrument", features: ["passivation"], complexity: 2 }),
  job({ id: "J-G21", customerId: "CUS-04", materialId: "mat-peek", family: "insulator", features: ["cleanroom"], complexity: 1 }),
  // Must be excluded: an in-process Aerovance thin-wall Ti bracket, and a "complete" job without actual hours.
  job({ id: "J-A99", status: "in_process", customerId: "CUS-01", materialId: "mat-ti64", family: "bracket", features: ["thin_wall", "five_axis", "first_article"], minWallIn: 0.035, actualHours: null }),
  job({ id: "J-A98", status: "complete", customerId: "CUS-01", materialId: "mat-ti64", family: "bracket", features: ["thin_wall", "five_axis", "first_article"], minWallIn: 0.035, actualHours: null }),
  job({ id: "J-A97", status: "scheduled", customerId: "CUS-01", materialId: "mat-ti64", family: "bracket", features: ["thin_wall"], actualHours: null }),
];

const DEMO_QUERY: SimilarityQuery = parseQueryFeatures(DEMO_QUESTION, VOCAB);

/** Cloud (Anthropic API) clearance: everything below export_controlled. Local: everything. */
const cloudCleared = (c: Classification): boolean => CLASS_RANK[c] < CLASS_RANK.export_controlled;
const localCleared = (): boolean => true;

const ids = (rows: { job: JobForSimilarity }[]): string[] => rows.map((r) => r.job.id);

describe("SIMILARITY_WEIGHTS", () => {
  it("documents the spec weights", () => {
    expect(SIMILARITY_WEIGHTS).toMatchObject({
      customer: 3,
      material: 3,
      feature: 2,
      family: 2,
      wallBand: 1,
      complexityBand: 0.5,
    });
    expect(SIMILARITY_WEIGHTS.featureOverrides.thin_wall).toBe(4);
    expect(SIMILARITY_BANDS).toEqual({ wallIn: 0.01, complexity: 1 });
    expect(Object.isFrozen(SIMILARITY_WEIGHTS)).toBe(true);
    expect(Object.isFrozen(SIMILARITY_WEIGHTS.featureOverrides)).toBe(true);
    expect(Object.isFrozen(SIMILARITY_BANDS)).toBe(true);
  });
});

describe("scoreJob", () => {
  const empty: SimilarityQuery = { customerIds: [], materialIds: [], features: [], families: [] };

  it("scores each component with its weight", () => {
    const j = job({ id: "J", customerId: "C", materialId: "M", family: "bracket", features: ["five_axis", "thin_wall"], minWallIn: 0.04, complexity: 3 });
    expect(scoreJob(empty, j)).toBe(0);
    expect(scoreJob({ ...empty, customerIds: ["C"] }, j)).toBe(3);
    expect(scoreJob({ ...empty, materialIds: ["M"] }, j)).toBe(3);
    expect(scoreJob({ ...empty, features: ["five_axis"] }, j)).toBe(2);
    expect(scoreJob({ ...empty, features: ["thin_wall"] }, j)).toBe(4);
    expect(scoreJob({ ...empty, features: ["thin_wall", "five_axis", "deep_pocket"] }, j)).toBe(6);
    expect(scoreJob({ ...empty, families: ["bracket"] }, j)).toBe(2);
    expect(scoreJob({ ...empty, minWallIn: 0.035 }, j)).toBe(1);
    expect(scoreJob({ ...empty, complexity: 4 }, j)).toBe(0.5);
    expect(
      scoreJob(
        { customerIds: ["C"], materialIds: ["M"], features: ["thin_wall", "five_axis"], families: ["bracket"], minWallIn: 0.04, complexity: 3 },
        j,
      ),
    ).toBe(3 + 3 + 4 + 2 + 2 + 1 + 0.5);
  });

  it("counts shared features once each even if duplicated", () => {
    const j = job({ id: "J", features: ["five_axis", "five_axis"] });
    expect(scoreJob({ ...empty, features: ["five_axis", "five_axis"] }, j)).toBe(2);
  });

  it("applies the wall band inclusively at exactly 0.010 in (floating point safe)", () => {
    const j = job({ id: "J", minWallIn: 0.045 });
    expect(scoreJob({ ...empty, minWallIn: 0.035 }, j)).toBe(1);
    expect(scoreJob({ ...empty, minWallIn: 0.055 }, j)).toBe(1);
    expect(scoreJob({ ...empty, minWallIn: 0.034 }, j)).toBe(0);
    expect(scoreJob({ ...empty, minWallIn: 0.0561 }, j)).toBe(0);
  });

  it("skips the wall band when either side has no min wall", () => {
    expect(scoreJob({ ...empty, minWallIn: 0.04 }, job({ id: "J", minWallIn: null }))).toBe(0);
    expect(scoreJob({ ...empty, minWallIn: null }, job({ id: "J", minWallIn: 0.04 }))).toBe(0);
    expect(scoreJob(empty, job({ id: "J", minWallIn: 0.04 }))).toBe(0);
  });

  it("applies the complexity band inclusively at ±1", () => {
    const j = job({ id: "J", complexity: 3 });
    expect(scoreJob({ ...empty, complexity: 2 }, j)).toBe(0.5);
    expect(scoreJob({ ...empty, complexity: 4 }, j)).toBe(0.5);
    expect(scoreJob({ ...empty, complexity: 5 }, j)).toBe(0);
    expect(scoreJob({ ...empty, complexity: null }, j)).toBe(0);
  });

  it("never matches a null customer", () => {
    expect(scoreJob({ ...empty, customerIds: ["CUS-01"] }, job({ id: "J", customerId: null }))).toBe(0);
  });

  it("scores the §7.6 anchors for the demo question as expected", () => {
    const byId = new Map(JOBS.map((j) => [j.id, j]));
    const s = (id: string) => scoreJob(DEMO_QUERY, byId.get(id)!);
    expect(s("J-A02")).toBe(12); // customer 3 + material 3 + thin_wall 4 + family 2
    expect(s("J-A03")).toBe(12);
    expect(s("J-A04")).toBe(12);
    expect(s("J-A06")).toBe(7); // material 3 + thin_wall 4
    expect(s("J-A05")).toBe(5); // customer 3 + family 2
    expect(s("J-G12")).toBe(6);
    expect(s("J-G13")).toBe(5);
    expect(s("J-A10")).toBe(0);
  });
});

describe("rankSimilarJobs", () => {
  it("ranks J-A02/J-A03/J-A04 at 1–3 and J-A06 at 4 for the demo question (§7.6 invariant)", () => {
    const ranked = rankSimilarJobs(DEMO_QUERY, JOBS);
    expect(ranked).toHaveLength(DEFAULT_SIMILAR_JOBS_LIMIT);
    expect(new Set(ids(ranked.slice(0, 3)))).toEqual(new Set(["J-A02", "J-A03", "J-A04"]));
    expect(ranked[3].job.id).toBe("J-A06");
  });

  it("breaks ties by ID ascending", () => {
    expect(ids(rankSimilarJobs(DEMO_QUERY, JOBS))).toEqual(["J-A02", "J-A03", "J-A04", "J-A06"]);
  });

  it("excludes non-complete jobs and completes without actual hours", () => {
    const all = ids(rankSimilarJobs(DEMO_QUERY, JOBS, { limit: 100 }));
    expect(all).not.toContain("J-A99");
    expect(all).not.toContain("J-A98");
    expect(all).not.toContain("J-A97");
  });

  it("drops zero scores", () => {
    const all = rankSimilarJobs(DEMO_QUERY, JOBS, { limit: 100 });
    expect(all.every((r) => r.score > 0)).toBe(true);
    expect(ids(all)).not.toContain("J-A10");
    expect(ids(all)).not.toContain("J-G20");
    expect(ids(all)).toEqual(["J-A02", "J-A03", "J-A04", "J-A06", "J-G12", "J-A05", "J-G11", "J-G13"]);
  });

  it("honours the limit", () => {
    expect(rankSimilarJobs(DEMO_QUERY, JOBS, { limit: 2 })).toHaveLength(2);
    expect(rankSimilarJobs(DEMO_QUERY, JOBS, { limit: 0 })).toEqual([]);
  });

  it("is independent of input order", () => {
    const reversed = [...JOBS].reverse();
    expect(rankSimilarJobs(DEMO_QUERY, reversed, { limit: 100 })).toEqual(rankSimilarJobs(DEMO_QUERY, JOBS, { limit: 100 }));
  });

  it("is classification-blind", () => {
    const relabelled = JOBS.map((j) => ({ ...j, classification: "general" as Classification }));
    expect(ids(rankSimilarJobs(DEMO_QUERY, relabelled))).toEqual(ids(rankSimilarJobs(DEMO_QUERY, JOBS)));
  });

  it("uses wall/complexity bands from a pinned query (Q-A01: 0.035 in wall)", () => {
    const pinned: SimilarityQuery = { ...DEMO_QUERY, features: ["thin_wall", "five_axis", "first_article"], minWallIn: 0.035, complexity: 4 };
    const ranked = rankSimilarJobs(pinned, JOBS);
    expect(ranked[0].job.id).toBe("J-A02"); // shares all three features
    expect(new Set(ids(ranked.slice(0, 3)))).toEqual(new Set(["J-A02", "J-A03", "J-A04"]));
    expect(ranked[3].job.id).toBe("J-A06");
  });

  it("keeps extra fields on the job type (generic)", () => {
    const withExtra = JOBS.map((j) => ({ ...j, label: `label-${j.id}` }));
    const ranked = rankSimilarJobs(DEMO_QUERY, withExtra);
    expect(ranked[0].job.label).toBe("label-J-A02");
  });

  it("returns nothing for an empty query or no jobs", () => {
    expect(rankSimilarJobs({ customerIds: [], materialIds: [], features: [], families: [] }, JOBS)).toEqual([]);
    expect(rankSimilarJobs(DEMO_QUERY, [])).toEqual([]);
  });
});

describe("similarJobsPanel (PLAN.md §4.4 panel rule)", () => {
  const ranked = rankSimilarJobs(DEMO_QUERY, JOBS);

  it("cloud: shows the 3 cleared jobs and lists J-A06 as not sent", () => {
    const panel = similarJobsPanel(ranked, cloudCleared);
    expect(ids(panel.shown)).toEqual(["J-A02", "J-A03", "J-A04"]);
    expect(ids(panel.notSent)).toEqual(["J-A06"]);
  });

  it("local: shows the same 3 and nothing is withheld", () => {
    const panel = similarJobsPanel(ranked, localCleared);
    expect(ids(panel.shown)).toEqual(["J-A02", "J-A03", "J-A04"]);
    expect(panel.notSent).toEqual([]);
  });

  it("defaults to showing 3", () => {
    expect(DEFAULT_PANEL_SHOWN).toBe(3);
    expect(similarJobsPanel(ranked, localCleared, 2).shown).toHaveLength(2);
  });

  it("does not backfill from outside the budget and keeps rank order", () => {
    const wide = rankSimilarJobs(DEMO_QUERY, JOBS, { limit: 100 });
    const budget = wide.slice(0, 4);
    // Everything except export_controlled; J-A06 is the only budgeted EC job, J-G13 (EC, outside budget) is ignored.
    const panel = similarJobsPanel(budget, cloudCleared);
    expect(ids(panel.notSent)).toEqual(["J-A06"]);
    expect(ids(panel.notSent)).not.toContain("J-G13");
  });

  it("shows cleared jobs even when a withheld job outranks them", () => {
    const denyCustomer = (c: Classification) => CLASS_RANK[c] < CLASS_RANK.customer_confidential;
    const panel = similarJobsPanel(ranked, denyCustomer);
    expect(panel.shown).toEqual([]);
    expect(ids(panel.notSent)).toEqual(["J-A02", "J-A03", "J-A04", "J-A06"]);
  });

  it("preserves scores and handles an empty ranking", () => {
    const panel = similarJobsPanel(ranked, cloudCleared);
    expect(panel.shown.map((r) => r.score)).toEqual([12, 12, 12]);
    expect(panel.notSent[0].score).toBe(7);
    expect(similarJobsPanel([], cloudCleared)).toEqual({ shown: [], notSent: [] });
  });
});
