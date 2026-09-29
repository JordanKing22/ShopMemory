/**
 * Machine pages data (PLAN.md §8.6): the machine list, a machine page (this unit's quirks, common setups, recent
 * issues, unit history, QR code) and the printable QR labels.
 *
 * Pure and synchronous (better-sqlite3), no Next.js imports, so Vitest and tsx can run it (docs/DATA-LAYER.md).
 * Server wrappers live in src/server/queries/machines.ts; they pass the demo clock's "today" (getDemoToday()) and
 * PUBLIC_BASE_URL (getEnv()), so nothing here reads the clock or the environment.
 *
 * Role rules (PLAN.md §4.8): nothing on a machine page is role-gated. Machines, machine events, cards and setup
 * sheets carry no price, contact, win/loss or departure field, and linked jobs are shown by job number only, so
 * `quote_financials`, `customer_accounts` and `people.planned_departure_date` are never queried here. Every persona
 * may open export-controlled records in this demo; each record carries its own classification for the badge.
 *
 * View models are plain serializable data; dates stay `YYYY-MM-DD` and are formatted at render time.
 */
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import QRCode from "qrcode";
import type { Db } from "@/db/client";
import {
  DOC_STATUSES,
  MACHINE_EVENT_KINDS,
  MACHINE_KINDS,
  MACHINE_STATUSES,
  cardLinks,
  documentCards,
  documents,
  jobs,
  knowledgeCards,
  machineEvents,
  machines,
  parts,
  people,
  shopProfile,
  type CardStatus,
  type CardType,
  type Classification,
  type Confidence,
} from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import { CARD_STATUS_LABEL, CARD_TYPE_LABEL } from "@/lib/card-labels";
import { addDays } from "@/lib/time";

/** The actor argument every data function takes (an `Actor` from src/server/actor.ts satisfies it). */
export interface MachinesActor {
  role: Role;
  personId: string | null;
}

export type MachineKind = (typeof MACHINE_KINDS)[number];
export type MachineStatus = (typeof MACHINE_STATUSES)[number];
export type MachineEventKind = (typeof MACHINE_EVENT_KINDS)[number];
export type DocStatus = (typeof DOC_STATUSES)[number];

// ---------------------------------------------------------------------------------------------------------------
// Constants and labels (computed into view models so components never need this module at runtime)
// ---------------------------------------------------------------------------------------------------------------

/** People, personas, machines and the shop profile are implicitly internal (PLAN.md §4.3). */
export const MACHINE_CLASSIFICATION: Classification = "internal";

/** "Recent issues" = machine events and failure stories in the last 90 demo-days, today included (PLAN.md §8.6). */
export const RECENT_ISSUE_DAYS = 90;

/** QR quiet zone in modules (the QR spec's 4). */
export const QR_MARGIN = 4;

export const MACHINE_KIND_LABEL: Readonly<Record<MachineKind, string>> = {
  vmc: "Vertical machining center",
  lathe: "CNC lathe",
  five_axis: "5-axis mill",
  mill_turn: "Mill-turn",
  swiss: "Swiss-type lathe",
  cmm: "CMM",
  wire_edm: "Wire EDM",
};

export const MACHINE_STATUS_LABEL: Readonly<Record<MachineStatus, string>> = {
  running: "Running",
  down: "Down",
  pm: "Planned maintenance",
};

export const MACHINE_EVENT_KIND_LABEL: Readonly<Record<MachineEventKind, string>> = {
  issue: "Issue",
  repair: "Repair",
  pm: "Planned maintenance",
  crash: "Crash",
  alarm: "Alarm",
  upgrade: "Upgrade",
};

export const SETUP_SHEET_STATUS_LABEL: Readonly<Record<DocStatus, string>> = {
  draft: "Draft",
  expert_review: "Expert review",
  approved: "Approved",
  superseded: "Superseded",
};


export const CONFIDENCE_LABEL: Readonly<Record<Confidence, string>> = {
  always: "Always",
  usually: "Usually",
  sometimes: "Sometimes",
  not_sure: "Not sure",
  not_stated: "Not stated",
};

