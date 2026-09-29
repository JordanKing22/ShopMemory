import { describe, expect, it } from "vitest";
import {
  DEFAULT_NAME_COMPOUND_STOPLIST,
  analyzeText,
  buildDictionary,
  coresOf,
  detectEntities,
  floorFromText,
  isOneEditAway,
  suspicionSignals,
  type DictionaryInput,
  type EntityDictionary,
} from "@/lib/policy/entity-detect";
import { RAY_LIVE_TURNS } from "./fixtures/ray-live";

/** Fictional fixture mirroring the demo cast (PLAN.md §7.2, §7.6). */
const INPUT: DictionaryInput = {
  customers: [
    {
      id: "CUS-01",
      name: "Aerovance",
      aliases: [],
      classification: "customer_confidential",
      partClassificationFloor: "customer_confidential",
    },
    {
      id: "CUS-05",
      name: "Graymoor Defense Systems",
      aliases: ["Graymoor"],
      classification: "customer_confidential",
      partClassificationFloor: "export_controlled",
    },
    {
      id: "CUS-06",
      name: "Velmont Guidance Systems",
      aliases: ["Velmont"],
      classification: "customer_confidential",
      partClassificationFloor: "export_controlled",
    },
  ],
  people: [
    { id: "PER-01", fullName: "Ray Delgado", aliases: ["Ray Delgado", "Delgado", "Ray"] },
    { id: "PER-05", fullName: "Maya Chen", aliases: ["Maya Chen", "Maya", "Chen"] },
    { id: "P-OWNER", fullName: "Dana Whitcomb", aliases: ["Dana Whitcomb", "Dana", "Whitcomb"] },
  ],
  parts: [
    { id: "PRT-A01", partNumber: "AV-2231-07", classification: "customer_confidential" },
    { id: "PRT-A10", partNumber: "GDS-4410-120", classification: "export_controlled" },
  ],
  jobs: [
    { id: "J-A10", jobNumber: "RJ-26-0310", classification: "export_controlled" },
    { id: "J-A03", jobNumber: "RJ-26-0203", classification: "customer_confidential" },
  ],
  quotes: [{ id: "Q-A01", quoteNumber: "RQ-26-0911", classification: "customer_confidential" }],
  stoplistNumbers: ["6061", "7075", "718", "9102", "2024", "174"],
};

const DICT = buildDictionary(INPUT);

const MAYA_QUESTION = "How do we quote thin-wall Ti brackets for Aerovance?";
const RAY_R1_EXCERPT = "Anything under forty thou in titanium moves on you, so I padded the finish passes.";
const RAY_R4_EXCERPT = "Same on Inconel 718. On 6061 I don't bother.";

function ids(text: string, dict: EntityDictionary = DICT) {
  return detectEntities(text, dict).map((m) => `${m.kind}:${m.id}`);
}

describe("buildDictionary", () => {
  it("compiles every name, alias and number into surfaces with candidates", () => {
    const texts = DICT.surfaces.map((s) => `${s.kind}:${s.text}`);
    expect(texts).toEqual(
      expect.arrayContaining([
        "customer:Aerovance",
        "customer:Graymoor Defense Systems",
        "customer:Graymoor",
        "person:Ray Delgado",
        "person:Delgado",
        "person:Ray",
        "part:AV-2231-07",
        "job:RJ-26-0310",
        "quote:RQ-26-0911",
      ]),
    );
    const ray = DICT.surfaces.find((s) => s.text === "Ray")!;
    expect(ray).toMatchObject({ kind: "person", form: "first", caseSensitive: true, classification: "internal" });
    expect(DICT.surfaces.find((s) => s.text === "Delgado")).toMatchObject({ form: "last", caseSensitive: false });
    expect(DICT.surfaces.find((s) => s.text === "Ray Delgado")).toMatchObject({ form: "full", caseSensitive: false });
  });

  it("derives numeric cores only for export-controlled parts and jobs", () => {
    expect([...DICT.numericCores.keys()].sort()).toEqual(["0310", "26-0310", "260310", "4410", "4410-120", "4410120"]);
    expect(DICT.numericCores.get("4410")).toMatchObject({ recordId: "PRT-A10", recordKind: "part" });
    expect(DICT.numericCores.get("0310")).toMatchObject({ recordId: "J-A10", recordKind: "job" });
  });

  it("watches only names/aliases of ≥ 7 characters of customers with an export-controlled part floor", () => {
    expect(DICT.nearMissTargets.map((t) => `${t.customerId}:${t.normalized}`)).toEqual([
      "CUS-05:graymoor defense systems",
      "CUS-05:graymoor",
      "CUS-06:velmont guidance systems",
      "CUS-06:velmont",
    ]);
  });

  it("is deterministic", () => {
    const again = buildDictionary(INPUT);
    expect(again.matcher.source).toBe(DICT.matcher.source);
    expect([...again.numericCores.entries()]).toEqual([...DICT.numericCores.entries()]);
  });

  it("an empty dictionary never matches", () => {
    const empty = buildDictionary({ customers: [], people: [], parts: [], jobs: [], quotes: [], stoplistNumbers: [] });
    expect(detectEntities("Ray quoted AV-2231-07 for Aerovance", empty)).toEqual([]);
    expect(floorFromText("anything", empty).floor).toBe("general");
    expect(suspicionSignals("the 4410 manifold for Graymor", empty)).toEqual([]);
  });

  it("ignores blank names and aliases", () => {
    const d = buildDictionary({
      ...INPUT,
      customers: [{ ...INPUT.customers[0], aliases: ["", "   "] }],
      people: [],
      parts: [{ id: "PRT-X", partNumber: " -- ", classification: "internal" }],
    });
    expect(d.surfaces.map((s) => s.text)).toEqual(["Aerovance", "RJ-26-0310", "RJ-26-0203", "RQ-26-0911"]);
  });
});

