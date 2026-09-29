/**
 * Knowledge Library data layer (src/lib/data/cards.ts, PLAN.md §8.3) against the real schema and seed:
 * default ordering, facets (including the Risk page's person + topic link), FTS search through the sanitizer and the
 * synonym index, the card page view model (evidence spans, manual-entry provenance, links, thresholds, timeline) and
 * the role rules (no gated data, every role sees every card).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeCards, type CardStatus } from "@/db/schema";
import {
  LIBRARY_STATUS_ORDER,
  MANUAL_ENTRY_LABEL,
  cardDetail,
  cardStatusLine,
  formatThreshold,
  libraryFacetsQuery,
  libraryHref,
  libraryPage,
  listCards,
  parseLibraryFacets,
  resolveLibraryFacets,
  searchCards,
  type CardRowVM,
} from "@/lib/data/cards";
import { actorFor, seededDb, type SeededDb } from "./helpers/seeded-db";

let s: SeededDb;
const owner = actorFor("owner");
const ray = actorFor("quoter", "PER-01");
const machinist = actorFor("machinist", "PER-02");
const trainee = actorFor("trainee", "PER-06");

beforeAll(() => {
  s = seededDb();
});
afterAll(() => s.sqlite.close());

const ids = (rows: CardRowVM[]) => rows.map((r) => r.id);
const roundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("listCards() default order", () => {
  it("lists all 90 seeded cards: approved first, then pending review, draft, rejected; by ID within a status", () => {
    const rows = listCards(s.db, owner);
    const total = s.db.select().from(knowledgeCards).all().length;
    expect(rows).toHaveLength(total);
    expect(total).toBe(90);

    const statusRank = (st: CardStatus) => LIBRARY_STATUS_ORDER.indexOf(st);
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1]!;
      const b = rows[i]!;
      const cmp = statusRank(a.status) - statusRank(b.status);
      expect(cmp < 0 || (cmp === 0 && a.id < b.id), `${a.id} before ${b.id}`).toBe(true);
    }
    const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
    expect(counts).toEqual({ approved: 80, pending_review: 6, draft: 2, rejected: 2 });
    expect(rows[0]!.id).toBe("KC-001");
    expect(ids(rows.slice(-2))).toEqual(["KC-065", "KC-085"]);
  });

  it("labels non-approved cards with the contributor they are waiting on", () => {
    const byId = new Map(listCards(s.db, owner).map((r) => [r.id, r]));
    expect(byId.get("KC-001")!.statusLabel).toBe("Approved");
    expect(byId.get("KC-066")!.statusLabel).toBe("Draft — awaiting Maya Chen");
    expect(byId.get("KC-011")!.statusLabel).toBe("Pending review — awaiting Ray Delgado");
    expect(byId.get("KC-065")!.statusLabel).toBe("Rejected");
    expect(cardStatusLine("pending_review", "Linda Marchetti")).toBe("Pending review — awaiting Linda Marchetti");
  });

  it("rows carry title, type, contributor, confidence, topics and classification", () => {
    const kc1 = listCards(s.db, owner).find((r) => r.id === "KC-001")!;
    expect(kc1).toMatchObject({
      type: "quoting_rule",
      typeLabel: "Quoting rule",
      contributor: { id: "PER-01", name: "Ray Delgado" },
      confidence: "usually",
      confidenceLabel: "Usually",
      classification: "customer_confidential",
    });
    expect(kc1.topics.map((t) => t.id)).toEqual(["t-thin-wall", "t-quoting", "t-mat-ti64"]); // topic sort order
    expect(roundTrip(kc1)).toEqual(kc1);
  });
});

describe("facets", () => {
  it("filters by type, status and classification", () => {
    const tips = listCards(s.db, owner, { type: "setup_tip" });
    expect(tips.length).toBeGreaterThan(0);
    expect(tips.every((r) => r.type === "setup_tip")).toBe(true);

    expect(ids(listCards(s.db, owner, { status: "draft" }))).toEqual(["KC-066", "KC-070"]);
    expect(ids(listCards(s.db, owner, { status: "rejected" }))).toEqual(["KC-065", "KC-085"]);

    const ec = listCards(s.db, owner, { classification: "export_controlled" });
    expect(ec).toHaveLength(12);
    expect(ec.every((r) => r.classification === "export_controlled")).toBe(true);
    expect(ids(ec)).toContain("KC-026");
  });

  it("person + topic (the Risk page's Open in Library link) returns that contributor's cards on that topic", () => {
    const page = libraryPage(s.db, owner, { person: "PER-01", topic: "t-mat-ti64" });
    expect(page.facets).toEqual({ person: "PER-01", topic: "t-mat-ti64" });
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.rows.every((r) => r.contributor.id === "PER-01" && r.topics.some((t) => t.id === "t-mat-ti64"))).toBe(true);
    expect(ids(page.rows)).toEqual(expect.arrayContaining(["KC-001", "KC-002"]));
    expect(page.activeFilters.map((f) => [f.label, f.valueLabel, f.removeHref])).toEqual([
      ["Contributor", "Ray Delgado", "/library?topic=t-mat-ti64"],
      ["Topic", "Titanium (Ti-6Al-4V)", "/library?person=PER-01"],
    ]);
    expect(page.totalCards).toBe(90);
  });

  it("machine, material and customer match direct links, filed topics, and the records behind linked jobs", () => {
    expect(ids(listCards(s.db, owner, { machine: "m-dmu50" }))).toContain("KC-002"); // machine link
    expect(ids(listCards(s.db, owner, { material: "mat-ti64" }))).toContain("KC-001"); // material link + topic
    const graymoor = ids(listCards(s.db, owner, { customer: "CUS-05" }));
    expect(graymoor).toContain("KC-012"); // direct customer link
    expect(graymoor).toContain("KC-026"); // linked only to J-A10, a Graymoor job
    expect(ids(listCards(s.db, owner, { customer: "CUS-06" }))).not.toContain("KC-026");
  });

  it("combines facets with AND", () => {
    const rows = listCards(s.db, owner, { person: "PER-01", status: "pending_review" });
    expect(ids(rows)).toEqual(["KC-011", "KC-012"]);
  });

  it("drops malformed and unknown facet values instead of filtering silently (never echoed)", () => {
    expect(parseLibraryFacets({ type: "bogus", status: ["approved", "draft"], person: "PER-01; drop table", classification: "secret" })).toEqual({
      status: "approved",
    });
    expect(resolveLibraryFacets(s.db, { person: "PER-99", topic: "t-nope", machine: "m-dmu50", customer: " CUS-01 " })).toEqual({
      machine: "m-dmu50",
      customer: "CUS-01",
    });
    expect(libraryPage(s.db, owner, { material: "mat-unobtainium" }).rows).toHaveLength(90);
  });

  it("facet URLs use a fixed key order", () => {
    expect(libraryFacetsQuery({ topic: "t-mat-ti64", person: "PER-01", type: "setup_tip" })).toBe("type=setup_tip&person=PER-01&topic=t-mat-ti64");
    expect(libraryHref({})).toBe("/library");
  });

  it("facet options list every value with a visible label and mark the selection", () => {
    const page = libraryPage(s.db, owner, { type: "failure_story" });
    const byKey = Object.fromEntries(page.facetGroups.map((g) => [g.key, g]));
    expect(Object.keys(byKey)).toEqual(["type", "status", "person", "topic", "machine", "material", "customer", "classification"]);
    expect(byKey.type!.selected).toBe("failure_story");
    expect(byKey.status!.options.map((o) => o.value)).toEqual(["approved", "pending_review", "draft", "rejected"]);
    expect(byKey.person!.options).toHaveLength(8);
    expect(byKey.topic!.options).toHaveLength(28);
    expect(byKey.classification!.options.map((o) => o.label)).toEqual(["General", "Internal", "Customer-confidential", "Export-controlled"]);
  });
});

describe("searchCards() (FTS5 through toFtsQuery + the synonym index)", () => {
  it('"thin-wall Ti" finds KC-001 at the top', () => {
    const r = searchCards(s.db, owner, "thin-wall Ti");
    expect(r.searched).toBe(true);
    expect(r.rows[0]!.id).toBe("KC-001");
    expect(ids(r.rows)).toContain("KC-002");
  });

  it('"Ti-6Al-4V" and other FTS5-hostile text never throw', () => {
    expect(() => searchCards(s.db, owner, "Ti-6Al-4V")).not.toThrow();
    expect(searchCards(s.db, owner, "Ti-6Al-4V").rows.length).toBeGreaterThan(0);
    for (const q of ['"unbalanced', "NEAR(a b)", "title:thin", "a* OR ^b", "-", "AND OR NOT", "17-4 PH (manifold)"]) {
      expect(() => searchCards(s.db, owner, q), q).not.toThrow();
    }
  });

  it("expands synonyms from the seeded vocabulary (thousandths → thou)", () => {
    const direct = new Set(ids(searchCards(s.db, owner, "thou").rows));
    const viaSynonym = ids(searchCards(s.db, owner, "thousandths").rows);
    expect(viaSynonym.length).toBeGreaterThan(0);
    expect(viaSynonym.every((id) => direct.has(id))).toBe(true);
  });

  it("an empty or stopword-only query returns the default list (searched: false)", () => {
    const all = ids(listCards(s.db, owner));
    for (const q of ["", "   ", "how do we the", "?!"]) {
      const r = searchCards(s.db, owner, q);
      expect(r.searched, q).toBe(false);
      expect(ids(r.rows), q).toEqual(all);
    }
    expect(ids(searchCards(s.db, owner, "the", { status: "draft" }).rows)).toEqual(["KC-066", "KC-070"]);
  });

  it("a query with no hits returns an empty result", () => {
    expect(searchCards(s.db, owner, "zzqxv")).toEqual({ searched: true, rows: [] });
  });

  it("facets narrow search results", () => {
    const all = searchCards(s.db, owner, "thin-wall Ti");
    const marv = searchCards(s.db, owner, "thin-wall Ti", { person: "PER-02" });
    expect(marv.rows.every((r) => r.contributor.id === "PER-02")).toBe(true);
    expect(marv.rows.length).toBeLessThan(all.rows.length);
    expect(searchCards(s.db, owner, "Graymoor", { classification: "export_controlled" }).rows.every((r) => r.classification === "export_controlled")).toBe(true);
  });

  it("finds non-approved cards too (the library shows every status)", () => {
    expect(ids(searchCards(s.db, owner, "source inspector").rows)).toContain("KC-012"); // pending review
  });
});

describe("cardDetail()", () => {
  it("returns null for an unknown or malformed ID", () => {
    expect(cardDetail(s.db, owner, "KC-999")).toBeNull();
    expect(cardDetail(s.db, owner, "../KC-001")).toBeNull();
    expect(cardDetail(s.db, owner, "")).toBeNull();
  });

  it("KC-002: evidence with exact span offsets, labelled as a hand entry, and no hidden-session IDs", () => {
    const vm = cardDetail(s.db, owner, "KC-002")!;
    expect(vm).toMatchObject({
      id: "KC-002",
      version: 1,
      supersedesId: null,
      type: "setup_tip",
      status: "approved",
      classification: "customer_confidential",
      confidence: "always",
      contributor: { id: "PER-01", name: "Ray Delgado", jobTitle: "Lead Quoter / Estimator" },
    });
    expect(vm.evidence).toHaveLength(1);
    const ev = vm.evidence[0]!;
    const row = s.sqlite.prepare("select e.start_char, e.end_char, e.quote, t.text from card_evidence e join interview_turns t on t.id = e.turn_id where e.card_id = 'KC-002'").get() as {
      start_char: number;
      end_char: number;
      quote: string;
      text: string;
    };
    expect(ev.startChar).toBe(row.start_char);
    expect(ev.endChar).toBe(row.end_char);
    expect(ev.quote).toBe(row.quote);
    expect(row.text.slice(ev.startChar, ev.endChar)).toBe(ev.quote);
    expect(ev.context).toEqual({ before: "", match: ev.quote, after: "" });
    expect(ev.source).toEqual({ kind: "manual", label: MANUAL_ENTRY_LABEL, date: "2025-12-13" });
    expect(ev.supportsConfidence).toBe(true);
    expect(JSON.stringify(vm)).not.toMatch(/INT-M-/);
    expect(roundTrip(vm)).toEqual(vm);
  });

  it("KC-002: links as chips with routes (job → /jobs, machine → /machines) and the status timeline", () => {
    const vm = cardDetail(s.db, owner, "KC-002")!;
    expect(vm.links.map((l) => [l.kind, l.id, l.label, l.href])).toEqual([
      ["job", "J-A02", "RJ-25-1124", "/jobs/J-A02"],
      ["machine", "m-dmu50", "DMG MORI DMU 50", "/machines/m-dmu50"],
    ]);
    expect(vm.links[0]!.classification).toBe("customer_confidential");
    expect(vm.links[1]!.classification).toBeNull();
    expect(vm.timeline).toEqual([
      { kind: "created", date: "2025-12-13", text: "Entered by hand from the binder" },
      { kind: "approved", date: "2025-12-15", text: "Approved by Ray Delgado" },
    ]);
    expect(vm.topics.map((t) => t.id)).toEqual(["t-thin-wall", "t-m-dmu50", "t-mat-ti64"]);
    expect(vm.tags.length).toBeGreaterThan(0);
  });

  it("interview evidence shows the quote inside its turn, labelled with the interview title and date", () => {
    const vm = cardDetail(s.db, owner, "KC-005")!;
    const partial = vm.evidence.find((e) => e.startChar > 0)!;
    expect(partial.context).not.toBeNull();
    expect(partial.context!.match).toBe(partial.quote);
    expect(partial.context!.before.length).toBe(partial.startChar);
    expect(partial.context!.before + partial.context!.match + partial.context!.after).toContain(partial.quote);
    expect(partial.source).toEqual({
      kind: "interview",
      interviewId: "INT-01",
      title: "Outside processing on the Halvorsen end cap",
      turnSeq: 10,
      date: "2026-06-10",
    });
  });

  it("every card's evidence resolves inside its turn, and manual-entry sources are always labelled as such", () => {
    const allIds = s.db.select({ id: knowledgeCards.id }).from(knowledgeCards).all().map((r) => r.id);
    for (const id of allIds) {
      const vm = cardDetail(s.db, owner, id)!;
      expect(vm.evidence.length, id).toBeGreaterThan(0);
      for (const e of vm.evidence) {
        expect(e.context?.match, id).toBe(e.quote);
        if (e.source.kind === "manual") expect(e.source.label).toBe(MANUAL_ENTRY_LABEL);
        else expect(e.source.interviewId, id).toMatch(/^INT-\d+$/);
      }
      expect(JSON.stringify(vm), id).not.toMatch(/INT-M-/);
    }
  });

  it("KC-026 is flagged export-controlled, and so is its linked job", () => {
    const vm = cardDetail(s.db, owner, "KC-026")!;
    expect(vm.classification).toBe("export_controlled");
    expect(vm.links.find((l) => l.kind === "job")).toMatchObject({ id: "J-A10", href: "/jobs/J-A10", classification: "export_controlled" });
    expect(listCards(s.db, owner).find((r) => r.id === "KC-026")!.classification).toBe("export_controlled");
  });

  it("quote links point at /jobs/{quoteId}; customers are shown by name only", () => {
    const vm = cardDetail(s.db, owner, "KC-006")!;
    expect(vm.links.find((l) => l.kind === "quote")).toMatchObject({ id: "Q-A06", href: "/jobs/Q-A06" });
    const withCustomer = cardDetail(s.db, owner, "KC-012")!;
    expect(withCustomer.links).toEqual([
      { kind: "customer", id: "CUS-05", label: "Graymoor Defense Systems", detail: null, href: null, classification: "customer_confidential", mention: null },
    ]);
  });

  it("parts show their part number and have no page link", () => {
    const vm = cardDetail(s.db, owner, "KC-013")!;
    expect(vm.links.find((l) => l.kind === "part")).toMatchObject({ id: "PRT-I01", label: "RP-FX-101 rev A", href: null });
  });

  it("pending, draft and rejected cards: timeline says who it's waiting on, or shows the review notes", () => {
    expect(cardDetail(s.db, owner, "KC-066")!.timeline.at(-1)).toEqual({ kind: "awaiting", text: "Draft — awaiting Maya Chen" });
    expect(cardDetail(s.db, owner, "KC-011")!.timeline.at(-1)).toEqual({ kind: "awaiting", text: "Pending review — awaiting Ray Delgado" });
    const rejected = cardDetail(s.db, owner, "KC-065")!.timeline.at(-1)!;
    expect(rejected.kind).toBe("rejected");
    expect(rejected.kind === "rejected" && rejected.notes).toMatch(/^Rejected by Ray\./);
  });

  it("thresholds keep the verbatim words next to the normalized value", () => {
    expect(cardDetail(s.db, owner, "KC-013")!.thresholds).toEqual([
      { quantity: "lowest cut feature above the top of the dovetail jaws", verbatim: "at least 3/4 inch above the top of the jaws", normalized: "≥ 0.750 in" },
    ]);
    expect(cardDetail(s.db, owner, "KC-036")!.thresholds[0]).toMatchObject({ verbatim: "under a thou of total tolerance", normalized: "< 0.001 in" });
    expect(cardDetail(s.db, owner, "KC-066")!.openQuestions.length).toBe(1);
  });
});

describe("formatThreshold()", () => {
  const t = (comparator: "<" | "<=" | "=" | ">=" | ">" | "between" | "approx", value: number | null, unit: string | null, value_max: number | null = null) =>
    formatThreshold({ comparator, value, value_max, unit });

  it("formats inches in thousandths, other units trimmed", () => {
    expect(t("<", 0.04, "in")).toBe("< 0.040 in");
    expect(t("approx", 0.0004, "in")).toBe("≈ 0.0004 in");
    expect(t(">", 2, "in")).toBe("> 2 in");
    expect(t("=", 0.02, "in")).toBe("= 0.020 in");
    expect(t("approx", 3, "h")).toBe("≈ 3 h");
    expect(t("=", 35, "%")).toBe("= 35 %");
    expect(t(">", 10, "x")).toBe("> 10×");
    expect(t(">=", 8, null)).toBe("≥ 8");
    expect(t("<=", 1.5, "in")).toBe("≤ 1.5 in");
  });

  it("handles ranges and missing values", () => {
    expect(t("between", 0.03, "in", 0.04)).toBe("0.030–0.040 in");
    expect(t("between", 2, "h", null)).toBe("2 h");
    expect(t("<", null, "in")).toBeNull();
  });
});

describe("roles", () => {
  it("every role sees the same cards (no card field is gated) and no pricing or contact data", () => {
    const base = ids(listCards(s.db, owner));
    for (const actor of [ray, machinist, trainee]) expect(ids(listCards(s.db, actor))).toEqual(base);

    const prices = s.sqlite.prepare("select unit_price_usd, total_price_usd from quote_financials where quote_id in ('Q-A06', 'Q-A10')").all() as {
      unit_price_usd: number;
      total_price_usd: number;
    }[];
    const contacts = s.sqlite.prepare("select contact_email from customer_accounts").all() as { contact_email: string }[];
    for (const actor of [machinist, trainee, owner]) {
      const json = JSON.stringify([cardDetail(s.db, actor, "KC-006"), cardDetail(s.db, actor, "KC-026"), cardDetail(s.db, actor, "KC-012")]);
      for (const p of prices) {
        expect(json).not.toContain(String(p.unit_price_usd));
        expect(json).not.toContain(String(p.total_price_usd));
      }
      for (const c of contacts) expect(json).not.toContain(c.contact_email);
    }
  });

  it("marks the viewer's own cards", () => {
    const mine = listCards(s.db, ray).filter((r) => r.isMine);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.contributor.id === "PER-01")).toBe(true);
    expect(listCards(s.db, owner).some((r) => r.isMine)).toBe(false); // the owner persona has no people row
    expect(cardDetail(s.db, ray, "KC-001")!.isMine).toBe(true);
    expect(cardDetail(s.db, machinist, "KC-001")!.isMine).toBe(false);
  });
});