/**
 * Card statuses a machine page lists, approved first. Rejected and superseded cards are not shop knowledge, so they
 * never appear here (the Library still has them).
 */
export const MACHINE_CARD_STATUSES: readonly CardStatus[] = ["approved", "pending_review", "draft"];
const CARD_STATUS_RANK: Readonly<Record<string, number>> = { approved: 0, pending_review: 1, draft: 2 };

/** Setup-sheet statuses a machine page lists, approved first (a superseded sheet has a newer version). */
export const MACHINE_SHEET_STATUSES: readonly DocStatus[] = ["approved", "expert_review", "draft"];
const SHEET_STATUS_RANK: Readonly<Record<string, number>> = { approved: 0, expert_review: 1, draft: 2 };

/**
 * First day of the "recent issues" window: the last RECENT_ISSUE_DAYS demo-days, today included —
 * [today − (N − 1), today], both ends inclusive (the same convention as the Risk KPI in risk.ts).
 */
export function recentWindowStart(demoToday: string): string {
  return addDays(demoToday, -(RECENT_ISSUE_DAYS - 1));
}

/** True when a YYYY-MM-DD date falls inside the recent-issues window [windowStart, demoToday]. */
function inWindow(date: string, windowStart: string, demoToday: string): boolean {
  return date >= windowStart && date <= demoToday;
}

/** "Ridgeline Precision" → "Ridgeline Precision (fictional)" (CLAUDE.md hard rule 10); never doubled. */
export function fictionalShopName(name: string): string {
  const n = name.trim();
  return /\(fictional\)\s*$/i.test(n) ? n : `${n} (fictional)`;
}

// ---------------------------------------------------------------------------------------------------------------
// QR code (the URL printed codes encode is permanent: PLAN.md §5.1)
// ---------------------------------------------------------------------------------------------------------------

export interface MachineQrVM {
  /** What the code encodes: `${PUBLIC_BASE_URL}/machines/<id>`. */
  url: string;
  /** The URL without its scheme, printed under the code and on the label. */
  shortUrl: string;
  /** The host is this computer only (localhost / 127.x / ::1), so a phone or tablet can't open the code. */
  loopback: boolean;
  /** viewBox width/height in modules, quiet zone included. */
  size: number;
  /** SVG path (fill) of the dark modules, in module units. */
  path: string;
}

/** `${PUBLIC_BASE_URL}/machines/<id>`; trailing slashes on the base are dropped, and a path prefix is kept. */
export function machinePublicUrl(publicBaseUrl: string, machineId: string): string {
  const base = publicBaseUrl.trim().replace(/\/+$/, "");
  return `${base}/machines/${encodeURIComponent(machineId)}`;
}

/** "http://localhost:3000/machines/m-dmu50" → "localhost:3000/machines/m-dmu50". */
export function shortMachineUrl(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/+$/, "");
}

/** True when the URL's host only reaches this computer (localhost, *.localhost, 127.0.0.0/8, ::1). */
export function isLoopbackUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === "localhost" || host.endsWith(".localhost") || /^127(\.\d{1,3}){3}$/.test(host) || host === "[::1]";
}

/**
 * One fill path for the dark modules: each horizontal run becomes a 1-module-tall rectangle. Deterministic, so
 * server and client markup always match.
 */
export function qrModulesPath(size: number, data: ArrayLike<number>, margin = QR_MARGIN): string {
  let d = "";
  for (let row = 0; row < size; row++) {
    let col = 0;
    while (col < size) {
      if (!data[row * size + col]) {
        col++;
        continue;
      }
      const start = col;
      while (col < size && data[row * size + col]) col++;
      const w = col - start;
      d += `M${start + margin} ${row + margin}h${w}v1h-${w}z`;
    }
  }
  return d;
}