describe("demo-path questions (PLAN.md §4.2 P3)", () => {
  it("Maya's question: one customer mention, customer_confidential floor, no suspicion", () => {
    const { floor, mentions } = floorFromText(MAYA_QUESTION, DICT);
    expect(mentions).toEqual([
      {
        kind: "customer",
        id: "CUS-01",
        surface: "Aerovance",
        start: MAYA_QUESTION.indexOf("Aerovance"),
        end: MAYA_QUESTION.indexOf("Aerovance") + "Aerovance".length,
        classification: "customer_confidential",
      },
    ]);
    expect(floor).toBe("customer_confidential");
    expect(suspicionSignals(MAYA_QUESTION, DICT)).toEqual([]);
  });

  it("naming an export-controlled job makes the question export-controlled", () => {
    const q = "What went wrong on job RJ-26-0310?";
    const { floor, mentions } = floorFromText(q, DICT);
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toMatchObject({ kind: "job", id: "J-A10", surface: "RJ-26-0310", classification: "export_controlled" });
    expect(floor).toBe("export_controlled");
    expect(suspicionSignals(q, DICT)).toEqual([]);
  });

  it("Ray's scripted turns trigger no suspicion (718 and 6061 are stoplisted)", () => {
    expect(suspicionSignals(RAY_R1_EXCERPT, DICT)).toEqual([]);
    expect(suspicionSignals(RAY_R4_EXCERPT, DICT)).toEqual([]);
    expect(floorFromText(RAY_R4_EXCERPT, DICT).floor).toBe("general");
  });

  it("no scripted interview turn triggers suspicion or an export-controlled floor", () => {
    expect(RAY_LIVE_TURNS.length).toBeGreaterThan(0);
    for (const turn of RAY_LIVE_TURNS) {
      expect(suspicionSignals(turn.text, DICT), turn.key).toEqual([]);
      expect(floorFromText(turn.text, DICT).floor, turn.key).not.toBe("export_controlled");
    }
  });

  it("the anchor turn finds Ray, the part and the customer", () => {
    const t0 = RAY_LIVE_TURNS.find((t) => t.key === "T0")!;
    expect(ids(t0.text)).toEqual(["person:PER-01", "part:PRT-A01", "customer:CUS-01"]);
    expect(floorFromText(t0.text, DICT).floor).toBe("customer_confidential");
  });
});

