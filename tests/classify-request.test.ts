import { beforeAll, describe, expect, it } from "vitest";
import { analyzeText, type EntityDictionary } from "@/lib/policy/entity-detect";
import { classifyRequest } from "@/lib/policy/classify-request";
import { decide } from "@/lib/policy/decide";
import { loadDictionaryInput } from "@/lib/data/dictionary";
import { buildRedactionDictionary } from "@/lib/redaction";
import type { Classification } from "@/db/schema/enums";
import type { RecordRef } from "@/lib/ai/types";
import { env } from "./fixtures/routing-env";
import { RAY_LIVE_TURNS } from "./fixtures/ray-live";
import { seedDictionaryInput } from "./helpers/dictionary";
import { policyTarget } from "./helpers/policy";
import { seededDb } from "./helpers/seeded-db";

let dbDict: EntityDictionary;
let seedDict: EntityDictionary;

beforeAll(() => {
  const { db, sqlite } = seededDb();
  dbDict = buildRedactionDictionary(loadDictionaryInput(db)).entityDict;
  seedDict = buildRedactionDictionary(seedDictionaryInput()).entityDict;
  sqlite.close();
});

const cloud = () => policyTarget("anthropic", env());
const MAYA_QUESTION = "How do we quote thin-wall Ti brackets for Aerovance?";

function classify(text: string, pinned: { ref: RecordRef; classification: Classification }[] = []) {
  return classifyRequest({ text, taskFloor: "internal", session: null, pinned }, dbDict);
}

function cloudDecision(text: string, pinned: { ref: RecordRef; classification: Classification }[] = []) {
  return decide({
    mode: "cloud",
    request: classify(text, pinned),
    budget: [],
    targets: { cloud: cloud(), local: null, ecTarget: null },
    excludeAboveClearance: false,
    confirmNotControlled: false,
    pinned,
  });
}

describe("P3 classification against the seeded database (PLAN.md §12)", () => {
  it("the DB-built dictionary analyzes text exactly like the seed-built one", () => {
    const corpus = [
      MAYA_QUESTION,
      "Ask the shop about RJ-26-0310 and GDS-4410-120",
      "the 4410 manifold for Graymor",
      "Ray Delgado, Velmont and AV-2231-07C",
      ...RAY_LIVE_TURNS.map((t) => t.text),
    ];
    for (const text of corpus) expect(analyzeText(text, dbDict)).toEqual(analyzeText(text, seedDict));
  });

  it("a pinned export-controlled job, its typed job number or its part number → blocked in Cloud, nothing sent", () => {
    const pinned = [{ ref: { kind: "job" as const, id: "J-A10" }, classification: "export_controlled" as const }];
    const d1 = cloudDecision("What should we watch on this job?", pinned);
    expect(d1).toMatchObject({ kind: "blocked", reason: "request_not_cleared" });
    expect(d1.notice?.params.recordIds).toBe("J-A10");
    for (const text of ["What went wrong on RJ-26-0310?", "Setup notes for GDS-4410-120?"]) {
      expect(classify(text).floor).toBe("export_controlled");
      expect(cloudDecision(text).kind).toBe("blocked");
    }
  });

  it("'the 4410 manifold' and the near-miss 'Graymor' → held (looks controlled), with no 'send anyway'", () => {
    for (const text of ["How long did the 4410 manifold take?", "What does Graymor want on first articles?"]) {
      const c = classify(text);
      expect(c.detectorHit).toBe(true);
      expect(cloudDecision(text)).toMatchObject({ kind: "held", canSendAnyway: false });
    }
  });

  it("'Graymoor' alone → customer_confidential (naming a defense customer isn't export-controlled) and sent", () => {
    const c = classify("What does Graymoor want on first articles?");
    expect(c.floor).toBe("customer_confidential");
    expect(c.detectorHit).toBe(false);
    expect(cloudDecision("What does Graymoor want on first articles?").kind).toBe("allow");
  });

  it("Maya's question → customer_confidential and not held", () => {
    const c = classify(MAYA_QUESTION);
    expect(c.floor).toBe("customer_confidential");
    expect(c.signals).toEqual([]);
    expect(cloudDecision(MAYA_QUESTION).kind).toBe("allow");
  });

  it("the scripted interview turns (T0, R1–R4) trigger no suspicion signal", () => {
    for (const t of RAY_LIVE_TURNS) expect(classify(t.text).signals, t.key).toEqual([]);
  });

  it("only raises: session and pinned records lift the floor, the task floor is a minimum", () => {
    const c = classifyRequest({ text: "hello", taskFloor: "internal", session: "customer_confidential", pinned: [] }, dbDict);
    expect(c.floor).toBe("customer_confidential");
    expect(c.sources).toEqual({ text: "general", session: "customer_confidential", pinned: "general", task: "internal" });
  });
});
