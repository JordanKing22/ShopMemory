/**
 * People data layer (src/lib/data/people.ts) against the real seeded database.
 * Departure gate: PLAN.md §4.8 and docs/DATA-LAYER.md rule 4. Golden numbers: PLAN.md §6 (Ray's deep coverage 18.2).
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { departureText, DepartureValue } from "@/components/people/departure-value";
import { PersonCardGroups } from "@/components/people/card-groups";
import { PeopleTable } from "@/components/people/people-table";
import { PersonTopicGroups } from "@/components/people/topic-groups";
import type { Db } from "@/db/client";
import type { Role } from "@/lib/auth/roles";
import { listPeople, markShopNameFictional, personProfile, tenureLabels, type PeopleListVM, type PersonProfileVM } from "@/lib/data/people";
import { actorFor, seededDb } from "./helpers/seeded-db";

const RAY = "PER-01";
const HOLDERS = ["PER-01", "PER-02", "PER-03", "PER-04", "PER-05", "PER-06", "PER-07", "PER-08"];
/** Planned departures in the seed (PLAN.md §7.2). */
const DEPARTURE_DATES = ["2028-05-15", "2029-11-15", "2031-01-15"];
/** Months to those departures at DEMO_TODAY 2026-09-15. */
const DEPARTURE_MONTHS = { "PER-01": 20, "PER-03": 38, "PER-04": 52 } as const;

/** Every key path in a JSON value, with the leaf value. */
function walk(value: unknown, path: string[] = [], out: { path: string[]; value: unknown }[] = []) {
  out.push({ path, value });
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...path, String(i)], out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, [...path, k], out);
  return out;
}

/** Asserts no departure-derived value exists anywhere in a serialized view model. */
function expectNoDepartureData(vm: unknown, role: Role) {
  const json = JSON.stringify(vm);
  for (const d of DEPARTURE_DATES) expect(json).not.toContain(d);
  expect(json.toLowerCase()).not.toContain("retire");
  expect(json).not.toMatch(/"kind"\s*:/);
  expect(json).not.toMatch(/"months"\s*:/);
  expect(json).not.toMatch(/monthsToDeparture|plannedDeparture|departureKind|departureDate/);
  // Every `departure` field is the bare hidden pill: no value, no null placeholder that says "none planned".
  const departures = walk(vm).filter((e) => e.path[e.path.length - 1] === "departure");
  expect(departures.length).toBeGreaterThan(0);
  const label = `Hidden for ${role[0]!.toUpperCase()}${role.slice(1)} role`;
  for (const d of departures) expect(d.value).toEqual({ hidden: true, label });
}