describe("part, job and quote numbers", () => {
  it.each(["GDS-4410-120", "gds4410120", "GDS 4410 120", "gds.4410.120", "GDS–4410–120"])(
    "%s → PRT-A10",
    (text) => {
      const mentions = detectEntities(`see ${text} today`, DICT);
      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toMatchObject({ kind: "part", id: "PRT-A10", surface: text, classification: "export_controlled" });
    },
  );

  it.each(["AV-2231-07", "AV223107", "av 2231 07", "AV-2231-07C", "AV-2231-07-C", "av-2231-07c"])("%s → PRT-A01", (text) => {
    const mentions = detectEntities(`${text}, qty 24`, DICT);
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toMatchObject({ kind: "part", id: "PRT-A01", surface: text });
  });

  it.each(["AV-2231-07Cx", "AV-2231-071", "XAV-2231-07", "AV-2231-0", "AV--2231-07", "1AV-2231-07"])(
    "%s does not match (boundaries, one separator, one revision letter)",
    (text) => {
      expect(ids(text)).toEqual([]);
    },
  );

  it("only part numbers take a revision letter", () => {
    expect(ids("RJ-26-0310C")).toEqual([]);
    expect(ids("RQ-26-0911")).toEqual(["quote:Q-A01"]);
    expect(ids("rq260911")).toEqual(["quote:Q-A01"]);
  });

  it("reports offsets into the text", () => {
    const text = "Compare RJ-26-0203 with rj 26 0310.";
    const mentions = detectEntities(text, DICT);
    expect(mentions.map((m) => [m.id, text.slice(m.start, m.end)])).toEqual([
      ["J-A03", "RJ-26-0203"],
      ["J-A10", "rj 26 0310"],
    ]);
    expect(floorFromText(text, DICT).floor).toBe("export_controlled");
  });
});

describe("names", () => {
  it("customer names are case-insensitive with Unicode boundaries", () => {
    expect(ids("Aerovance's FAI")).toEqual(["customer:CUS-01"]);
    expect(ids("Aerovance’s FAI")).toEqual(["customer:CUS-01"]);
    expect(ids("AEROVANCE and aerovance")).toEqual(["customer:CUS-01", "customer:CUS-01"]);
    expect(ids("Aerovances")).toEqual([]);
    expect(ids("preAerovance")).toEqual([]);
  });

  it("longest match first: the full customer name wins over its alias", () => {
    const mentions = detectEntities("We shipped to Graymoor\nDefense  Systems last week.", DICT);
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toMatchObject({ id: "CUS-05", surface: "Graymoor\nDefense  Systems" });
  });

  it("naming a defense customer is customer_confidential, not export-controlled", () => {
    const { floor, mentions } = floorFromText("Graymoor", DICT);
    expect(mentions).toEqual([
      { kind: "customer", id: "CUS-05", surface: "Graymoor", start: 0, end: 8, classification: "customer_confidential" },
    ]);
    expect(floor).toBe("customer_confidential");
    expect(suspicionSignals("Graymoor", DICT)).toEqual([]);
  });

  it("longest match first: full name before first name, with person forms", () => {
    const mentions = detectEntities("Ray Delgado said Delgado and Ray agree; so does delgado.", DICT);
    expect(mentions.map((m) => [m.surface, m.id, m.form])).toEqual([
      ["Ray Delgado", "PER-01", "full"],
      ["Delgado", "PER-01", "last"],
      ["Ray", "PER-01", "first"],
      ["delgado", "PER-01", "last"],
    ]);
    expect(mentions.every((m) => m.classification === "internal")).toBe(true);
  });

  it("first names match only capitalized", () => {
    expect(ids("ask ray")).toEqual([]);
    expect(ids("RAY")).toEqual([]);
    expect(ids("Ask Ray")).toEqual(["person:PER-01"]);
    expect(ids("maya asked")).toEqual([]);
    expect(ids("Maya asked chen")).toEqual(["person:PER-05", "person:PER-05"]);
  });

  it("the owner persona is detected", () => {
    expect(ids("Dana Whitcomb approved it; whitcomb signed; Dana agreed")).toEqual([
      "person:P-OWNER",
      "person:P-OWNER",
      "person:P-OWNER",
    ]);
  });

  it("stoplisted compounds never match person names", () => {
    expect(DEFAULT_NAME_COMPOUND_STOPLIST).toEqual(["X-Ray", "Gamma Ray"]);
    expect(ids("X-Ray inspection")).toEqual([]);
    expect(ids("X Ray inspection, X‑Ray too")).toEqual([]);
    expect(ids("Gamma Ray source")).toEqual([]);
    expect(ids("Ray ordered an X-Ray")).toEqual(["person:PER-01"]);
  });

  it("the compound stoplist can be supplied as data", () => {
    const d = buildDictionary({ ...INPUT, nameCompoundStoplist: ["Ray Line"] });
    expect(ids("X-Ray inspection", d)).toEqual(["person:PER-01"]);
    expect(ids("the Ray Line fixture", d)).toEqual([]);
  });

  it("marks surfaces shared by two people as ambiguous", () => {
    const d = buildDictionary({
      ...INPUT,
      people: [
        { id: "PER-10", fullName: "Sam Okafor", aliases: ["Sam"] },
        { id: "PER-11", fullName: "Sam Lindqvist", aliases: ["Sam"] },
      ],
    });
    const [m] = detectEntities("Ask Sam.", d);
    expect(m).toMatchObject({ kind: "person", id: "PER-10", form: "first", ambiguousIds: ["PER-10", "PER-11"] });
  });

  it("short last names behave like first names", () => {
    const d = buildDictionary({ ...INPUT, people: [{ id: "PER-12", fullName: "Lin Ng", aliases: ["Ng", "Lin"] }] });
    expect(ids("Ng said", d)).toEqual(["person:PER-12"]);
    expect(ids("ng said", d)).toEqual([]);
  });

  it("normalizes to NFC so decomposed accents still match", () => {
    const d = buildDictionary({
      ...INPUT,
      people: [{ id: "PER-04", fullName: "Tomás Ibarra", aliases: ["Tomás Ibarra", "Ibarra", "Tomás", "Tomas"] }],
    });
    const decomposed = "Ask Tomás about it";
    expect(ids(decomposed, d)).toEqual(["person:PER-04"]);
    expect(ids("Tomas and TOMÁS IBARRA", d)).toEqual(["person:PER-04", "person:PER-04"]);
  });

  it("finds mentions next to punctuation and in any order", () => {
    const text = "(Maya Chen) quoted RQ-26-0911/Aerovance; Delgado reviewed.";
    expect(ids(text)).toEqual(["person:PER-05", "quote:Q-A01", "customer:CUS-01", "person:PER-01"]);
  });
});