/** The QR code for a machine page, built server-side with the qrcode package (error correction M). */
export function machineQr(publicBaseUrl: string, machineId: string): MachineQrVM {
  const url = machinePublicUrl(publicBaseUrl, machineId);
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const { size, data } = qr.modules;
  return {
    url,
    shortUrl: shortMachineUrl(url),
    loopback: isLoopbackUrl(url),
    size: size + QR_MARGIN * 2,
    path: qrModulesPath(size, data),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// List (/machines)
// ---------------------------------------------------------------------------------------------------------------

export interface MachineRowVM {
  id: string;
  assetTag: string;
  name: string;
  make: string;
  model: string;
  kind: MachineKind;
  kindLabel: string;
  status: MachineStatus;
  statusLabel: string;
  locationCell: string | null;
  classification: Classification;
  /** machine_quirk cards linked to this machine (approved, pending review or draft). */
  quirkCount: number;
  /** Setup sheets for this machine (approved, expert review or draft). */
  setupSheetCount: number;
  /** Machine events and failure stories in the last {@link RECENT_ISSUE_DAYS} demo-days (the machine page's count). */
  recentIssueCount: number;
}

export interface MachinesListVM {
  machines: MachineRowVM[];
  demoToday: string;
  /** First day (inclusive) of the recent-issues window. */
  windowStart: string;
  windowDays: number;
}

function countBy(rows: { key: string | null; n: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) if (r.key) m.set(r.key, Number(r.n));
  return m;
}

/** Every machine in the shop's usual order (machines.sort_order), with the counts the machine page shows. */
export function listMachines(db: Db, _actor: MachinesActor, demoToday: string): MachinesListVM {
  const windowStart = recentWindowStart(demoToday);
  const rows = db
    .select({
      id: machines.id,
      assetTag: machines.assetTag,
      name: machines.name,
      make: machines.make,
      model: machines.model,
      kind: machines.kind,
      status: machines.status,
      locationCell: machines.locationCell,
    })
    .from(machines)
    .orderBy(asc(machines.sortOrder), asc(machines.id))
    .all();

  const quirks = countBy(
    db
      .select({ key: cardLinks.machineId, n: sql<number>`count(distinct ${knowledgeCards.id})` })
      .from(cardLinks)
      .innerJoin(knowledgeCards, eq(knowledgeCards.id, cardLinks.cardId))
      .where(
        and(
          eq(cardLinks.kind, "machine"),
          eq(knowledgeCards.type, "machine_quirk"),
          inArray(knowledgeCards.status, [...MACHINE_CARD_STATUSES]),
        ),
      )
      .groupBy(cardLinks.machineId)
      .all(),
  );
  const sheets = countBy(
    db
      .select({ key: documents.machineId, n: sql<number>`count(*)` })
      .from(documents)
      .where(and(eq(documents.kind, "setup_sheet"), inArray(documents.status, [...MACHINE_SHEET_STATUSES])))
      .groupBy(documents.machineId)
      .all(),
  );
  const events = countBy(
    db
      .select({ key: machineEvents.machineId, n: sql<number>`count(*)` })
      .from(machineEvents)
      .where(and(gte(machineEvents.occurredOn, windowStart), lte(machineEvents.occurredOn, demoToday)))
      .groupBy(machineEvents.machineId)
      .all(),
  );
  // Failure stories captured in the same window, with the statuses the machine page lists (see machineDetail()).
  const stories = countBy(
    db
      .select({ key: cardLinks.machineId, n: sql<number>`count(distinct ${knowledgeCards.id})` })
      .from(cardLinks)
      .innerJoin(knowledgeCards, eq(knowledgeCards.id, cardLinks.cardId))
      .where(
        and(
          eq(cardLinks.kind, "machine"),
          eq(knowledgeCards.type, "failure_story"),
          inArray(knowledgeCards.status, [...MACHINE_CARD_STATUSES]),
          gte(knowledgeCards.createdOn, windowStart),
          lte(knowledgeCards.createdOn, demoToday),
        ),
      )
      .groupBy(cardLinks.machineId)
      .all(),
  );

  return {
    machines: rows.map((r) => ({
      id: r.id,
      assetTag: r.assetTag,
      name: r.name,
      make: r.make,
      model: r.model,
      kind: r.kind,
      kindLabel: MACHINE_KIND_LABEL[r.kind],
      status: r.status,
      statusLabel: MACHINE_STATUS_LABEL[r.status],
      locationCell: r.locationCell,
      classification: MACHINE_CLASSIFICATION,
      quirkCount: quirks.get(r.id) ?? 0,
      setupSheetCount: sheets.get(r.id) ?? 0,
      recentIssueCount: (events.get(r.id) ?? 0) + (stories.get(r.id) ?? 0),
    })),
    demoToday,
    windowStart,
    windowDays: RECENT_ISSUE_DAYS,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Machine page (/machines/[id])
// ---------------------------------------------------------------------------------------------------------------

export interface MachineCardVM {
  id: string;
  type: CardType;
  typeLabel: string;
  status: CardStatus;
  /** "Approved", or "Pending review — awaiting Marv Tollefson" for a card its contributor hasn't approved yet. */
  statusLabel: string;
  title: string;
  statement: string;
  /** Credited by name (PLAN.md §5.2 `source_person_id`). */
  contributorId: string;
  contributorName: string;
  confidence: Confidence;
  confidenceLabel: string;
  /** When the card was captured (demo clock), YYYY-MM-DD. */
  createdOn: string;
  classification: Classification;
}

export interface SetupSheetVM {
  id: string;
  title: string;
  status: DocStatus;
  statusLabel: string;
  version: number;
  part: { id: string; partNumber: string; revision: string | null; description: string } | null;
  /** Distinct knowledge cards the sheet cites. */
  citedCardCount: number;
  classification: Classification;
}

export interface MachineEventVM {
  id: string;
  occurredOn: string;
  kind: MachineEventKind;
  kindLabel: string;
  summary: string;
  job: { id: string; jobNumber: string } | null;
  personName: string | null;
  classification: Classification;
}

export interface MachineDetailVM {
  id: string;
  assetTag: string;
  name: string;
  make: string;
  model: string;
  kind: MachineKind;
  kindLabel: string;
  status: MachineStatus;
  statusLabel: string;
  locationCell: string | null;
  yearInstalled: number;
  acquired: "new" | "used";
  capabilities: string[];
  classification: Classification;
  /** unit_history_md split into plain-text paragraphs (this unit's history only). */
  unitHistory: string[];
  /** machine_quirk cards linked to this machine, approved first. */
  quirks: MachineCardVM[];
  /** setup_tip cards linked to this machine, approved first. */
  setupTips: MachineCardVM[];
  /** failure_story cards linked to this machine and captured in the recent-issues window, approved first. */
  failureStories: MachineCardVM[];
  /** Setup sheets for this machine, approved first. */
  setupSheets: SetupSheetVM[];
  /** Machine events in the recent-issues window, newest first. */
  recentEvents: MachineEventVM[];
  /** recentEvents + failureStories: the "Recent issues" count, equal to the /machines row's recentIssueCount. */
  recentIssueCount: number;
  /** Cards of every type linked to this machine (the listed statuses), for the Library link. */
  linkedCardCount: number;
  demoToday: string;
  windowStart: string;
  windowDays: number;
  qr: MachineQrVM;
}

function cardStatusLabel(status: CardStatus, contributorName: string): string {
  const word = CARD_STATUS_LABEL[status];
  return status === "draft" || status === "pending_review" ? `${word} — awaiting ${contributorName}` : word;
}

/** Plain-text paragraphs from a Markdown-ish block: split on blank lines, whitespace collapsed, empties dropped. */
export function toParagraphs(md: string | null): string[] {
  if (!md) return [];
  return md
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);
}

function linkedCards(db: Db, machineId: string): MachineCardVM[] {
  const rows = db
    .selectDistinct({
      id: knowledgeCards.id,
      type: knowledgeCards.type,
      status: knowledgeCards.status,
      title: knowledgeCards.title,
      statement: knowledgeCards.statement,
      confidence: knowledgeCards.expertConfidence,
      createdOn: knowledgeCards.createdOn,
      classification: knowledgeCards.classification,
      contributorId: people.id,
      contributorName: people.fullName,
    })
    .from(cardLinks)
    .innerJoin(knowledgeCards, eq(knowledgeCards.id, cardLinks.cardId))
    .innerJoin(people, eq(people.id, knowledgeCards.sourcePersonId))
    .where(
      and(
        eq(cardLinks.kind, "machine"),
        eq(cardLinks.machineId, machineId),
        inArray(knowledgeCards.status, [...MACHINE_CARD_STATUSES]),
      ),
    )
    .all();

  return rows
    .map((r) => ({
      id: r.id,
      type: r.type,
      typeLabel: CARD_TYPE_LABEL[r.type],
      status: r.status,
      statusLabel: cardStatusLabel(r.status, r.contributorName),
      title: r.title,
      statement: r.statement,
      contributorId: r.contributorId,
      contributorName: r.contributorName,
      confidence: r.confidence,
      confidenceLabel: CONFIDENCE_LABEL[r.confidence],
      createdOn: r.createdOn,
      classification: r.classification,
    }))
    .sort((a, b) => (CARD_STATUS_RANK[a.status] ?? 9) - (CARD_STATUS_RANK[b.status] ?? 9) || cmp(a.id, b.id));
}

/** Code-unit comparison (never locale rules), so the order is identical everywhere. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function setupSheets(db: Db, machineId: string): SetupSheetVM[] {
  const rows = db
    .select({
      id: documents.id,
      title: documents.title,
      status: documents.status,
      version: documents.version,
      classification: documents.classification,
      partId: parts.id,
      partNumber: parts.partNumber,
      revision: parts.revision,
      description: parts.description,
      cited: sql<number>`(select count(distinct ${documentCards.cardId}) from ${documentCards} where ${documentCards.documentId} = ${documents.id})`,
    })
    .from(documents)
    .leftJoin(parts, eq(parts.id, documents.partId))
    .where(
      and(
        eq(documents.machineId, machineId),
        eq(documents.kind, "setup_sheet"),
        inArray(documents.status, [...MACHINE_SHEET_STATUSES]),
      ),
    )
    .all();

  return rows
    .map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      statusLabel: SETUP_SHEET_STATUS_LABEL[r.status],
      version: r.version,
      part:
        r.partId && r.partNumber && r.description
          ? { id: r.partId, partNumber: r.partNumber, revision: r.revision ?? null, description: r.description }
          : null,
      citedCardCount: Number(r.cited),
      classification: r.classification,
    }))
    .sort((a, b) => (SHEET_STATUS_RANK[a.status] ?? 9) - (SHEET_STATUS_RANK[b.status] ?? 9) || cmp(a.id, b.id));
}

function recentEvents(db: Db, machineId: string, windowStart: string, demoToday: string): MachineEventVM[] {
  const rows = db
    .select({
      id: machineEvents.id,
      occurredOn: machineEvents.occurredOn,
      kind: machineEvents.kind,
      summary: machineEvents.summary,
      classification: machineEvents.classification,
      jobId: jobs.id,
      jobNumber: jobs.jobNumber,
      personName: people.fullName,
    })
    .from(machineEvents)
    .leftJoin(jobs, eq(jobs.id, machineEvents.jobId))
    .leftJoin(people, eq(people.id, machineEvents.personId))
    .where(
      and(
        eq(machineEvents.machineId, machineId),
        gte(machineEvents.occurredOn, windowStart),
        lte(machineEvents.occurredOn, demoToday),
      ),
    )
    .all();

  return rows
    .map((r) => ({
      id: r.id,
      occurredOn: r.occurredOn,
      kind: r.kind,
      kindLabel: MACHINE_EVENT_KIND_LABEL[r.kind],
      summary: r.summary,
      job: r.jobId && r.jobNumber ? { id: r.jobId, jobNumber: r.jobNumber } : null,
      personName: r.personName ?? null,
      classification: r.classification,
    }))
    .sort((a, b) => cmp(b.occurredOn, a.occurredOn) || cmp(b.id, a.id));
}

export interface MachineDetailOptions {
  /** The demo clock's today (shop_profile.demo_today), YYYY-MM-DD. */
  demoToday: string;
  /** PUBLIC_BASE_URL: what the machine's QR code encodes. */
  publicBaseUrl: string;
}

/** The machine page view model, or null for an unknown ID (the page calls notFound()). */
export function machineDetail(db: Db, _actor: MachinesActor, id: string, opts: MachineDetailOptions): MachineDetailVM | null {
  const m = db.select().from(machines).where(eq(machines.id, id)).get();
  if (!m) return null;

  const windowStart = recentWindowStart(opts.demoToday);
  const cards = linkedCards(db, m.id);
  // Recent issues = events and failure stories inside the window (PLAN.md §8.6); older stories stay reachable via
  // the Library link, which counts every linked card (linkedCardCount).
  const failureStories = cards.filter((c) => c.type === "failure_story" && inWindow(c.createdOn, windowStart, opts.demoToday));
  const events = recentEvents(db, m.id, windowStart, opts.demoToday);

  return {
    id: m.id,
    assetTag: m.assetTag,
    name: m.name,
    make: m.make,
    model: m.model,
    kind: m.kind,
    kindLabel: MACHINE_KIND_LABEL[m.kind],
    status: m.status,
    statusLabel: MACHINE_STATUS_LABEL[m.status],
    locationCell: m.locationCell,
    yearInstalled: m.yearInstalled,
    acquired: m.acquired,
    capabilities: [...m.capabilities],
    classification: MACHINE_CLASSIFICATION,
    unitHistory: toParagraphs(m.unitHistoryMd),
    quirks: cards.filter((c) => c.type === "machine_quirk"),
    setupTips: cards.filter((c) => c.type === "setup_tip"),
    failureStories,
    setupSheets: setupSheets(db, m.id),
    recentEvents: events,
    recentIssueCount: events.length + failureStories.length,
    linkedCardCount: cards.length,
    demoToday: opts.demoToday,
    windowStart,
    windowDays: RECENT_ISSUE_DAYS,
    qr: machineQr(opts.publicBaseUrl, m.id),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Print labels (/machines/[id]/print and /machines/labels)
// ---------------------------------------------------------------------------------------------------------------

export interface MachineLabelVM {
  id: string;
  assetTag: string;
  name: string;
  /** "Ridgeline Precision (fictional)". */
  shopLabel: string;
  classification: Classification;
  qr: MachineQrVM;
}

function shopLabel(db: Db): string {
  const row = db.select({ name: shopProfile.name }).from(shopProfile).get();
  return fictionalShopName(row?.name ?? "Ridgeline Precision");
}

/** One machine's 4 × 2 in label, or null for an unknown ID. */
export function machineLabel(db: Db, _actor: MachinesActor, id: string, publicBaseUrl: string): MachineLabelVM | null {
  const m = db
    .select({ id: machines.id, assetTag: machines.assetTag, name: machines.name })
    .from(machines)
    .where(eq(machines.id, id))
    .get();
  if (!m) return null;
  return { ...m, shopLabel: shopLabel(db), classification: MACHINE_CLASSIFICATION, qr: machineQr(publicBaseUrl, m.id) };
}

/** Every machine's label, in the shop's usual order (the 8-up label sheet). */
export function listMachineLabels(db: Db, _actor: MachinesActor, publicBaseUrl: string): MachineLabelVM[] {
  const shop = shopLabel(db);
  return db
    .select({ id: machines.id, assetTag: machines.assetTag, name: machines.name })
    .from(machines)
    .orderBy(asc(machines.sortOrder), asc(machines.id))
    .all()
    .map((m) => ({ ...m, shopLabel: shop, classification: MACHINE_CLASSIFICATION, qr: machineQr(publicBaseUrl, m.id) }));
}