describe("people data on the seeded database", () => {
  let db: Db;
  let sqlite: Database.Database;
  let ownerList: PeopleListVM;
  let ownerRay: PersonProfileVM;

  beforeAll(() => {
    ({ db, sqlite } = seededDb());
    ownerList = listPeople(db, actorFor("owner"));
    ownerRay = personProfile(db, actorFor("owner"), RAY)!;
  });
  afterAll(() => sqlite.close());

  describe("list", () => {
    it("lists the 8 knowledge holders in sort_order (never by departure), not the owner persona", () => {
      expect(ownerList.people.map((p) => p.id)).toEqual(HOLDERS);
      for (const role of ["machinist", "trainee", "quoter"] as const) {
        expect(listPeople(db, actorFor(role)).people.map((p) => p.id)).toEqual(HOLDERS);
      }
      expect(ownerList.people.some((p) => p.fullName === "Dana Whitcomb")).toBe(false);
    });

    it("the order follows people.sort_order when it changes", () => {
      const { db: db2, sqlite: s2 } = seededDb();
      try {
        s2.prepare("UPDATE people SET sort_order = 100 WHERE id = ?").run(RAY);
        expect(listPeople(db2, actorFor("owner")).people.map((p) => p.id)).toEqual([...HOLDERS.slice(1), RAY]);
      } finally {
        s2.close();
      }
    });

    it("builds Ray's row: tenure, deep coverage 18.2, level-3 topics, cards, top risk", () => {
      const ray = ownerList.people[0]!;
      expect(ray).toMatchObject({
        id: RAY,
        fullName: "Ray Delgado",
        jobTitle: "Lead Quoter / Estimator",
        department: "quoting",
        departmentLabel: "Quoting",
        classification: "internal",
        tenureLabel: "31 yrs",
        tenureLongLabel: "31 years",
        deepCoveragePct: 18.2,
        deepTopicCount: 5,
        approvedCardCount: 10,
      });
      expect(ray.topRisk).toMatchObject({ risk: 57, band: "high", spof: true });
      expect(["t-mat-ti64", "t-thin-wall"]).toContain(ray.topRisk!.topicId);
    });

    it("short tenures are in months", () => {
      const maya = ownerList.people.find((p) => p.id === "PER-05")!;
      expect(maya.tenureLabel).toBe("8 mo");
      expect(maya.tenureLongLabel).toBe("8 months");
      expect(tenureLabels("2025-09-15", "2026-09-15")).toEqual({ short: "1 yr", long: "1 year" });
      expect(tenureLabels("2026-08-15", "2026-09-15")).toEqual({ short: "1 mo", long: "1 month" });
    });

    it("shows departures to owner and quoter, and null when none is planned", () => {
      for (const role of ["owner", "quoter"] as const) {
        const vm = listPeople(db, actorFor(role, role === "quoter" ? "PER-05" : null));
        const ray = vm.people.find((p) => p.id === RAY)!;
        expect(ray.departure).toEqual({ hidden: false, value: { date: "2028-05-15", months: 20, kind: "retirement" } });
        for (const [id, months] of Object.entries(DEPARTURE_MONTHS)) {
          const d = vm.people.find((p) => p.id === id)!.departure;
          expect(d.hidden).toBe(false);
          if (!d.hidden) expect(d.value?.months).toBe(months);
        }
        const marv = vm.people.find((p) => p.id === "PER-02")!;
        expect(marv.departure).toEqual({ hidden: false, value: null });
      }
    });

    it("drops every departure value for machinist and trainee, including 'none planned'", () => {
      for (const role of ["machinist", "trainee"] as const) {
        const vm = listPeople(db, actorFor(role, role === "machinist" ? "PER-02" : "PER-06"));
        expectNoDepartureData(vm, role);
        expect(vm.people.every((p) => p.departure.hidden)).toBe(true);
      }
    });

    it("marks the viewer's own row", () => {
      const vm = listPeople(db, actorFor("machinist", "PER-02"));
      expect(vm.people.filter((p) => p.isMe).map((p) => p.id)).toEqual(["PER-02"]);
      expect(ownerList.people.some((p) => p.isMe)).toBe(false);
    });

    it("is plain serializable data", () => {
      expect(JSON.parse(JSON.stringify(ownerList))).toEqual(ownerList);
    });
  });

  describe("profile", () => {
    it("returns null for unknown or malformed IDs and for the persona-only owner", () => {
      for (const id of ["PER-99", "P-OWNER", "", "PER-01; DROP TABLE people", "../PER-01", "x".repeat(60)]) {
        expect(personProfile(db, actorFor("owner"), id), id).toBeNull();
      }
    });

    it("returns null for someone who is not a knowledge holder", () => {
      const { db: db2, sqlite: s2 } = seededDb();
      try {
        s2.prepare("UPDATE people SET is_knowledge_holder = 0 WHERE id = ?").run("PER-08");
        expect(personProfile(db2, actorFor("owner"), "PER-08")).toBeNull();
        expect(listPeople(db2, actorFor("owner")).people.map((p) => p.id)).not.toContain("PER-08");
      } finally {
        s2.close();
      }
    });

    it("builds Ray's header facts and coverage (deep 18.2 %)", () => {
      expect(ownerRay).toMatchObject({
        id: RAY,
        fullName: "Ray Delgado",
        firstName: "Ray",
        classification: "internal",
        tenureLabel: "31 yrs",
        hireDate: "1995-06-05",
        departure: { hidden: false, value: { date: "2028-05-15", months: 20, kind: "retirement" } },
      });
      expect(ownerRay.bio).toContain("titanium");
      expect(ownerRay.coverage.deepCoveragePct).toBe(18.2);
      expect(ownerRay.coverage.deepTopicCount).toBe(5);
      expect(ownerRay.coverage.approvedCardCount).toBe(10);
      expect(ownerRay.coverage.pendingCardCount).toBe(2);
      expect(ownerRay.coverage.capturedPct).not.toBeNull();
    });

    it("marks the shop's name in the bio as fictional (hard rule 10)", () => {
      expect(ownerRay.bio).toMatch(/^31 years at Ridgeline \(fictional\)\./);
      expect(ownerRay.bio!.match(/\(fictional\)/g)).toHaveLength(1);
      expect(markShopNameFictional("Before Ridgeline, a Swiss shop.", "Ridgeline Precision")).toBe("Before Ridgeline (fictional), a Swiss shop.");
      expect(markShopNameFictional("At Ridgeline Precision since 2004.", "Ridgeline Precision")).toBe("At Ridgeline Precision (fictional) since 2004.");
      expect(markShopNameFictional("Ridgeline Precision (fictional) veteran.", "Ridgeline Precision")).toBe("Ridgeline Precision (fictional) veteran.");
      expect(markShopNameFictional("Owns the DMU 50.", "Ridgeline Precision")).toBe("Owns the DMU 50.");
      expect(markShopNameFictional("Ridgelines everywhere", "Ridgeline Precision")).toBe("Ridgelines everywhere");
    });

    it("groups topics by level 3 → 1, highest risk first, with the golden cells", () => {
      expect(ownerRay.topicGroups.map((g) => g.level)).toEqual([...ownerRay.topicGroups.map((g) => g.level)].sort((a, b) => b - a));
      const deep = ownerRay.topicGroups[0]!;
      expect(deep.level).toBe(3);
      expect(deep.topics.map((t) => t.topicId).sort()).toEqual(["t-cus-01", "t-mat-in718", "t-mat-ti64", "t-quoting", "t-thin-wall"].sort());
      expect(deep.topics.slice(0, 2).map((t) => t.topicId).sort()).toEqual(["t-mat-ti64", "t-thin-wall"]);
      const ti = deep.topics.find((t) => t.topicId === "t-mat-ti64")!;
      expect(ti).toMatchObject({ risk: 57, band: "high", spof: true, capturedPct: 15, level: 3 });
      expect(ti.libraryHref).toBe("/library?person=PER-01&topic=t-mat-ti64");
      const quoting = deep.topics.find((t) => t.topicId === "t-quoting")!;
      expect(quoting).toMatchObject({ risk: 30, band: "watch", spof: false });
      for (const g of ownerRay.topicGroups) {
        for (let i = 1; i < g.topics.length; i++) expect(g.topics[i - 1]!.risk).toBeGreaterThanOrEqual(g.topics[i]!.risk);
      }
    });

    it("lists cards by status with classification, and no card from someone else", () => {
      expect(ownerRay.cardGroups.map((g) => g.status)).toEqual(["approved", "pending_review"]);
      const approved = ownerRay.cardGroups[0]!.cards;
      expect(approved).toHaveLength(10);
      expect(approved.map((c) => c.id)).toContain("KC-001");
      expect(ownerRay.cardGroups[1]!.cards.map((c) => c.id)).toEqual(["KC-011", "KC-012"]);
      for (const c of ownerRay.cardGroups.flatMap((g) => g.cards)) {
        expect(c.classification).toMatch(/^(general|internal|customer_confidential|export_controlled)$/);
        expect(c.typeLabel.length).toBeGreaterThan(0);
      }
      const maya = personProfile(db, actorFor("owner"), "PER-05")!;
      expect(maya.cardGroups.map((g) => g.status)).toEqual(["approved", "pending_review", "draft", "rejected"]);
    });

    it("lists visible interviews newest first, never the hidden manual-entry session, and counts hand-entered cards", () => {
      expect(ownerRay.interviews.map((i) => i.id)).toEqual(["INT-02", "INT-01"]);
      expect(ownerRay.interviews[0]).toMatchObject({ date: "2026-07-08", mode: "full_interview", classification: "export_controlled" });
      expect(ownerRay.interviews[1]).toMatchObject({ date: "2026-06-10", classification: "customer_confidential" });
      expect(JSON.stringify(ownerRay)).not.toContain("INT-M-");
      expect(ownerRay.handEnteredCardCount).toBe(8);
      const devin = personProfile(db, actorFor("owner"), "PER-06")!;
      expect(devin.interviews).toEqual([]);
      expect(devin.handEnteredCardCount).toBe(5);
    });

    it("counts jobs led and quotes prepared, linking to /jobs by person, with no prices or outcomes", () => {
      expect(ownerRay.work).toEqual({ jobsLed: 0, quotesPrepared: 96, jobsHref: "/jobs?person=PER-01" });
      const marv = personProfile(db, actorFor("owner"), "PER-02")!;
      expect(marv.work).toMatchObject({ jobsLed: 48, quotesPrepared: 0, jobsHref: "/jobs?person=PER-02" });
      const json = JSON.stringify(ownerRay);
      expect(json).not.toMatch(/price|margin|outcome|won|lost|contact/i);
    });

    it("shows the departure to owner and quoter; null when none planned", () => {
      const quoterRay = personProfile(db, actorFor("quoter", "PER-05"), RAY)!;
      expect(quoterRay.departure).toEqual({ hidden: false, value: { date: "2028-05-15", months: 20, kind: "retirement" } });
      expect(personProfile(db, actorFor("owner"), "PER-02")!.departure).toEqual({ hidden: false, value: null });
    });

    it("drops every departure value for machinist and trainee, for every profile", () => {
      for (const role of ["machinist", "trainee"] as const) {
        for (const id of HOLDERS) {
          const vm = personProfile(db, actorFor(role, role === "machinist" ? "PER-02" : "PER-06"), id)!;
          expect(vm, id).not.toBeNull();
          expectNoDepartureData(vm, role);
        }
      }
    });

    it("risk and coverage are the same for every role (only the departure is gated)", () => {
      const m = personProfile(db, actorFor("machinist", "PER-02"), RAY)!;
      expect(m.topicGroups).toEqual(ownerRay.topicGroups);
      expect(m.coverage).toEqual(ownerRay.coverage);
      expect(m.cardGroups).toEqual(ownerRay.cardGroups);
    });

    it("is plain serializable data", () => {
      expect(JSON.parse(JSON.stringify(ownerRay))).toEqual(ownerRay);
    });
  });

  describe("rendered markup", () => {
    it("formats the departure line", () => {
      expect(departureText({ date: "2028-05-15", months: 20, kind: "retirement" })).toBe("Retires in 20 mo · May 15, 2028");
      expect(departureText({ date: "2027-01-15", months: 4, kind: "other" })).toBe("Leaves in 4 mo · Jan 15, 2027");
      expect(departureText({ date: "2026-09-30", months: 0, kind: "retirement" })).toBe("Retires this month · Sep 30, 2026");
    });

    it("the list shows the departure to the owner and the pill to machinist and trainee, one field per row", () => {
      const owner = renderToStaticMarkup(h(PeopleTable, { rows: ownerList.people }));
      expect(owner).toContain("Retires in 20 mo · May 15, 2028");
      for (const id of HOLDERS) expect(owner.split(`data-testid="person-row-${id}"`)).toHaveLength(2);
      expect(owner.match(/data-testid="person-departure"/g)).toHaveLength(8);
      expect(owner.match(/data-departure="none"/g)).toHaveLength(5);

      for (const role of ["machinist", "trainee"] as const) {
        const markup = renderToStaticMarkup(h(PeopleTable, { rows: listPeople(db, actorFor(role)).people }));
        const label = role === "machinist" ? "Hidden for Machinist role" : "Hidden for Trainee role";
        expect(markup.split(label)).toHaveLength(9);
        expect(markup.match(/data-departure="hidden"/g)).toHaveLength(8);
        expect(markup).not.toMatch(/Retires|2028|data-departure="none"/);
      }
    });

    it("the profile field renders the value, a dash, or the pill", () => {
      const quoter = renderToStaticMarkup(h(DepartureValue, { departure: personProfile(db, actorFor("quoter", "PER-05"), RAY)!.departure }));
      expect(quoter).toContain("Retires in 20 mo · May 15, 2028");
      const none = renderToStaticMarkup(h(DepartureValue, { departure: personProfile(db, actorFor("owner"), "PER-02")!.departure }));
      expect(none).toContain(">—</span>");
      const trainee = renderToStaticMarkup(h(DepartureValue, { departure: personProfile(db, actorFor("trainee", "PER-06"), RAY)!.departure }));
      expect(trainee).toContain("Hidden for Trainee role");
      expect(trainee).not.toContain("Retires");
    });

    it("topics and cards render with risk chips, SPOF flags, classification badges and library links", () => {
      const topicsHtml = renderToStaticMarkup(h(PersonTopicGroups, { groups: ownerRay.topicGroups }));
      expect(topicsHtml).toContain('data-testid="person-topic-t-mat-ti64" data-band="high" data-spof="true"');
      expect(topicsHtml).toContain("/library?person=PER-01&amp;topic=t-mat-ti64");
      expect(topicsHtml).toContain("Single point of failure");
      const cardsHtml = renderToStaticMarkup(h(PersonCardGroups, { groups: ownerRay.cardGroups, firstName: "Ray" }));
      expect(cardsHtml).toContain('href="/library/KC-001"');
      expect(cardsHtml.match(/data-classification=/g)?.length).toBe(12);
      // Badges inside links are non-interactive (no nested buttons).
      expect(cardsHtml).not.toContain("<button");
    });

    it("every topic row's 'Cards' link is a full tap target in both directions (PLAN.md §10: 44 px, 48 px coarse)", () => {
      // Regression: the links had min-h-tap only and measured 39 px wide.
      const topicsHtml = renderToStaticMarkup(h(PersonTopicGroups, { groups: ownerRay.topicGroups }));
      const links = topicsHtml.match(/<a [^>]*>/g) ?? [];
      expect(links.length).toBeGreaterThan(0);
      for (const tag of links) {
        const classes = (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(/\s+/);
        expect(classes, tag).toEqual(expect.arrayContaining(["min-h-tap", "min-w-tap", "justify-center"]));
      }
    });
  });
});