describe("numeric-core suspicion", () => {
  it("'the 4410 manifold' → numeric_core for PRT-A10", () => {
    const text = "the 4410 manifold";
    expect(floorFromText(text, DICT)).toEqual({ floor: "general", mentions: [] });
    expect(suspicionSignals(text, DICT)).toEqual([
      {
        kind: "numeric_core",
        recordId: "PRT-A10",
        recordKind: "part",
        surface: "4410",
        start: 4,
        end: 8,
        classification: "export_controlled",
      },
    ]);
  });

  it("matches hyphen-joined and concatenated cores, one signal per record per chain", () => {
    expect(suspicionSignals("dash 4410-120 please", DICT).map((s) => [s.recordId, s.surface])).toEqual([
      ["PRT-A10", "4410-120"],
    ]);
    expect(suspicionSignals("4410120", DICT).map((s) => [s.recordId, s.surface])).toEqual([["PRT-A10", "4410120"]]);
    expect(suspicionSignals("job 0310 ran long", DICT).map((s) => [s.recordId, s.recordKind])).toEqual([["J-A10", "job"]]);
    expect(suspicionSignals("26-0310", DICT).map((s) => [s.recordId, s.surface])).toEqual([["J-A10", "26-0310"]]);
  });

  it("ignores non-standalone digits, decimals and thousands groups", () => {
    for (const text of ["44100", "14410", "x4410", "4410b", "1.4410", "4410.5", "4,410", "44,10", "4410,5"]) {
      expect(suspicionSignals(text, DICT), text).toEqual([]);
    }
    expect(suspicionSignals("4410.", DICT)).toHaveLength(1); // sentence end
  });

  it("does not signal digits inside an exact mention (the floor handles those)", () => {
    expect(suspicionSignals("GDS-4410-120", DICT)).toEqual([]);
    expect(suspicionSignals("RJ-26-0310", DICT)).toEqual([]);
    expect(analyzeText("GDS-4410-120 and the 4410 manifold", DICT).signals.map((s) => s.start)).toEqual([21]);
  });

  it("requires ≥ 4 digits, uniqueness across all numbered records, and no stoplist hit", () => {
    const d = buildDictionary({
      ...INPUT,
      parts: [
        ...INPUT.parts,
        // shares "4410" with PRT-A10, so neither owns it any more
        { id: "PRT-A20", partNumber: "AV-4410-01", classification: "customer_confidential" },
        // export-controlled, but 7075 is stoplisted and 120 is too short
        { id: "PRT-A21", partNumber: "GDS-7075-120", classification: "export_controlled" },
      ],
    });
    expect(d.numericCores.has("4410")).toBe(false);
    expect(d.numericCores.has("4410120")).toBe(true);
    expect(d.numericCores.has("7075")).toBe(false);
    expect(d.numericCores.has("120")).toBe(false);
    expect(d.numericCores.get("7075120")).toMatchObject({ recordId: "PRT-A21" });
    expect(suspicionSignals("the 4410 manifold", d)).toEqual([]);
    expect(suspicionSignals("7075 housing", d)).toEqual([]);
  });

  it("quotes never contribute cores but do break uniqueness", () => {
    const d = buildDictionary({
      ...INPUT,
      quotes: [
        ...INPUT.quotes,
        { id: "Q-A30", quoteNumber: "RQ-26-0310", classification: "export_controlled" },
      ],
    });
    expect(d.numericCores.has("0310")).toBe(false);
    expect(d.numericCores.has("260310")).toBe(false);
    expect([...d.numericCores.values()].every((c) => c.recordKind !== ("quote" as string))).toBe(true);
  });

  it("stoplist entries with letters and separators contribute their digit groups", () => {
    const d = buildDictionary({
      ...INPUT,
      parts: [{ id: "PRT-B1", partNumber: "VLM-9102", classification: "export_controlled" }],
      stoplistNumbers: ["AS9102"],
    });
    expect(d.numericCores.has("9102")).toBe(false);
    expect(suspicionSignals("per AS9102 first article, form 9102", d)).toEqual([]);
  });

  it("coresOf lists digit groups ≥ 4 and consecutive runs (hyphen-joined and concatenated)", () => {
    expect(coresOf("GDS-4410-120")).toEqual(["4410", "4410-120", "4410120"]);
    expect(coresOf("RJ-26-0310")).toEqual(["26-0310", "260310", "0310"]);
    expect(coresOf("SUR-118-204")).toEqual(["118-204", "118204"]);
    expect(coresOf("HFC-12")).toEqual([]);
  });

  it("a run of short groups never matches a single-group core (regression: '2025-12-15' vs RJ-25-1215)", () => {
    const d = buildDictionary({
      ...INPUT,
      jobs: [...INPUT.jobs, { id: "J-A06", jobNumber: "RJ-25-1215", classification: "export_controlled" }],
    });
    expect(d.numericCores.get("1215")).toMatchObject({ recordId: "J-A06" });
    for (const text of ['approved: { by: PER-02, on: "2025-12-15" }', "12-15 minutes", "12 15"]) {
      expect(suspicionSignals(text, d), text).toEqual([]);
    }
    expect(suspicionSignals("the 1215 job", d).map((s) => s.recordId)).toEqual(["J-A06"]);
    expect(suspicionSignals("25-1215", d).map((s) => s.surface)).toEqual(["25-1215"]);
    expect(suspicionSignals("251215", d).map((s) => s.surface)).toEqual(["251215"]);
  });
});

