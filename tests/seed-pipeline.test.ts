import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDb, type Db } from "@/db/client";
import { aiAuditLog } from "@/db/schema";
import { countSeededRows, resetDatabase, ResetError } from "@/db/reset";
import { bundleRowCounts, type SeedBundle } from "@/lib/seed/bundle";
import { buildSeedBundle, RESERVED, type BuildResult } from "@/lib/seed/build";
import { LOCK_FILE, readSeedSources } from "@/lib/seed/files";
import { normalizeText, type SeedSources } from "@/lib/seed/source";
import { toFtsQuery } from "@/lib/retrieval/fts-query";

const DEMO_QUESTION = "How do we quote thin-wall Ti brackets for Aerovance?";

let sources: SeedSources;
let result: BuildResult;
let bundle: SeedBundle;

beforeAll(() => {
  sources = readSeedSources();
  result = buildSeedBundle(sources);
  bundle = result.bundle!;
});

const errorsOf = (r: BuildResult) => r.issues.filter((i) => i.severity === "error");
const withFile = (file: string, edit: (text: string) => string): SeedSources => {
  expect(sources[file], file).toBeDefined();
  const next = edit(sources[file]);
  expect(next, `edit to ${file} changed nothing`).not.toBe(sources[file]);
  return { ...sources, [file]: next };
};

describe("seed bundle", () => {
  it("builds from seed-data/ with no errors", () => {
    expect(errorsOf(result)).toEqual([]);
    expect(bundle).not.toBeNull();
  });

  it("is deterministic and matches seed-data/seed.lock.json", () => {
    expect(buildSeedBundle(readSeedSources()).bundle!.hash).toBe(bundle.hash);
    const lock = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8")) as { hash: string; rows: Record<string, number> };
    expect(bundle.hash, "seed-data changed without a new lock: run npm run seed:lock and commit it").toBe(lock.hash);
    expect(bundleRowCounts(bundle)).toEqual(lock.rows);
  });

  it("hashes identically from a Windows (CRLF + BOM) checkout", () => {
    const crlf = Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, normalizeText("﻿" + v.replace(/\n/g, "\r\n"))]));
    expect(buildSeedBundle(crlf).bundle!.hash).toBe(bundle.hash);
  });

  it("holds every demo invariant", () => {
    const inv = result.report.invariants!;
    expect(inv.golden.length).toBeGreaterThan(10);
    expect(inv.golden.filter((g) => !g.ok)).toEqual([]);
    expect(inv.spofBefore).toEqual(["PER-01|t-mat-ti64", "PER-01|t-thin-wall"]);
    expect(inv.similarJobs.slice(0, 3).map((j) => j.id).sort()).toEqual(["J-A02", "J-A03", "J-A04"]);
    expect(inv.similarJobs[3].id).toBe("J-A06");
    expect(inv.varianceRatio!).toBeGreaterThanOrEqual(2.5);
  });

  it("never contains reserved demo IDs", () => {
    const ids = [...bundle.tables.knowledgeCards.map((c) => c.id), ...bundle.tables.interviews.map((i) => i.id), ...bundle.tables.documents.map((d) => d.id)];
    for (const id of [...RESERVED.cards, ...RESERVED.interviews, ...RESERVED.documents]) expect(ids).not.toContain(id);
  });

  it("traces every card to an exact span of an expert turn", () => {
    const turns = new Map(bundle.tables.interviewTurns.map((t) => [t.id, t]));
    for (const card of bundle.tables.knowledgeCards) {
      const ev = bundle.tables.cardEvidence.filter((e) => e.cardId === card.id);
      expect(ev.length, card.id).toBeGreaterThan(0);
      for (const e of ev) {
        const turn = turns.get(e.turnId)!;
        expect(turn.speaker).toBe("expert");
        expect(turn.text.slice(e.startChar, e.endChar)).toBe(e.quote);
      }
    }
  });

  it("keys each binder/manual card's provenance turn to its card number (stable IDs)", () => {
    const ev = bundle.tables.cardEvidence.find((e) => e.cardId === "KC-026")!;
    expect(ev.turnId).toBe("INT-M-PER-02-T026");
    const turn = bundle.tables.interviewTurns.find((t) => t.id === ev.turnId)!;
    expect(turn.seq).toBe(26);
  });

  it("derives classifications from customers, export control, links and overrides", () => {
    const get = <T extends { id: string }>(rows: T[], id: string) => rows.find((r) => r.id === id)!;
    const t = bundle.tables;
    expect(get(t.parts, "PRT-A01").classification).toBe("customer_confidential");
    expect(get(t.parts, "PRT-A06").classification).toBe("export_controlled");
    expect(get(t.parts, "PRT-A09")).toMatchObject({ classification: "customer_confidential", classificationSource: "override_down" });
    expect(get(t.parts, "PRT-A09").classificationReason).toBeTruthy();
    expect(get(t.jobs, "J-A10").classification).toBe("export_controlled");
    expect(get(t.jobs, "J-A09").classification).toBe("customer_confidential");
    expect(get(t.quotes, "Q-A01").classification).toBe("customer_confidential");
    expect(get(t.knowledgeCards, "KC-007").classification).toBe("general");
    expect(get(t.knowledgeCards, "KC-026").classification).toBe("export_controlled");
    expect(get(t.interviews, "INT-02").classification).toBe("export_controlled");
    const con = t.consentRecords.find((c) => c.interviewId === "INT-02")!;
    expect(con).toMatchObject({ targetClass: "ollama_local", endpointHost: "127.0.0.1" });
  });

  it("carries PRT-A09's logged override down to its quotes and job", () => {
    const t = bundle.tables;
    for (const row of [...t.quotes.filter((q) => q.partId === "PRT-A09"), ...t.jobs.filter((j) => j.partId === "PRT-A09")]) {
      expect(row, row.id).toMatchObject({ classification: "customer_confidential", classificationSource: "override_down" });
      expect(row.classificationReason).toMatch(/PRT-A09/);
    }
  });

  it("keeps prices out of search columns", () => {
    for (const q of bundle.tables.quotes) expect(`${q.searchTitle} ${q.searchText} ${q.searchTags}`).not.toMatch(/\$|\bUSD\b/);
    for (const c of bundle.tables.knowledgeCards) expect(`${c.searchText} ${c.searchTags}`).not.toMatch(/\$\s?\d/);
  });
});

