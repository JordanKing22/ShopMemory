/**
 * Machine pages data layer (src/lib/data/machines.ts) against the real seeded database: PLAN.md §8.6 (quirks, setups,
 * recent issues in the last 90 demo-days, QR codes encoding `${PUBLIC_BASE_URL}/machines/<id>`, 8 labels) and
 * §7.6 (DOC-SS-05 is an approved DMU 50 setup sheet).
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import QRCode from "qrcode";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { LabelSheet, MachineLabel } from "@/components/machines/machine-label";
import { MachineQr } from "@/components/machines/machine-qr";
import { MachinesTable } from "@/components/machines/machines-table";
import type { Db } from "@/db/client";
import { ROLES } from "@/db/schema";
import { getEnv, resetEnvCache } from "@/lib/env";
import {
  fictionalShopName,
  listMachineLabels,
  listMachines,
  machineDetail,
  machineLabel,
  machinePublicUrl,
  machineQr,
  qrModulesPath,
  QR_MARGIN,
  recentWindowStart,
  shortMachineUrl,
  toParagraphs,
  type MachineDetailVM,
} from "@/lib/data/machines";
import MachineLabelPage from "@/app/(print)/machines/[id]/print/page";
import MachineLabelSheetPage from "@/app/(print)/machines/labels/page";
import MachinePage from "@/app/(app)/machines/[id]/page";
import MachinesPage from "@/app/(app)/machines/page";
import { addDays } from "@/lib/time";
import { actorFor, seededDb } from "./helpers/seeded-db";

// The pages call the server wrappers (server-only: they read cookies and the env). Point them at the seeded
// in-memory DB instead, as the owner, so the page markup can be rendered and checked here.
const pageDb = vi.hoisted(() => ({ current: null as null | { db: Db; demoToday: string } }));
vi.mock("@/server/queries/machines", async () => {
  const m = await import("@/lib/data/machines");
  const owner = { role: "owner" as const, personId: null };
  const ctx = () => {
    if (!pageDb.current) throw new Error("seeded DB not ready");
    return pageDb.current;
  };
  return {
    getMachinesList: async () => m.listMachines(ctx().db, owner, ctx().demoToday),
    getMachineDetail: async (id: string) =>
      m.machineDetail(ctx().db, owner, id, { demoToday: ctx().demoToday, publicBaseUrl: "http://localhost:3000" }),
    getMachineLabel: async (id: string) => m.machineLabel(ctx().db, owner, id, "http://localhost:3000"),
    getMachineLabels: async () => m.listMachineLabels(ctx().db, owner, "http://localhost:3000"),
  };
});

const BASE = "http://localhost:3000";
const MACHINE_IDS = ["m-vf4", "m-st20", "m-dmu50", "m-genos", "m-integrex", "m-swiss", "m-cmm", "m-wedm"];

let db: Db;
let sqlite: Database.Database;
let demoToday: string;
let dmu: MachineDetailVM;

beforeAll(() => {
  const s = seededDb();
  db = s.db;
  sqlite = s.sqlite;
  demoToday = s.bundle.demoToday;
  pageDb.current = { db, demoToday };
  const vm = machineDetail(db, actorFor("owner"), "m-dmu50", { demoToday, publicBaseUrl: BASE });
  if (!vm) throw new Error("m-dmu50 missing from the seed");
  dmu = vm;
});

afterAll(() => sqlite.close());

describe("machine list", () => {
  it("lists all 8 machines in sort order with implicit internal classification", () => {
    const vm = listMachines(db, actorFor("trainee", "PER-06"), demoToday);
    expect(vm.machines.map((m) => m.id)).toEqual(MACHINE_IDS);
    for (const m of vm.machines) {
      expect(m.classification).toBe("internal");
      expect(m.assetTag).toMatch(/^RP-[MQ]\d{2}$/);
      expect(m.kindLabel.length).toBeGreaterThan(0);
      expect(m.statusLabel.length).toBeGreaterThan(0);
    }
    expect(vm.windowStart).toBe(recentWindowStart(demoToday));
    expect(vm.windowDays).toBe(90);
  });

  it("counts match what each machine page lists", () => {
    const vm = listMachines(db, actorFor("owner"), demoToday);
    for (const row of vm.machines) {
      const detail = machineDetail(db, actorFor("owner"), row.id, { demoToday, publicBaseUrl: BASE });
      expect(detail, row.id).not.toBeNull();
      expect(row.quirkCount, row.id).toBe(detail!.quirks.length);
      expect(row.setupSheetCount, row.id).toBe(detail!.setupSheets.length);
      expect(row.recentIssueCount, row.id).toBe(detail!.recentEvents.length + detail!.failureStories.length);
      expect(row.recentIssueCount, row.id).toBe(detail!.recentIssueCount);
    }
    const dmuRow = vm.machines.find((m) => m.id === "m-dmu50")!;
    expect(dmuRow.quirkCount).toBeGreaterThanOrEqual(2);
    expect(dmuRow.setupSheetCount).toBe(3);
    // ME-008 + KC-015 + KC-019 (KC-021, captured 2025-12-12, is outside the window).
    expect(dmuRow.recentIssueCount).toBe(3);
  });

  // Regression: the list counted events only while the machine page added every linked failure story whatever its
  // date, so /machines said 1 and /machines/m-dmu50 said 4 for the same "last 90 days" (PLAN.md §8.6).
  it("recent-issue counts agree between /machines and every machine page, events and failure stories alike", () => {
    const expected: Record<string, number> = {
      "m-vf4": 3,
      "m-st20": 1,
      "m-dmu50": 3,
      "m-genos": 1,
      "m-integrex": 3,
      "m-swiss": 2,
      "m-cmm": 2,
      "m-wedm": 1,
    };
    const list = listMachines(db, actorFor("owner"), demoToday);
    const counts = Object.fromEntries(list.machines.map((r) => [r.id, r.recentIssueCount]));
    expect(counts).toEqual(expected);
    for (const row of list.machines) {
      const detail = machineDetail(db, actorFor("owner"), row.id, { demoToday, publicBaseUrl: BASE })!;
      expect(detail.windowStart, row.id).toBe(list.windowStart);
      expect(detail.recentIssueCount, row.id).toBe(row.recentIssueCount);
      expect(detail.recentIssueCount, row.id).toBe(detail.recentEvents.length + detail.failureStories.length);
    }
    // The two screens also agree on another demo date (the window follows the clock passed in).
    const march = listMachines(db, actorFor("owner"), "2026-03-01");
    for (const row of march.machines) {
      const detail = machineDetail(db, actorFor("owner"), row.id, { demoToday: "2026-03-01", publicBaseUrl: BASE })!;
      expect(detail.recentIssueCount, `2026-03-01 ${row.id}`).toBe(row.recentIssueCount);
    }
  });

  it("is the same for every role (no gated fields)", () => {
    const json = ROLES.map((r) => JSON.stringify(listMachines(db, actorFor(r), demoToday)));
    expect(new Set(json).size).toBe(1);
  });
});

describe("machine page (m-dmu50)", () => {
  it("returns null for an unknown ID", () => {
    expect(machineDetail(db, actorFor("owner"), "m-nope", { demoToday, publicBaseUrl: BASE })).toBeNull();
  });

  it("header facts come from the machines row", () => {
    expect(dmu).toMatchObject({
      id: "m-dmu50",
      assetTag: "RP-M03",
      name: "DMG MORI DMU 50",
      kind: "five_axis",
      status: "running",
      statusLabel: "Running",
      classification: "internal",
    });
    expect(dmu.unitHistory.length).toBeGreaterThan(0);
    expect(dmu.unitHistory.join(" ")).toContain("2017");
  });

  it("this unit's quirks include KC-022 and KC-023, approved first, credited by name", () => {
    const ids = dmu.quirks.map((c) => c.id);
    expect(ids).toContain("KC-022");
    expect(ids).toContain("KC-023");
    for (const c of dmu.quirks) expect(c.type).toBe("machine_quirk");
    const kc022 = dmu.quirks.find((c) => c.id === "KC-022")!;
    expect(kc022.contributorName).toBe("Marv Tollefson");
    expect(kc022.status).toBe("approved");
    expect(kc022.confidenceLabel).toBe("Always");
    expect(kc022.classification).toBe("general");
    const ranks = dmu.quirks.map((c) => ["approved", "pending_review", "draft"].indexOf(c.status));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("never lists rejected or superseded cards, on any machine", () => {
    for (const id of MACHINE_IDS) {
      const vm = machineDetail(db, actorFor("owner"), id, { demoToday, publicBaseUrl: BASE })!;
      for (const c of [...vm.quirks, ...vm.setupTips, ...vm.failureStories]) {
        expect(["approved", "pending_review", "draft"], `${id} ${c.id}`).toContain(c.status);
      }
    }
    // KC-085 (rejected) is linked to the Swiss machine but is a quoting rule; KC-072 (pending) is a VF-4 failure story.
    const vf4 = machineDetail(db, actorFor("owner"), "m-vf4", { demoToday, publicBaseUrl: BASE })!;
    const kc072 = vf4.failureStories.find((c) => c.id === "KC-072");
    expect(kc072?.statusLabel).toMatch(/^Pending review — awaiting /);
    expect(vf4.failureStories.at(-1)?.id).toBe("KC-072");
  });

  it("common setups: setup sheets include DOC-SS-05 with part, status and cited-card count; setup tips are linked cards", () => {
    const ids = dmu.setupSheets.map((d) => d.id);
    expect(ids).toContain("DOC-SS-05");
    const ss05 = dmu.setupSheets.find((d) => d.id === "DOC-SS-05")!;
    expect(ss05.status).toBe("approved");
    expect(ss05.statusLabel).toBe("Approved");
    expect(ss05.part?.id).toBe("PRT-A02");
    expect(ss05.classification).toBe("customer_confidential");
    const cited = sqlite.prepare("select count(distinct card_id) as n from document_cards where document_id = ?").get("DOC-SS-05") as { n: number };
    expect(ss05.citedCardCount).toBe(cited.n);
    expect(ss05.citedCardCount).toBeGreaterThan(0);
    // Every sheet is this machine's, and export-controlled sheets keep their label for the badge.
    const all = sqlite.prepare("select id from documents where machine_id = 'm-dmu50' and kind = 'setup_sheet' and status != 'superseded'").all() as { id: string }[];
    expect(ids.sort()).toEqual(all.map((r) => r.id).sort());
    expect(dmu.setupSheets.find((d) => d.id === "DOC-SS-07")?.classification).toBe("export_controlled");
    expect(dmu.setupTips.map((c) => c.id)).toContain("KC-002");
    for (const c of dmu.setupTips) expect(c.type).toBe("setup_tip");
  });

  it("recent issues: machine events within the last 90 demo-days only, newest first", () => {
    const start = recentWindowStart(demoToday);
    expect(start).toBe("2026-06-18");
    expect(dmu.recentEvents.map((e) => e.id)).toEqual(["ME-008"]);
    const me008 = dmu.recentEvents[0]!;
    expect(me008).toMatchObject({ kind: "alarm", kindLabel: "Alarm", occurredOn: "2026-09-01" });
    expect(me008.job).toEqual({ id: "J-G004", jobNumber: expect.stringMatching(/^RJ-\d{2}-\d{4}$/) });
    expect(me008.classification).toBe("customer_confidential");
    // Older DMU 50 events (ME-006 in 2025, ME-007 in February) fall outside the window.
    const allDmu = sqlite.prepare("select id from machine_events where machine_id = 'm-dmu50' order by id").all() as { id: string }[];
    expect(allDmu.map((r) => r.id)).toEqual(expect.arrayContaining(["ME-006", "ME-007", "ME-008"]));
    for (const id of MACHINE_IDS) {
      const vm = machineDetail(db, actorFor("owner"), id, { demoToday, publicBaseUrl: BASE })!;
      const dates = vm.recentEvents.map((e) => e.occurredOn);
      for (const d of dates) {
        expect(d >= start && d <= demoToday, `${id} ${d}`).toBe(true);
      }
      expect(dates).toEqual([...dates].sort().reverse());
      const expected = sqlite
        .prepare("select count(*) as n from machine_events where machine_id = ? and occurred_on >= ? and occurred_on <= ?")
        .get(id, start, demoToday) as { n: number };
      expect(vm.recentEvents.length, id).toBe(expected.n);
    }
  });

  it("the window follows the demo clock passed in", () => {
    const vm = machineDetail(db, actorFor("owner"), "m-dmu50", { demoToday: "2026-03-01", publicBaseUrl: BASE })!;
    expect(vm.recentEvents.map((e) => e.id)).toEqual(["ME-007"]);
  });

  it("failure stories are the failure_story cards linked to the machine and captured in the window", () => {
    const start = recentWindowStart(demoToday);
    const ids = dmu.failureStories.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["KC-015", "KC-019"]));
    expect(ids).not.toContain("KC-021"); // captured 2025-12-12, about nine months before the demo date
    for (const c of dmu.failureStories) {
      expect(c.type).toBe("failure_story");
      expect(c.createdOn >= start && c.createdOn <= demoToday, `${c.id} ${c.createdOn}`).toBe(true);
    }
    // KC-021 is still a linked card: the Library link counts every linked card, whatever its date.
    const linked = sqlite
      .prepare(
        "select count(distinct c.id) as n from card_links l join knowledge_cards c on c.id = l.card_id where l.kind = 'machine' and l.machine_id = 'm-dmu50' and c.status in ('approved','pending_review','draft')",
      )
      .get() as { n: number };
    expect(dmu.linkedCardCount).toBe(linked.n);
    const kc021 = sqlite.prepare("select created_on from knowledge_cards where id = 'KC-021'").get() as { created_on: string };
    expect(kc021.created_on < start).toBe(true);
  });

  // Regression: the window was [today − 90, today], 91 dates, while its label says "the last 90 days" and the Risk
  // KPI counts "last N days" as [today − (N − 1), today].
  it("the recent-issues window spans exactly 90 dates, today included", () => {
    const start = recentWindowStart(demoToday);
    expect(addDays(start, 90 - 1)).toBe(demoToday);
    expect(recentWindowStart("2026-03-01")).toBe("2025-12-02");
    // In a scratch copy of the seed: an event or failure story dated 89 days back counts on both screens; one dated
    // exactly 90 days back counts on neither.
    const scratch = seededDb();
    try {
      const counts = () => {
        const row = listMachines(scratch.db, actorFor("owner"), demoToday).machines.find((m) => m.id === "m-dmu50")!;
        const page = machineDetail(scratch.db, actorFor("owner"), "m-dmu50", { demoToday, publicBaseUrl: BASE })!;
        expect(page.recentIssueCount).toBe(row.recentIssueCount);
        return { n: row.recentIssueCount, events: page.recentEvents.map((e) => e.id), stories: page.failureStories.map((c) => c.id) };
      };
      const setEvent = (d: string) => scratch.sqlite.prepare("update machine_events set occurred_on = ? where id = 'ME-008'").run(d);
      const setStory = (d: string) => scratch.sqlite.prepare("update knowledge_cards set created_on = ? where id = 'KC-015'").run(d);

      setEvent(addDays(demoToday, -89));
      setStory(addDays(demoToday, -89));
      expect(counts()).toMatchObject({ n: 3, events: ["ME-008"], stories: expect.arrayContaining(["KC-015"]) });

      setEvent(addDays(demoToday, -90));
      setStory(addDays(demoToday, -90));
      const outside = counts();
      expect(outside.n).toBe(1);
      expect(outside.events).toEqual([]);
      expect(outside.stories).toEqual(["KC-019"]);
    } finally {
      scratch.sqlite.close();
    }
  });

  it("is plain serializable data and identical for every role (nothing gated)", () => {
    expect(JSON.parse(JSON.stringify(dmu))).toEqual(dmu);
    const json = ROLES.map((r) => JSON.stringify(machineDetail(db, actorFor(r), "m-dmu50", { demoToday, publicBaseUrl: BASE })));
    expect(new Set(json).size).toBe(1);
    // No pricing, contact or departure data can ride along.
    expect(json[0]).not.toMatch(/price|margin|contact|departure|annualSpend|@example\.com/i);
  });
});

describe("QR codes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("encode ${PUBLIC_BASE_URL}/machines/<id>", () => {
    expect(machinePublicUrl("http://localhost:3000", "m-dmu50")).toBe("http://localhost:3000/machines/m-dmu50");
    expect(machinePublicUrl("https://10.0.0.20:3443/", "m-cmm")).toBe("https://10.0.0.20:3443/machines/m-cmm");
    expect(machinePublicUrl("https://shop.example.com/floorwise//", "m-vf4")).toBe("https://shop.example.com/floorwise/machines/m-vf4");
    expect(shortMachineUrl("http://localhost:3000/machines/m-dmu50")).toBe("localhost:3000/machines/m-dmu50");
    expect(dmu.qr.url).toBe(`${BASE}/machines/m-dmu50`);
    expect(dmu.qr.shortUrl).toBe("localhost:3000/machines/m-dmu50");
  });

  it("use PUBLIC_BASE_URL from getEnv() (the value the server wrappers pass)", () => {
    vi.stubEnv("PUBLIC_BASE_URL", "https://192.168.1.50:3443");
    resetEnvCache();
    const vm = machineDetail(db, actorFor("machinist", "PER-02"), "m-genos", { demoToday, publicBaseUrl: getEnv().PUBLIC_BASE_URL })!;
    expect(vm.qr.url).toBe("https://192.168.1.50:3443/machines/m-genos");
    const label = machineLabel(db, actorFor("machinist", "PER-02"), "m-genos", getEnv().PUBLIC_BASE_URL)!;
    expect(label.qr.url).toBe("https://192.168.1.50:3443/machines/m-genos");

    vi.stubEnv("PUBLIC_BASE_URL", "");
    resetEnvCache();
    expect(machineQr(getEnv().PUBLIC_BASE_URL, "m-genos").url).toBe("http://localhost:3000/machines/m-genos");
  });

  it("the SVG path draws exactly the qrcode package's dark modules, inside the quiet zone", () => {
    const url = `${BASE}/machines/m-integrex`;
    const qr = machineQr(BASE, "m-integrex");
    const ref = QRCode.create(url, { errorCorrectionLevel: "M" });
    expect(qr.url).toBe(url);
    expect(qr.size).toBe(ref.modules.size + QR_MARGIN * 2);
    // Rebuild the module grid from the path and compare with the reference matrix.
    const n = ref.modules.size;
    const grid = new Uint8Array(n * n);
    for (const m of qr.path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
      const [x, y, w] = [Number(m[1]) - QR_MARGIN, Number(m[2]) - QR_MARGIN, Number(m[3])];
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(n);
      for (let i = 0; i < w; i++) grid[y * n + x + i] = 1;
    }
    expect(Array.from(grid)).toEqual(Array.from(ref.modules.data).map((v) => (v ? 1 : 0)));
    // Deterministic: the same input always gives the same markup.
    expect(machineQr(BASE, "m-integrex")).toEqual(qr);
  });

  it("qrModulesPath merges horizontal runs", () => {
    expect(qrModulesPath(3, [1, 1, 0, 0, 0, 0, 0, 1, 1], 0)).toBe("M0 0h2v1h-2zM1 2h2v1h-2z");
    expect(qrModulesPath(2, [0, 0, 0, 0])).toBe("");
  });

  it("renders as an accessible inline SVG naming the URL", () => {
    const markup = renderToStaticMarkup(h(MachineQr, { qr: dmu.qr, className: "size-40" }));
    expect(markup).toMatch(/^<svg[^>]*role="img"/);
    expect(markup).toContain(`aria-label="QR code for ${dmu.qr.url}"`);
    expect(markup).toContain(`viewBox="0 0 ${dmu.qr.size} ${dmu.qr.size}"`);
    expect(markup).toContain(dmu.qr.path);
  });
});

describe("print labels", () => {
  it("one label per machine: asset tag, name, fictional shop name, QR", () => {
    const label = machineLabel(db, actorFor("trainee", "PER-06"), "m-dmu50", BASE)!;
    expect(label).toMatchObject({ id: "m-dmu50", assetTag: "RP-M03", name: "DMG MORI DMU 50", shopLabel: "Ridgeline Precision (fictional)" });
    expect(label.qr.url).toBe(`${BASE}/machines/m-dmu50`);
    expect(machineLabel(db, actorFor("owner"), "m-nope", BASE)).toBeNull();
    expect(fictionalShopName("Ridgeline Precision (fictional)")).toBe("Ridgeline Precision (fictional)");
  });

  it("the label sheet has 8 labels, one per machine, in sort order", () => {
    const labels = listMachineLabels(db, actorFor("owner"), BASE);
    expect(labels).toHaveLength(8);
    expect(labels.map((l) => l.id)).toEqual(MACHINE_IDS);
    expect(new Set(labels.map((l) => l.qr.url)).size).toBe(8);

    const markup = renderToStaticMarkup(h(LabelSheet, { labels }));
    expect(markup.match(/data-testid="label-sheet"/g)).toHaveLength(1);
    expect(markup.match(/data-testid="machine-label"/g)).toHaveLength(8);
    for (const l of labels) {
      expect(markup).toContain(`data-machine-id="${l.id}"`);
      expect(markup).toContain(l.qr.shortUrl);
    }
  });

  it("the single label renders the 4 × 2 in box with the QR, asset tag, name, fictional shop and short URL", () => {
    const label = machineLabel(db, actorFor("owner"), "m-cmm", BASE)!;
    const markup = renderToStaticMarkup(h(MachineLabel, { label }));
    expect(markup).toMatch(/^<div[^>]*data-testid="machine-label"/);
    expect(markup).toContain("fw-label");
    expect(markup).toContain("RP-Q01");
    expect(markup).toContain("ZEISS CONTURA");
    expect(markup).toContain("Ridgeline Precision (fictional)");
    expect(markup).toContain("localhost:3000/machines/m-cmm");
    expect(markup).toContain('role="img"');
  });
});

describe("list table markup", () => {
  it("one row per machine with the row test IDs and a link to the machine page", () => {
    const vm = listMachines(db, actorFor("owner"), demoToday);
    const markup = renderToStaticMarkup(h(MachinesTable, { rows: vm.machines, windowDays: vm.windowDays }));
    for (const id of MACHINE_IDS) {
      expect(markup).toContain(`data-testid="machine-row-${id}"`);
      expect(markup).toContain(`href="/machines/${id}"`);
    }
    expect(markup).toContain('data-classification="internal"');
  });
});

describe("helpers", () => {
  it("toParagraphs splits on blank lines and collapses whitespace", () => {
    expect(toParagraphs("One\nline.\n\n  Two.  \r\n\r\nThree")).toEqual(["One line.", "Two.", "Three"]);
    expect(toParagraphs(null)).toEqual([]);
  });
});

describe("pages", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it("/machines: 8 rows linking to machine pages, and the label-sheet link", async () => {
    const markup = renderToStaticMarkup(await MachinesPage());
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    for (const id of MACHINE_IDS) expect(markup).toContain(`data-testid="machine-row-${id}"`);
    expect(markup).toContain('href="/machines/labels"');
    // Same window and the same definition as the machine page's "Recent issues" section.
    expect(markup).toContain("events logged and failure stories captured from Jun 18, 2026 to Sep 15, 2026");
  });

  it("/machines/m-dmu50: quirks, setups, recent issues, history and the QR, with badges and links", async () => {
    const markup = renderToStaticMarkup(await MachinePage(params("m-dmu50")));
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup).toContain("RP-M03");
    for (const heading of ["This unit&#x27;s quirks", "Common setups", "Recent issues", "Unit history", "QR code"]) {
      expect(markup).toContain(heading);
    }
    for (const id of ["KC-022", "KC-023", "KC-002", "KC-015"]) expect(markup).toContain(`href="/library/${id}"`);
    expect(markup).toContain('data-document-id="DOC-SS-05"');
    expect(markup).not.toMatch(/href="\/documents\//); // document pages arrive in Phase 6
    expect(markup).toContain('data-event-id="ME-008"');
    expect(markup).not.toContain('data-event-id="ME-007"');
    // Recent issues: ME-008 + KC-015 + KC-019, the same 3 the /machines row shows; KC-021 (Dec 2025) is outside.
    const issues = /<section id="issues"[\s\S]*?<\/section>/.exec(markup)?.[0] ?? "";
    expect(issues).toMatch(/<h2 id="issues-heading"[^>]*>Recent issues<span[^>]*><span class="sr-only">\(<\/span>3<span/);
    expect(issues).toContain("from Jun 18, 2026 to Sep 15, 2026 (the last 90 days)");
    expect(issues).toContain('href="/library/KC-019"');
    expect(markup).not.toContain('href="/library/KC-021"');
    expect(markup).toContain('href="/jobs/J-G004"');
    expect(markup).toContain('data-classification="export_controlled"'); // DOC-SS-07's badge
    expect(markup).toContain('href="/machines/m-dmu50/print"');
    expect(markup).toContain('href="/library?machine=m-dmu50"');
    // QR: the figure holds the inline SVG and the URL it encodes.
    const qr = /<figure[^>]*data-testid="machine-qr"[\s\S]*?<\/figure>/.exec(markup)?.[0] ?? "";
    expect(qr).toContain("<svg");
    expect(qr).toContain("http://localhost:3000/machines/m-dmu50");
    // Read-only in Phase 2: no capture bar.
    expect(markup).not.toMatch(/Voice note|Take photo/);
  });

  it("an unknown machine is notFound()", async () => {
    await expect(MachinePage(params("m-nope"))).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    await expect(MachineLabelPage(params("m-nope"))).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("/machines/m-dmu50/print: one label and a 4 × 2 in, zero-margin @page", async () => {
    const markup = renderToStaticMarkup(await MachineLabelPage(params("m-dmu50")));
    expect(markup.match(/data-testid="machine-label"/g)).toHaveLength(1);
    expect(markup).toMatch(/@page \{ size: 4in 2in; margin: 0 !important; \}/);
    expect(markup).toMatch(/\.fw-label \{[^}]*width: 4in;[^}]*height: 2in;/);
    expect(markup).toContain("Ridgeline Precision (fictional)");
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
  });

  it("/machines/labels: 8 labels on a US Letter sheet, 2 columns of 4 in", async () => {
    const markup = renderToStaticMarkup(await MachineLabelSheetPage());
    expect(markup.match(/data-testid="label-sheet"/g)).toHaveLength(1);
    expect(markup.match(/data-testid="machine-label"/g)).toHaveLength(8);
    expect(markup).toMatch(/@page \{ size: letter;/);
    expect(markup).toMatch(/grid-template-columns: 4in 4in;/);
    expect(markup).toMatch(/grid-auto-rows: 2in;/);
  });
});