describe("near-miss customer suspicion", () => {
  it("'Graymor' → near_miss_customer for CUS-05", () => {
    expect(detectEntities("Graymor", DICT)).toEqual([]);
    expect(suspicionSignals("Graymor", DICT)).toEqual([
      {
        kind: "near_miss_customer",
        recordId: "CUS-05",
        recordKind: "customer",
        surface: "Graymor",
        start: 0,
        end: 7,
        classification: "export_controlled",
      },
    ]);
  });

  it.each([
    ["the Graymoore housings", "CUS-05", "Graymoore"],
    ["Graymoar housings", "CUS-05", "Graymoar"],
    ["GRAYMOR parts", "CUS-05", "GRAYMOR"],
    ["Gray moor fittings", "CUS-05", "Gray moor"],
    ["Gray-moor fittings", "CUS-05", "Gray-moor"],
    ["Velmon titanium", "CUS-06", "Velmon"],
    ["Velmonts new housing", "CUS-06", "Velmonts"],
    ["Graymor's manifold", "CUS-05", "Graymor"],
  ])("%s → %s", (text, id, surface) => {
    const signals = suspicionSignals(text, DICT);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ kind: "near_miss_customer", recordId: id, surface });
  });

  it("a near-miss overlapping an exact mention of the same customer is not a signal", () => {
    const text = "Velmont Guidance System";
    expect(ids(text)).toEqual(["customer:CUS-06"]);
    expect(suspicionSignals(text, DICT)).toEqual([]);
  });

  it("collapses overlapping spans for the same customer to the longest", () => {
    const text = "Graymor Defense Systems";
    const signals = suspicionSignals(text, DICT);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ recordId: "CUS-05", surface: "Graymor Defense Systems", start: 0 });
  });

  it("exact names and edit distance ≠ 1 are not near-misses", () => {
    for (const text of ["Graymoor", "graymoor", "Velmont", "Graymoor Defense Systems", "Grymr", "Velmnot", "Gray"]) {
      expect(suspicionSignals(text, DICT), text).toEqual([]);
    }
  });

  it("only customers with an export-controlled part floor are watched", () => {
    expect(suspicionSignals("Aerovanse brackets", DICT)).toEqual([]);
  });

  it("does not join words across sentence punctuation", () => {
    expect(suspicionSignals("Gray. Moor", DICT)).toEqual([]);
  });

  it("'Vermont' is one edit from 'Velmont' unless listed in nearMissIgnore", () => {
    expect(suspicionSignals("our supplier in Vermont", DICT).map((s) => s.recordId)).toEqual(["CUS-06"]);
    const d = buildDictionary({ ...INPUT, nearMissIgnore: ["Vermont"] });
    expect(suspicionSignals("our supplier in Vermont", d)).toEqual([]);
    expect(suspicionSignals("Velmon", d).map((s) => s.recordId)).toEqual(["CUS-06"]);
  });

  it("does not flag a span that is exactly another known entity", () => {
    const d = buildDictionary({
      ...INPUT,
      people: [...INPUT.people, { id: "PER-20", fullName: "Jo Velmonte", aliases: ["Velmonte"] }],
    });
    expect(ids("Velmonte", d)).toEqual(["person:PER-20"]);
    expect(suspicionSignals("Velmonte", d)).toEqual([]);
  });

  it("isOneEditAway covers insert, delete and substitute only", () => {
    expect(isOneEditAway("graymoor", "graymor")).toBe(true);
    expect(isOneEditAway("graymoor", "graymoore")).toBe(true);
    expect(isOneEditAway("graymoor", "graymoar")).toBe(true);
    expect(isOneEditAway("graymoor", "graymoor")).toBe(false);
    expect(isOneEditAway("velmont", "velmnot")).toBe(false);
    expect(isOneEditAway("velmont", "vel")).toBe(false);
    expect(isOneEditAway("tomás", "tomas")).toBe(true);
  });
});