describe("seed:check catches broken edits", () => {
  it("rejects an evidence quote that isn't in the transcript, naming the file and line", () => {
    const r = buildSeedBundle(withFile("cards/PER-01-ray-delgado.yaml", (t) => t.replace("We added a finish op after heat treat on every part", "We added two finish ops after heat treat")));
    expect(r.bundle).toBeNull();
    const e = errorsOf(r).find((i) => i.code === "traceability:evidence_not_substring")!;
    expect(e).toMatchObject({ file: "cards/PER-01-ray-delgado.yaml" });
    expect(e.line).toBeGreaterThan(100);
  });

  it("rejects a number the expert never said", () => {
    const r = buildSeedBundle(withFile("cards/PER-03-linda-marchetti.yaml", (t) => t.replace("sit unclamped for an hour before", "sit unclamped for 2 hours before")));
    expect(errorsOf(r).some((i) => i.code === "traceability:number_unsupported")).toBe(true);
  });

  it("rejects an invented number even when it looks like a material number", () => {
    const r = buildSeedBundle(withFile("demo/ray-live-interview.yaml", (t) => t.replace('actions: ["add thirty-five percent to finishing",', 'actions: ["budget 718 hours for finishing", "add thirty-five percent to finishing",')));
    expect(errorsOf(r).some((i) => i.code === "traceability:number_unsupported")).toBe(true);
  });

  it("raises a job whose debrief names an export-controlled job", () => {
    const r = buildSeedBundle(withFile("quotes/anchors.yaml", (t) => t.replace("debrief: Ran close to quote. Finisher changed on a schedule; walls held size.", "debrief: Ran close to quote, same fixture as RJ-26-0310.")));
    expect(errorsOf(r)).toEqual([]);
    expect(r.bundle!.tables.jobs.find((j) => j.id === "J-A02")).toMatchObject({ classification: "export_controlled" });
  });

  it("warns about a seed file the loader doesn't read", () => {
    const r = buildSeedBundle({ ...sources, "cards/PER-04-tomas-ibarra.yml": "[]\n" });
    expect(r.issues.some((i) => i.code === "unused_file" && i.file === "cards/PER-04-tomas-ibarra.yml")).toBe(true);
  });

  it("rejects an expertise edit that moves Ray's suggested next interview", () => {
    const r = buildSeedBundle(withFile("demo/anchors.yaml", (t) => t.replace("top_topic: { PER-01: t-mat-in718 }", "top_topic: { PER-01: t-cus-01 }")));
    expect(errorsOf(r).some((i) => i.code === "demo_invariant" && i.message.includes("top risk"))).toBe(true);
  });

  it("rejects a reserved card ID", () => {
    const r = buildSeedBundle(withFile("cards/PER-02-marv-tollefson.yaml", (t) => t.replace("- id: KC-021", "- id: KC-091")));
    expect(errorsOf(r).some((i) => i.code === "reserved")).toBe(true);
  });

  it("rejects a classification below the derived floor", () => {
    const r = buildSeedBundle(withFile("cards/PER-02-marv-tollefson.yaml", (t) => t.replace("  created_on: \"2026-05-11\"", "  classification: internal\n  created_on: \"2026-05-11\"")));
    expect(errorsOf(r).some((i) => i.code === "classification")).toBe(true);
  });

  it("rejects an unknown tag and a missing link rule", () => {
    const r = buildSeedBundle(withFile("cards/PER-02-marv-tollefson.yaml", (t) => t.replace("tags: [titanium, tool-wear, first-article]", "tags: [titanium, tool-wear, first-artcle]").replace("links: { jobs: [J-A02], machine: m-dmu50 }", "links: { machine: m-dmu50 }")));
    const codes = errorsOf(r).map((i) => i.code);
    expect(codes).toContain("fk");
    expect(codes).toContain("link_rule");
  });

  it("rejects an edit that breaks a pinned demo value", () => {
    const r = buildSeedBundle(withFile("quotes/anchors.yaml", (t) => t.replace("  quoted_hours: 58.0", "  quoted_hours: 60.0")));
    expect(errorsOf(r).some((i) => i.code === "demo_invariant" && i.message.includes("Q-A01.quoted_hours"))).toBe(true);
  });

  it("rejects an expertise edit that changes the golden numbers", () => {
    const r = buildSeedBundle(withFile("expertise-matrix.csv", (t) => t.replace(/^t-mat-ti64,([^,]*),3,1,/m, "t-mat-ti64,$1,3,2,")));
    expect(errorsOf(r).some((i) => i.code === "demo_invariant")).toBe(true);
  });

  it("rejects a scripted card whose evidence drifts from Ray's words", () => {
    const r = buildSeedBundle(withFile("demo/ray-live-interview.yaml", (t) => t.replace('quote: "Every time now."', 'quote: "Every single time."')));
    expect(errorsOf(r).some((i) => i.file === "demo/ray-live-interview.yaml" && i.code.startsWith("traceability"))).toBe(true);
  });
});