describe("analyzeText", () => {
  it("returns floor, mentions and signals in one pass, sorted by position", () => {
    const text = "Graymor wants the 4410 manifold again; Maya Chen asked about RJ-26-0203.";
    const result = analyzeText(text, DICT);
    expect(result.floor).toBe("customer_confidential");
    expect(result.mentions.map((m) => m.id)).toEqual(["PER-05", "J-A03"]);
    expect(result.signals.map((s) => [s.kind, s.recordId])).toEqual([
      ["near_miss_customer", "CUS-05"],
      ["numeric_core", "PRT-A10"],
    ]);
    expect(result.signals).toEqual(suspicionSignals(text, DICT));
  });
});

describe("scale", () => {
  it("handles a seed-sized dictionary (60 parts, 74 jobs, 120 quotes)", () => {
    const pad = (n: number, w: number) => String(n).padStart(w, "0");
    const d = buildDictionary({
      ...INPUT,
      parts: [
        ...INPUT.parts,
        ...Array.from({ length: 58 }, (_, i) => ({
          id: `PRT-G${pad(i, 2)}`,
          partNumber: `QRL-${pad(500000 + i * 37, 6)}`,
          classification: "customer_confidential" as const,
        })),
      ],
      jobs: [
        ...INPUT.jobs,
        ...Array.from({ length: 72 }, (_, i) => ({
          id: `J-G${pad(i, 2)}`,
          jobNumber: `RJ-25-${pad(1000 + i, 4)}`,
          classification: (i % 4 === 0 ? "export_controlled" : "customer_confidential") as
            | "export_controlled"
            | "customer_confidential",
        })),
      ],
      quotes: Array.from({ length: 120 }, (_, i) => ({
        id: `Q-G${pad(i, 3)}`,
        quoteNumber: `RQ-25-${pad(3000 + i, 4)}`,
        classification: "customer_confidential" as const,
      })),
    });
    expect(ids("Job RJ-25-1008 and QRL-500037 and RQ-25-3119", d)).toEqual(["job:J-G08", "part:PRT-G01", "quote:Q-G119"]);
    expect(floorFromText("rj251008", d).floor).toBe("export_controlled");
    expect(suspicionSignals("the 1008 run", d).map((s) => s.recordId)).toEqual(["J-G08"]);
    expect(suspicionSignals("the 1009 run", d)).toEqual([]); // customer_confidential job
    expect(suspicionSignals(MAYA_QUESTION, d)).toEqual([]);
  });
});