describe("resetDatabase", () => {
  let dir: string;
  let db: Db;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "floorwise-reset-"));
    db = openDb({ file: path.join(dir, "test.db"), create: true });
    migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  });
  afterAll(() => {
    db.$client.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("loads the bundle, and a second reset over existing rows gives the same data (delete order regression)", () => {
    const first = resetDatabase(db.$client, bundle, { nowIso: "2026-09-29T00:00:00Z" });
    const second = resetDatabase(db.$client, bundle, { nowIso: "2026-09-29T00:01:00Z" });
    expect(second.epoch).toBe(first.epoch + 1);
    expect(countSeededRows(db.$client)).toEqual(bundleRowCounts(bundle));
  });

  it("archives live-call audit rows before deleting them", () => {
    db.insert(aiAuditLog)
      .values({
        createdAt: "2026-09-29T00:00:00Z",
        requestId: "req-1",
        actorRole: "quoter",
        feature: "ask",
        task: "ask",
        mode: "cloud",
        decision: "allow",
        transport: "live",
        classificationsIncluded: [],
        recordsSent: [],
        recordsWithheld: [],
        tokensUsed: [],
        outcome: "ok",
        policyVersion: "test",
        appVersion: "test",
      })
      .run();
    const archived: Record<string, unknown>[] = [];
    resetDatabase(db.$client, bundle, { nowIso: "2026-09-29T00:02:00Z", archiveLiveAudit: (rows) => archived.push(...rows) });
    expect(archived).toHaveLength(1);
    expect(db.select().from(aiAuditLog).all()).toHaveLength(0);
  });

  it("refuses to delete live-call audit rows without an archiver", () => {
    db.insert(aiAuditLog)
      .values({
        createdAt: "2026-09-29T00:00:00Z",
        requestId: "req-2",
        actorRole: "quoter",
        feature: "ask",
        task: "ask",
        mode: "cloud",
        decision: "allow",
        transport: "live",
        classificationsIncluded: [],
        recordsSent: [],
        recordsWithheld: [],
        tokensUsed: [],
        outcome: "ok",
        policyVersion: "test",
        appVersion: "test",
      })
      .run();
    expect(() => resetDatabase(db.$client, bundle, { nowIso: "2026-09-29T00:03:00Z" })).toThrow(ResetError);
    expect(db.select().from(aiAuditLog).all()).toHaveLength(1);
    resetDatabase(db.$client, bundle, { nowIso: "2026-09-29T00:04:00Z", archiveLiveAudit: () => {} });
  });

  it("rebuilds full-text search so the demo question finds Ray's cards and quotes", () => {
    const q = toFtsQuery(DEMO_QUESTION)!;
    const cards = db.$client.prepare("SELECT card_id FROM cards_fts WHERE cards_fts MATCH ? ORDER BY bm25(cards_fts, 0, 10, 1, 5) LIMIT 5").all(q) as { card_id: string }[];
    expect(cards.map((c) => c.card_id)).toContain("KC-001");
    const quotes = db.$client.prepare("SELECT quote_id FROM quotes_fts WHERE quotes_fts MATCH ?").all(q) as { quote_id: string }[];
    expect(quotes.map((r) => r.quote_id)).toContain("Q-A01");
  });
});
