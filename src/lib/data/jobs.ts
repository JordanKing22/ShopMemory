/**
 * Jobs and quotes data (PLAN.md §9 `/jobs`, `/jobs/[id]`): every quote with its job (plus the internal work orders),
 * quoted vs actual hours, variance, win/loss, the quote reasoning log, linked cards, machine events and related quotes.
 *
 * Pure and synchronous (better-sqlite3), no Next.js imports, so Vitest and tsx can run it (docs/DATA-LAYER.md).
 * Server wrappers live in src/server/queries/jobs.ts.
 *
 * Role gates (PLAN.md §4.8, DATA-LAYER.md rules 2–4):
 * - prices: `quote_financials` is queried ONLY when canSee(role, "prices"). For machinist and trainee the whole
 *   `financials` slot is ONE Hidden placeholder built without the values, so neither an amount nor a pricing field name
 *   exists in the view model or the RSC payload (PLAN.md §4.8). The list never carries prices for anyone.
 * - winLoss: `quotes.outcome` and `quotes.lost_reason` leave this module only through gated(). The visible row status
 *   is derived from whether a job exists (job status, or "No job"), so pending, lost and no-bid quotes look the same
 *   to roles that can't see outcomes. The outcome filter is ignored for those roles (a filter would leak it).
 *   Quoter notes can state the outcome in prose ("they went with a lower bid"), so they follow the win/loss gate too.
 * - contacts: `customer_accounts` is never queried here. Customer names and documented quality requirements are
 *   visible to every role.
 *
 * Every record in a view model carries its own `classification` column (never recomputed); the page-level label is
 * the higher of the job's and the quote's own labels. View models are plain serializable data; dates stay
 * `YYYY-MM-DD` (reasoning-log `createdAt` is an ISO timestamp) and are formatted at render time.
 */
import { and, asc, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "@/db/client";
import {
  CLASSIFICATIONS,
  cardLinks,
  customers,
  jobs,
  knowledgeCards,
  machineEvents,
  machines,
  materials,
  maxClass,
  parts,
  people,
  quoteFinancials,
  quoteReasoningLogs,
  quotes,
  type CardStatus,
  type CardType,
  type Classification,
  type EXPORT_CONTROL,
  type INDUSTRIES,
  type JOB_STATUSES,
  type JudgmentDriver,
  type LOST_REASONS,
  type MACHINE_EVENT_KINDS,
  type PartFamily,
  type PartFeature,
  type QUOTE_OUTCOMES,
  type RISK_BUCKETS,
} from "@/db/schema";
import { canSee, hiddenLabel, type Role } from "@/lib/auth/roles";
import { CLASSIFICATION_LABEL } from "@/lib/classification-labels";
import { CARD_STATUS_LABEL, CARD_TYPE_LABEL } from "@/lib/data/cards";
import { gated, type Gated, type Hidden } from "@/lib/data/gate";

/** The actor argument every data function takes (an `Actor` from src/server/actor.ts satisfies it). */
export interface JobsActor {
  role: Role;
  personId: string | null;
}

export type QuoteOutcome = (typeof QUOTE_OUTCOMES)[number];
export type LostReason = (typeof LOST_REASONS)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type ExportControl = (typeof EXPORT_CONTROL)[number];
export type Industry = (typeof INDUSTRIES)[number];
export type MachineEventKind = (typeof MACHINE_EVENT_KINDS)[number];
export type RiskBucket = (typeof RISK_BUCKETS)[number];
/** The status every role sees: the job's status, or "no_job" for a quote without a job (never the outcome). */
export type RecordStatus = JobStatus | "no_job";

// ---------------------------------------------------------------------------------------------------------------
// Labels (computed into view models so Client Components never import this module at runtime)
// ---------------------------------------------------------------------------------------------------------------

export const RECORD_STATUS_LABEL: Readonly<Record<RecordStatus, string>> = {
  scheduled: "Scheduled",
  in_process: "In process",
  complete: "Complete",
  no_job: "No job",
};

export const OUTCOME_LABEL: Readonly<Record<QuoteOutcome, string>> = {
  won: "Won",
  lost: "Lost",
  no_bid: "No bid",
  pending: "Pending",
};

export const LOST_REASON_LABEL: Readonly<Record<LostReason, string>> = {
  price: "Price",
  lead_time: "Lead time",
  capability: "Capability",
  unknown: "Reason not recorded",
};

export const DRIVER_LABEL: Readonly<Record<JudgmentDriver, string>> = {
  thin_wall: "Thin wall",
  titanium: "Titanium",
  inconel: "Inconel",
  five_axis: "5-axis",
  tight_tolerance: "Tight tolerance",
  new_customer: "New customer",
  first_article: "First article",
};

export const FEATURE_LABEL: Readonly<Record<PartFeature, string>> = {
  thin_wall: "Thin wall",
  five_axis: "5-axis",
  tight_tolerance: "Tight tolerance",
  deep_pocket: "Deep pocket",
  thread_milling: "Thread milling",
  edm_detail: "EDM detail",
  first_article: "First article",
  heat_treat: "Heat treat",
  passivation: "Passivation",
  anodize: "Anodize",
  cleanroom: "Cleanroom",
  long_slender: "Long and slender",
};

export const FAMILY_LABEL: Readonly<Record<PartFamily, string>> = {
  bracket: "Bracket",
  housing: "Housing",
  manifold: "Manifold",
  fitting: "Fitting",
  shaft: "Shaft",
  sleeve: "Sleeve",
  ring: "Ring",
  plate: "Plate",
  insulator: "Insulator",
  instrument: "Instrument",
  fixture: "Fixture",
};

/** The part's export-control field is a demo label, not a determination (PLAN.md §5.2). */
export const EXPORT_CONTROL_LABEL: Readonly<Record<ExportControl, string>> = {
  none: "None",
  ear99: "EAR99",
  ear_controlled: "EAR-controlled",
  itar: "ITAR",
};

export const INDUSTRY_LABEL: Readonly<Record<Industry, string>> = {
  aerospace: "Aerospace",
  medical: "Medical",
  semiconductor: "Semiconductor",
  defense: "Defense",
};

export const MACHINE_EVENT_KIND_LABEL: Readonly<Record<MachineEventKind, string>> = {
  issue: "Issue",
  repair: "Repair",
  pm: "Preventive maintenance",
  crash: "Crash",
  alarm: "Alarm",
  upgrade: "Upgrade",
};

export const RISK_BUCKET_LABEL: Readonly<Record<RiskBucket, string>> = {
  hours: "Hours",
  setup: "Setup",
  scrap_allowance: "Scrap allowance",
  inspection: "Inspection",
  outside_processing: "Outside processing",
  other: "Other",
};

// ---------------------------------------------------------------------------------------------------------------
// Shared view-model pieces
// ---------------------------------------------------------------------------------------------------------------

export interface PersonRefVM {
  id: string;
  name: string;
}

export interface MachineRefVM {
  id: string;
  name: string;
  assetTag: string;
}

export interface ChipVM {
  key: string;
  label: string;
}

/** A quote's outcome (won / lost / no bid / pending) and, for lost quotes, the reason. Gated by `winLoss`. */
export interface OutcomeVM {
  outcome: QuoteOutcome;
  outcomeLabel: string;
  lostReason: LostReason | null;
  lostReasonLabel: string | null;
}

function outcomeVm(outcome: QuoteOutcome, lostReason: LostReason | null): OutcomeVM {
  const reason = outcome === "lost" ? lostReason : null;
  return {
    outcome,
    outcomeLabel: OUTCOME_LABEL[outcome],
    lostReason: reason,
    lostReasonLabel: reason ? LOST_REASON_LABEL[reason] : null,
  };
}

/** A freshly built Hidden placeholder: it never sees the value (used where the value must not even be queried). */
function hidden(role: Role): Hidden {
  return { hidden: true, label: hiddenLabel(role) };
}

function jobHref(id: string): string {
  return `/jobs/${encodeURIComponent(id)}`;
}

function recordStatus(jobStatus: JobStatus | null): RecordStatus {
  return jobStatus ?? "no_job";
}

// ---------------------------------------------------------------------------------------------------------------
// Filters (URL searchParams: none of them is free text)
// ---------------------------------------------------------------------------------------------------------------

export const JOB_FILTER_KEYS = ["customer", "person", "machine", "status", "classification", "outcome"] as const;
export type JobFilterKey = (typeof JOB_FILTER_KEYS)[number];

/** `?customer=internal` selects the internal work orders (no customer). */
export const INTERNAL_CUSTOMER = "internal";

export const RECORD_STATUSES: readonly RecordStatus[] = ["scheduled", "in_process", "complete", "no_job"];
const OUTCOME_ORDER: readonly QuoteOutcome[] = ["won", "lost", "no_bid", "pending"];

export interface JobFilters {
  customer?: string;
  person?: string;
  machine?: string;
  status?: RecordStatus;
  classification?: Classification;
  outcome?: QuoteOutcome;
}

export interface JobFilterOptionVM {
  value: string;
  label: string;
}

export interface JobFilterGroupVM {
  key: JobFilterKey;
  label: string;
  options: JobFilterOptionVM[];
  selected: string | null;
}

export interface JobActiveFilterVM {
  key: JobFilterKey;
  label: string;
  valueLabel: string;
  /** /jobs with this filter removed and the others kept. */
  removeHref: string;
}

const FILTER_LABEL: Readonly<Record<JobFilterKey, string>> = {
  customer: "Customer",
  person: "Person",
  machine: "Machine",
  status: "Status",
  classification: "Classification",
  outcome: "Outcome",
};

function firstString(v: unknown): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.length > 0 && s.length <= 64 ? s : undefined;
}

/** `/jobs?…` for a filter set, keys in a fixed order (stable links). */
export function jobsHref(f: JobFilters): string {
  const params = new URLSearchParams();
  for (const key of JOB_FILTER_KEYS) {
    const v = f[key];
    if (v) params.set(key, v);
  }
  const qs = params.toString();
  return qs ? `/jobs?${qs}` : "/jobs";
}

interface FilterOptionSets {
  customer: JobFilterOptionVM[];
  person: JobFilterOptionVM[];
  machine: JobFilterOptionVM[];
  status: JobFilterOptionVM[];
  classification: JobFilterOptionVM[];
  outcome: JobFilterOptionVM[];
}

function filterOptionSets(db: Db): FilterOptionSets {
  const customerRows = db.select({ id: customers.id, name: customers.name }).from(customers).orderBy(asc(customers.sortOrder), asc(customers.id)).all();
  const personRows = db.select({ id: people.id, name: people.fullName }).from(people).orderBy(asc(people.sortOrder), asc(people.id)).all();
  const machineRows = db.select({ id: machines.id, name: machines.name }).from(machines).orderBy(asc(machines.sortOrder), asc(machines.id)).all();
  return {
    customer: [
      ...customerRows.map((c) => ({ value: c.id, label: c.name })),
      { value: INTERNAL_CUSTOMER, label: "Internal work orders (no customer)" },
    ],
    person: personRows.map((p) => ({ value: p.id, label: p.name })),
    machine: machineRows.map((m) => ({ value: m.id, label: m.name })),
    status: RECORD_STATUSES.map((s) => ({ value: s, label: RECORD_STATUS_LABEL[s] })),
    classification: CLASSIFICATIONS.map((c) => ({ value: c, label: CLASSIFICATION_LABEL[c] })),
    outcome: OUTCOME_ORDER.map((o) => ({ value: o, label: OUTCOME_LABEL[o] })),
  };
}

/**
 * Keeps only known values (so a hand-typed URL can't produce an odd filter chip) and drops the outcome filter for
 * roles that can't see win/loss (DATA-LAYER.md rule 4: never filter by a hidden field).
 */
function resolveFilters(raw: Readonly<Record<string, unknown>>, role: Role, sets: FilterOptionSets): JobFilters {
  const out: JobFilters = {};
  for (const key of JOB_FILTER_KEYS) {
    if (key === "outcome" && !canSee(role, "winLoss")) continue;
    const v = firstString(raw[key]);
    if (v && sets[key].some((o) => o.value === v)) (out as Record<string, string>)[key] = v;
  }
  return out;
}

/** Parses `/jobs` searchParams for a role (unknown values and, for roles without win/loss, the outcome are dropped). */
export function parseJobFilters(db: Db, actor: JobsActor, raw: Readonly<Record<string, unknown>>): JobFilters {
  return resolveFilters(raw, actor.role, filterOptionSets(db));
}

// ---------------------------------------------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------------------------------------------

export interface JobRowVM {
  /** The job ID when the quote has a job (J-A03), otherwise the quote ID (Q-A01). Test ID: job-row-{id}. */
  id: string;
  href: string;
  /** "quote": a customer quote (with or without a job) · "internal": an internal work order (no quote). */
  kind: "quote" | "internal";
  quoteId: string | null;
  quoteNumber: string | null;
  jobId: string | null;
  jobNumber: string | null;
  /** The list's sort date: quoted_on for quotes, started_on for internal work orders. */
  date: string | null;
  dateKind: "quoted" | "started";
  partNumber: string;
  partRevision: string;
  partDescription: string;
  /** null for internal work orders. */
  customerName: string | null;
  quotedBy: PersonRefVM | null;
  quotedHours: number | null;
  actualHours: number | null;
  /** Signed percent: (actual − quoted) / quoted × 100. null until actuals exist. */
  variancePct: number | null;
  status: RecordStatus;
  statusLabel: string;
  /** Gated by winLoss; null for internal work orders (there is no quote). */
  outcome: Gated<OutcomeVM> | null;
  /** The higher of the quote's and the job's own labels (they agree in the seed). */
  classification: Classification;
}

export interface JobsPageVM {
  rows: JobRowVM[];
  /** All records before filtering (quotes + internal work orders). */
  totalCount: number;
  filterGroups: JobFilterGroupVM[];
  activeFilters: JobActiveFilterVM[];
  /** canSee(role, "winLoss"): the outcome column shows values. */
  showOutcome: boolean;
  /** "Hidden for Machinist role" when the outcome is hidden, else null. */
  outcomeHiddenLabel: string | null;
}

interface RawRow {
  vm: Omit<JobRowVM, "outcome">;
  outcome: QuoteOutcome | null;
  lostReason: LostReason | null;
  customerId: string | null;
  personIds: string[];
  machineIds: string[];
}

function loadRows(db: Db): RawRow[] {
  const quoter = alias(people, "quoter");
  const quoteRows = db
    .select({
      quoteId: quotes.id,
      quoteNumber: quotes.quoteNumber,
      quotedOn: quotes.quotedOn,
      quotedById: quotes.quotedByPersonId,
      quotedByName: quoter.fullName,
      quotedHours: quotes.quotedHours,
      outcome: quotes.outcome,
      lostReason: quotes.lostReason,
      primaryMachineId: quotes.primaryMachineId,
      secondaryMachineId: quotes.secondaryMachineId,
      quoteClass: quotes.classification,
      customerId: quotes.customerId,
      customerName: customers.name,
      partNumber: parts.partNumber,
      partRevision: parts.revision,
      partDescription: parts.description,
      jobId: jobs.id,
      jobNumber: jobs.jobNumber,
      jobStatus: jobs.status,
      leadPersonId: jobs.leadPersonId,
      actualMachineId: jobs.actualMachineId,
      actualHours: jobs.actualHours,
      variancePct: jobs.variancePct,
      jobClass: jobs.classification,
    })
    .from(quotes)
    .innerJoin(parts, eq(parts.id, quotes.partId))
    .innerJoin(customers, eq(customers.id, quotes.customerId))
    .innerJoin(quoter, eq(quoter.id, quotes.quotedByPersonId))
    .leftJoin(jobs, eq(jobs.quoteId, quotes.id))
    .all();

  const internalRows = db
    .select({
      jobId: jobs.id,
      jobNumber: jobs.jobNumber,
      jobStatus: jobs.status,
      startedOn: jobs.startedOn,
      leadPersonId: jobs.leadPersonId,
      actualMachineId: jobs.actualMachineId,
      actualHours: jobs.actualHours,
      jobClass: jobs.classification,
      partNumber: parts.partNumber,
      partRevision: parts.revision,
      partDescription: parts.description,
    })
    .from(jobs)
    .innerJoin(parts, eq(parts.id, jobs.partId))
    .where(isNull(jobs.quoteId))
    .all();

  const rows: RawRow[] = [];
  for (const r of quoteRows) {
    const status = recordStatus(r.jobStatus);
    rows.push({
      vm: {
        id: r.jobId ?? r.quoteId,
        href: jobHref(r.jobId ?? r.quoteId),
        kind: "quote",
        quoteId: r.quoteId,
        quoteNumber: r.quoteNumber,
        jobId: r.jobId,
        jobNumber: r.jobNumber,
        date: r.quotedOn,
        dateKind: "quoted",
        partNumber: r.partNumber,
        partRevision: r.partRevision,
        partDescription: r.partDescription,
        customerName: r.customerName,
        quotedBy: { id: r.quotedById, name: r.quotedByName },
        quotedHours: r.quotedHours,
        actualHours: r.actualHours,
        variancePct: r.jobId ? variance(r.quotedHours, r.actualHours, r.variancePct) : null,
        status,
        statusLabel: RECORD_STATUS_LABEL[status],
        classification: r.jobClass ? maxClass(r.quoteClass, r.jobClass) : r.quoteClass,
      },
      outcome: r.outcome,
      lostReason: r.lostReason,
      customerId: r.customerId,
      personIds: [r.quotedById, r.leadPersonId].filter((x): x is string => !!x),
      machineIds: [r.primaryMachineId, r.secondaryMachineId, r.actualMachineId].filter((x): x is string => !!x),
    });
  }
  for (const r of internalRows) {
    rows.push({
      vm: {
        id: r.jobId,
        href: jobHref(r.jobId),
        kind: "internal",
        quoteId: null,
        quoteNumber: null,
        jobId: r.jobId,
        jobNumber: r.jobNumber,
        date: r.startedOn,
        dateKind: "started",
        partNumber: r.partNumber,
        partRevision: r.partRevision,
        partDescription: r.partDescription,
        customerName: null,
        quotedBy: null,
        quotedHours: null,
        actualHours: r.actualHours,
        variancePct: null,
        status: r.jobStatus,
        statusLabel: RECORD_STATUS_LABEL[r.jobStatus],
        classification: r.jobClass,
      },
      outcome: null,
      lostReason: null,
      customerId: null,
      personIds: r.leadPersonId ? [r.leadPersonId] : [],
      machineIds: r.actualMachineId ? [r.actualMachineId] : [],
    });
  }

  // Newest first by quoted date (internal work orders by start date); ties by ID, descending, for a stable order.
  rows.sort((a, b) => {
    const da = a.vm.date ?? "";
    const dbb = b.vm.date ?? "";
    if (da !== dbb) return da < dbb ? 1 : -1;
    return a.vm.id < b.vm.id ? 1 : a.vm.id > b.vm.id ? -1 : 0;
  });
  return rows;
}

/** Stored variance when present, else computed from the hours (1 decimal); null without actuals. */
function variance(quoted: number | null, actual: number | null, stored: number | null): number | null {
  if (stored !== null && Number.isFinite(stored)) return stored;
  if (quoted === null || actual === null || !(quoted > 0)) return null;
  return Math.round(((actual - quoted) / quoted) * 1000) / 10;
}

function matches(row: RawRow, f: JobFilters): boolean {
  if (f.customer) {
    if (f.customer === INTERNAL_CUSTOMER ? row.customerId !== null : row.customerId !== f.customer) return false;
  }
  if (f.person && !row.personIds.includes(f.person)) return false;
  if (f.machine && !row.machineIds.includes(f.machine)) return false;
  if (f.status && row.vm.status !== f.status) return false;
  if (f.classification && row.vm.classification !== f.classification) return false;
  // resolveFilters() only keeps `outcome` for roles that can see win/loss.
  if (f.outcome && row.outcome !== f.outcome) return false;
  return true;
}

function toRowVm(row: RawRow, role: Role): JobRowVM {
  return {
    ...row.vm,
    outcome: row.outcome === null ? null : gated(role, "winLoss", outcomeVm(row.outcome, row.lostReason)),
  };
}

/** All jobs and quotes for a role, newest first, filtered (no prices for anyone; outcome gated). */
export function listJobs(db: Db, actor: JobsActor, filters: JobFilters = {}): JobRowVM[] {
  const f = canSee(actor.role, "winLoss") ? filters : { ...filters, outcome: undefined };
  return loadRows(db)
    .filter((r) => matches(r, f))
    .map((r) => toRowVm(r, actor.role));
}

/** The /jobs page: rows, filter groups (outcome only for owner/quoter) and active-filter chips. */
export function jobsPage(db: Db, actor: JobsActor, rawFilters: Readonly<Record<string, unknown>>): JobsPageVM {
  const sets = filterOptionSets(db);
  const filters = resolveFilters(rawFilters, actor.role, sets);
  const showOutcome = canSee(actor.role, "winLoss");
  const all = loadRows(db);
  const rows = all.filter((r) => matches(r, filters)).map((r) => toRowVm(r, actor.role));

  const keys = JOB_FILTER_KEYS.filter((k) => k !== "outcome" || showOutcome);
  const filterGroups: JobFilterGroupVM[] = keys.map((key) => ({
    key,
    label: FILTER_LABEL[key],
    options: sets[key],
    selected: filters[key] ?? null,
  }));
  const activeFilters: JobActiveFilterVM[] = keys
    .filter((key) => filters[key])
    .map((key) => {
      const value = filters[key] as string;
      const rest: JobFilters = { ...filters };
      delete rest[key];
      return {
        key,
        label: key === "person" ? "Quoted or led by" : FILTER_LABEL[key],
        valueLabel: sets[key].find((o) => o.value === value)?.label ?? value,
        removeHref: jobsHref(rest),
      };
    });

  return {
    rows,
    totalCount: all.length,
    filterGroups,
    activeFilters,
    showOutcome,
    outcomeHiddenLabel: showOutcome ? null : hiddenLabel(actor.role),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------------------------------------------

export interface PartVM {
  id: string;
  partNumber: string;
  revision: string;
  description: string;
  family: PartFamily;
  familyLabel: string;
  materialId: string;
  materialName: string;
  features: ChipVM[];
  minWallIn: number | null;
  maxWallHeightIn: number | null;
  tightestTolIn: number | null;
  envelopeIn: string | null;
  complexity: number;
  exportControl: ExportControl;
  exportControlLabel: string;
  notes: string | null;
  classification: Classification;
}

export interface CustomerVM {
  id: string;
  name: string;
  industry: Industry;
  industryLabel: string;
  isNewCustomer: boolean;
  qualityRequirements: string | null;
  classification: Classification;
}

export interface QuoteVM {
  id: string;
  quoteNumber: string;
  quotedOn: string;
  quotedBy: PersonRefVM;
  qty: number;
  primaryMachine: MachineRefVM;
  secondaryMachine: MachineRefVM | null;
  quotedSetupHours: number;
  quotedCycleMinutes: number;
  quotedHours: number;
  leadTimeDays: number | null;
  /** Gated by winLoss: quoter notes can state the outcome ("they went with a lower bid"). null = no notes. */
  quoterNotes: Gated<string> | null;
  classification: Classification;
  classificationSource: "derived" | "override_up" | "override_down";
  classificationReason: string | null;
}

export interface JobVM {
  id: string;
  jobNumber: string;
  status: JobStatus;
  statusLabel: string;
  lead: PersonRefVM | null;
  machine: MachineRefVM | null;
  startedOn: string | null;
  shippedOn: string | null;
  actualSetupHours: number | null;
  actualRunHours: number | null;
  actualHours: number | null;
  onTime: boolean | null;
  scrapQty: number;
  ncrCount: number;
  debrief: string | null;
  classification: Classification;
  classificationSource: "derived" | "override_up" | "override_down";
  classificationReason: string | null;
}

/** Quoted vs actual hours for the bar (visible to every role, PLAN.md §4.8). */
export interface HoursVM {
  /** complete / in_process / scheduled (a job exists) · no_job (a quote only) · internal (not quoted). */
  state: RecordStatus | "internal";
  quotedHours: number | null;
  quotedSetupHours: number | null;
  /** quoted_hours − quoted_setup_hours (qty × cycle), 1 decimal. */
  quotedRunHours: number | null;
  actualHours: number | null;
  actualSetupHours: number | null;
  actualRunHours: number | null;
  /** Signed percent, e.g. 53.7. */
  variancePct: number | null;
  /** actual − quoted, 1 decimal (signed). */
  deltaHours: number | null;
}

/** Every price field of `quote_financials` (owner and quoters only). */
export interface FinancialValues {
  unitPriceUsd: number;
  totalPriceUsd: number;
  targetMarginPct: number;
  shopRateUsdPerHr: number;
  materialCostUsd: number;
  outsideProcessingUsd: number;
  riskAdderHours: number;
  scrapAllowancePct: number;
}

/**
 * The quote's prices, gated by `prices` as one slot: machinist and trainee get a single Hidden placeholder, so the
 * payload carries no amount and no pricing field name (PLAN.md §4.8). `value: null` = a role that may see prices, but
 * the quote has no quote_financials row.
 */
export type FinancialsVM = Gated<FinancialValues | null>;

export interface ReasoningLogVM {
  id: string;
  person: PersonRefVM;
  mainDriver: string | null;
  machineRationale: string | null;
  hoursRationale: string | null;
  riskPricedIn: string | null;
  riskBucket: RiskBucket | null;
  riskBucketLabel: string | null;
  whatWouldChange: string | null;
  juniorWouldMiss: string | null;
  confidence1to5: number | null;
  varianceReview: string | null;
  /** ISO timestamp (created_at). */
  createdAt: string;
  classification: Classification;
}

export interface LinkedCardVM {
  id: string;
  href: string;
  title: string;
  type: CardType;
  typeLabel: string;
  status: CardStatus;
  statusLabel: string;
  contributor: PersonRefVM;
  /** Which of this page's records the card links to. */
  linkedVia: ("job" | "quote")[];
  /** The expert's words that pointed at this record, when the link came from a mention. */
  mention: string | null;
  classification: Classification;
}

export interface MachineEventVM {
  id: string;
  machine: MachineRefVM;
  occurredOn: string;
  kind: MachineEventKind;
  kindLabel: string;
  summary: string;
  classification: Classification;
}

export interface RelatedQuoteVM {
  /** Job ID when a job exists, else the quote ID. */
  id: string;
  href: string;
  quoteId: string;
  quoteNumber: string;
  quotedOn: string;
  quotedBy: PersonRefVM;
  qty: number;
  quotedHours: number;
  jobNumber: string | null;
  actualHours: number | null;
  variancePct: number | null;
  status: RecordStatus;
  statusLabel: string;
  outcome: Gated<OutcomeVM>;
  classification: Classification;
}

export interface JobDetailVM {
  /** Canonical ID: the job ID when a job exists, otherwise the quote ID. */
  id: string;
  kind: "quote_and_job" | "quote_only" | "internal";
  /** e.g. "Job RJ-26-0420", "Quote RQ-26-0911", "Internal work order RJ-26-9001". */
  title: string;
  /** The higher of the job's and the quote's own labels. */
  classification: Classification;
  part: PartVM;
  customer: CustomerVM | null;
  quote: QuoteVM | null;
  /** Gated by winLoss; null for internal work orders. */
  outcome: Gated<OutcomeVM> | null;
  job: JobVM | null;
  hours: HoursVM;
  judgmentDrivers: ChipVM[];
  /** null for internal work orders (not quoted). */
  financials: FinancialsVM | null;
  reasoningLogs: ReasoningLogVM[];
  linkedCards: LinkedCardVM[];
  machineEvents: MachineEventVM[];
  relatedQuotes: RelatedQuoteVM[];
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function machineRefs(db: Db, ids: (string | null)[]): Map<string, MachineRefVM> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (wanted.length === 0) return new Map();
  const rows = db.select({ id: machines.id, name: machines.name, assetTag: machines.assetTag }).from(machines).where(inArray(machines.id, wanted)).all();
  return new Map(rows.map((m) => [m.id, m]));
}

function personRefs(db: Db, ids: (string | null)[]): Map<string, PersonRefVM> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (wanted.length === 0) return new Map();
  const rows = db.select({ id: people.id, name: people.fullName }).from(people).where(inArray(people.id, wanted)).all();
  return new Map(rows.map((p) => [p.id, p]));
}

const JOB_FIELDS = {
  id: jobs.id,
  jobNumber: jobs.jobNumber,
  quoteId: jobs.quoteId,
  partId: jobs.partId,
  status: jobs.status,
  startedOn: jobs.startedOn,
  shippedOn: jobs.shippedOn,
  leadPersonId: jobs.leadPersonId,
  actualMachineId: jobs.actualMachineId,
  actualSetupHours: jobs.actualSetupHours,
  actualRunHours: jobs.actualRunHours,
  actualHours: jobs.actualHours,
  variancePct: jobs.variancePct,
  scrapQty: jobs.scrapQty,
  ncrCount: jobs.ncrCount,
  onTime: jobs.onTime,
  debriefMd: jobs.debriefMd,
  classification: jobs.classification,
  classificationSource: jobs.classificationSource,
  classificationReason: jobs.classificationReason,
};

// Explicit columns: never `select()` all of quotes, and never join quote_financials here.
const QUOTE_FIELDS = {
  id: quotes.id,
  quoteNumber: quotes.quoteNumber,
  partId: quotes.partId,
  customerId: quotes.customerId,
  quotedOn: quotes.quotedOn,
  quotedByPersonId: quotes.quotedByPersonId,
  qty: quotes.qty,
  primaryMachineId: quotes.primaryMachineId,
  secondaryMachineId: quotes.secondaryMachineId,
  quotedSetupHours: quotes.quotedSetupHours,
  quotedCycleMinutes: quotes.quotedCycleMinutes,
  quotedHours: quotes.quotedHours,
  leadTimeDays: quotes.leadTimeDays,
  outcome: quotes.outcome,
  lostReason: quotes.lostReason,
  judgmentDrivers: quotes.judgmentDrivers,
  quoterNotesMd: quotes.quoterNotesMd,
  classification: quotes.classification,
  classificationSource: quotes.classificationSource,
  classificationReason: quotes.classificationReason,
};


type JobRow = NonNullable<ReturnType<ReturnType<typeof selectJob>["get"]>>;
type QuoteRow = NonNullable<ReturnType<ReturnType<typeof selectQuote>["get"]>>;
function selectJob(db: Db) {
  return db.select(JOB_FIELDS).from(jobs);
}
function selectQuote(db: Db) {
  return db.select(QUOTE_FIELDS).from(quotes);
}

function financialsFor(db: Db, role: Role, quoteId: string): FinancialsVM {
  // DATA-LAYER.md rule 3: quote_financials is queried only for roles that may see prices.
  if (!canSee(role, "prices")) return hidden(role);
  const f = db
    .select({
      unitPriceUsd: quoteFinancials.unitPriceUsd,
      totalPriceUsd: quoteFinancials.totalPriceUsd,
      targetMarginPct: quoteFinancials.targetMarginPct,
      shopRateUsdPerHr: quoteFinancials.shopRateUsdPerHr,
      materialCostUsd: quoteFinancials.materialCostUsd,
      outsideProcessingUsd: quoteFinancials.outsideProcessingUsd,
      riskAdderHours: quoteFinancials.riskAdderHours,
      scrapAllowancePct: quoteFinancials.scrapAllowancePct,
    })
    .from(quoteFinancials)
    .where(eq(quoteFinancials.quoteId, quoteId))
    .get();
  return gated(role, "prices", f ?? null);
}

/**
 * One job or quote page. Accepts a job ID (J-A03), a quote ID (Q-A01; a quote without a job still has a page, and a
 * quote with a job resolves to the same page as its job) or an internal work order (J-I01). Unknown IDs → null.
 */
export function jobDetail(db: Db, actor: JobsActor, id: string): JobDetailVM | null {
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return null;
  const role = actor.role;

  let job: JobRow | null = selectJob(db).where(eq(jobs.id, id)).get() ?? null;
  let quote: QuoteRow | null;
  if (job) {
    quote = job.quoteId ? getQuote(db, job.quoteId) : null;
  } else {
    quote = getQuote(db, id);
    if (!quote) return null;
    job = selectJob(db).where(eq(jobs.quoteId, quote.id)).get() ?? null;
  }
  // Every page has a job, a quote or both; resolve the "primary" record once so later code needs no assertions.
  const primary = job ?? quote;
  if (!primary) return null;
  const partId = primary.partId;

  const partRow = db
    .select({
      id: parts.id,
      customerId: parts.customerId,
      partNumber: parts.partNumber,
      revision: parts.revision,
      description: parts.description,
      family: parts.family,
      materialId: parts.materialId,
      materialName: materials.name,
      features: parts.features,
      minWallIn: parts.minWallIn,
      maxWallHeightIn: parts.maxWallHeightIn,
      tightestTolIn: parts.tightestTolIn,
      envelopeIn: parts.envelopeIn,
      complexity: parts.complexity,
      exportControl: parts.exportControl,
      notesMd: parts.notesMd,
      classification: parts.classification,
    })
    .from(parts)
    .innerJoin(materials, eq(materials.id, parts.materialId))
    .where(eq(parts.id, partId))
    .get();
  if (!partRow) return null;

  const customerId = quote?.customerId ?? partRow.customerId;
  // Never customer_accounts (contacts): names and documented quality requirements only.
  const customerRow = customerId
    ? db
        .select({
          id: customers.id,
          name: customers.name,
          industry: customers.industry,
          isNewCustomer: customers.isNewCustomer,
          qualityRequirementsMd: customers.qualityRequirementsMd,
          classification: customers.classification,
        })
        .from(customers)
        .where(eq(customers.id, customerId))
        .get()
    : undefined;

  const machineMap = machineRefs(db, [quote?.primaryMachineId ?? null, quote?.secondaryMachineId ?? null, job?.actualMachineId ?? null]);
  const personMap = personRefs(db, [quote?.quotedByPersonId ?? null, job?.leadPersonId ?? null]);

  const part: PartVM = {
    id: partRow.id,
    partNumber: partRow.partNumber,
    revision: partRow.revision,
    description: partRow.description,
    family: partRow.family,
    familyLabel: FAMILY_LABEL[partRow.family],
    materialId: partRow.materialId,
    materialName: partRow.materialName,
    features: partRow.features.map((k) => ({ key: k, label: FEATURE_LABEL[k] ?? k })),
    minWallIn: partRow.minWallIn,
    maxWallHeightIn: partRow.maxWallHeightIn,
    tightestTolIn: partRow.tightestTolIn,
    envelopeIn: partRow.envelopeIn,
    complexity: partRow.complexity,
    exportControl: partRow.exportControl,
    exportControlLabel: EXPORT_CONTROL_LABEL[partRow.exportControl],
    notes: partRow.notesMd,
    classification: partRow.classification,
  };

  const customer: CustomerVM | null = customerRow
    ? {
        id: customerRow.id,
        name: customerRow.name,
        industry: customerRow.industry,
        industryLabel: INDUSTRY_LABEL[customerRow.industry],
        isNewCustomer: customerRow.isNewCustomer,
        qualityRequirements: customerRow.qualityRequirementsMd,
        classification: customerRow.classification,
      }
    : null;

  const quoteVm: QuoteVM | null = quote
    ? {
        id: quote.id,
        quoteNumber: quote.quoteNumber,
        quotedOn: quote.quotedOn,
        quotedBy: personMap.get(quote.quotedByPersonId) ?? { id: quote.quotedByPersonId, name: quote.quotedByPersonId },
        qty: quote.qty,
        primaryMachine: machineMap.get(quote.primaryMachineId) ?? { id: quote.primaryMachineId, name: quote.primaryMachineId, assetTag: "" },
        secondaryMachine: quote.secondaryMachineId ? (machineMap.get(quote.secondaryMachineId) ?? null) : null,
        quotedSetupHours: quote.quotedSetupHours,
        quotedCycleMinutes: quote.quotedCycleMinutes,
        quotedHours: quote.quotedHours,
        leadTimeDays: quote.leadTimeDays,
        quoterNotes: quote.quoterNotesMd ? gated(role, "winLoss", quote.quoterNotesMd) : null,
        classification: quote.classification,
        classificationSource: quote.classificationSource,
        classificationReason: quote.classificationReason,
      }
    : null;

  const jobVm: JobVM | null = job
    ? {
        id: job.id,
        jobNumber: job.jobNumber,
        status: job.status,
        statusLabel: RECORD_STATUS_LABEL[job.status],
        lead: job.leadPersonId ? (personMap.get(job.leadPersonId) ?? null) : null,
        machine: job.actualMachineId ? (machineMap.get(job.actualMachineId) ?? null) : null,
        startedOn: job.startedOn,
        shippedOn: job.shippedOn,
        actualSetupHours: job.actualSetupHours,
        actualRunHours: job.actualRunHours,
        actualHours: job.actualHours,
        onTime: job.onTime,
        scrapQty: job.scrapQty,
        ncrCount: job.ncrCount,
        debrief: job.debriefMd,
        classification: job.classification,
        classificationSource: job.classificationSource,
        classificationReason: job.classificationReason,
      }
    : null;

  const quotedHours = quote?.quotedHours ?? null;
  const actualHours = job?.actualHours ?? null;
  const hours: HoursVM = {
    state: !quote ? "internal" : recordStatus(job?.status ?? null),
    quotedHours,
    quotedSetupHours: quote?.quotedSetupHours ?? null,
    quotedRunHours: quote ? round1(quote.quotedHours - quote.quotedSetupHours) : null,
    actualHours,
    actualSetupHours: job?.actualSetupHours ?? null,
    actualRunHours: job?.actualRunHours ?? null,
    variancePct: quote && job ? variance(quotedHours, actualHours, job.variancePct) : null,
    deltaHours: quotedHours !== null && actualHours !== null ? round1(actualHours - quotedHours) : null,
  };

  const classification = quote && job ? maxClass(quote.classification, job.classification) : primary.classification;
  const kind: JobDetailVM["kind"] = !quote ? "internal" : job ? "quote_and_job" : "quote_only";
  const title = job
    ? quote
      ? `Job ${job.jobNumber}`
      : `Internal work order ${job.jobNumber}`
    : `Quote ${quote ? quote.quoteNumber : primary.id}`;

  return {
    id: primary.id,
    kind,
    title,
    classification,
    part,
    customer,
    quote: quoteVm,
    outcome: quote ? gated(role, "winLoss", outcomeVm(quote.outcome, quote.lostReason)) : null,
    job: jobVm,
    hours,
    judgmentDrivers: (quote?.judgmentDrivers ?? []).map((k) => ({ key: k, label: DRIVER_LABEL[k] ?? k })),
    financials: quote ? financialsFor(db, role, quote.id) : null,
    reasoningLogs: quote ? reasoningLogsFor(db, quote.id) : [],
    linkedCards: linkedCardsFor(db, job?.id ?? null, quote?.id ?? null),
    machineEvents: job ? machineEventsFor(db, job.id) : [],
    relatedQuotes: relatedQuotesFor(db, role, partRow.id, quote?.id ?? null),
  };
}

function getQuote(db: Db, id: string): QuoteRow | null {
  return selectQuote(db).where(eq(quotes.id, id)).get() ?? null;
}

function reasoningLogsFor(db: Db, quoteId: string): ReasoningLogVM[] {
  return db
    .select({
      id: quoteReasoningLogs.id,
      personId: quoteReasoningLogs.personId,
      personName: people.fullName,
      mainDriver: quoteReasoningLogs.mainDriver,
      machineRationale: quoteReasoningLogs.machineRationale,
      hoursRationale: quoteReasoningLogs.hoursRationale,
      riskPricedIn: quoteReasoningLogs.riskPricedIn,
      riskBucket: quoteReasoningLogs.riskBucket,
      whatWouldChange: quoteReasoningLogs.whatWouldChange,
      juniorWouldMiss: quoteReasoningLogs.juniorWouldMiss,
      confidence1to5: quoteReasoningLogs.confidence1to5,
      varianceReviewMd: quoteReasoningLogs.varianceReviewMd,
      createdAt: quoteReasoningLogs.createdAt,
      classification: quoteReasoningLogs.classification,
    })
    .from(quoteReasoningLogs)
    .innerJoin(people, eq(people.id, quoteReasoningLogs.personId))
    .where(eq(quoteReasoningLogs.quoteId, quoteId))
    .orderBy(asc(quoteReasoningLogs.createdAt), asc(quoteReasoningLogs.id))
    .all()
    .map((r) => ({
      id: r.id,
      person: { id: r.personId, name: r.personName },
      mainDriver: r.mainDriver,
      machineRationale: r.machineRationale,
      hoursRationale: r.hoursRationale,
      riskPricedIn: r.riskPricedIn,
      riskBucket: r.riskBucket,
      riskBucketLabel: r.riskBucket ? RISK_BUCKET_LABEL[r.riskBucket] : null,
      whatWouldChange: r.whatWouldChange,
      juniorWouldMiss: r.juniorWouldMiss,
      confidence1to5: r.confidence1to5,
      varianceReview: r.varianceReviewMd,
      createdAt: r.createdAt,
      classification: r.classification,
    }));
}

const CARD_STATUS_ORDER: Readonly<Record<CardStatus, number>> = {
  approved: 0,
  pending_review: 1,
  draft: 2,
  rejected: 3,
  superseded: 4,
};

function linkedCardsFor(db: Db, jobId: string | null, quoteId: string | null): LinkedCardVM[] {
  const conds = [jobId ? eq(cardLinks.jobId, jobId) : undefined, quoteId ? eq(cardLinks.quoteId, quoteId) : undefined].filter((c) => c !== undefined);
  if (conds.length === 0) return [];
  const rows = db
    .select({
      cardId: knowledgeCards.id,
      title: knowledgeCards.title,
      type: knowledgeCards.type,
      status: knowledgeCards.status,
      classification: knowledgeCards.classification,
      contributorId: knowledgeCards.sourcePersonId,
      contributorName: people.fullName,
      linkJobId: cardLinks.jobId,
      mention: cardLinks.mention,
    })
    .from(cardLinks)
    .innerJoin(knowledgeCards, eq(knowledgeCards.id, cardLinks.cardId))
    .innerJoin(people, eq(people.id, knowledgeCards.sourcePersonId))
    .where(or(...conds))
    .orderBy(asc(knowledgeCards.id), asc(cardLinks.id))
    .all();

  const byId = new Map<string, LinkedCardVM>();
  for (const r of rows) {
    const via: "job" | "quote" = r.linkJobId ? "job" : "quote";
    const existing = byId.get(r.cardId);
    if (existing) {
      if (!existing.linkedVia.includes(via)) existing.linkedVia.push(via);
      existing.mention ??= r.mention;
      continue;
    }
    byId.set(r.cardId, {
      id: r.cardId,
      href: `/library/${encodeURIComponent(r.cardId)}`,
      title: r.title,
      type: r.type,
      typeLabel: CARD_TYPE_LABEL[r.type],
      status: r.status,
      statusLabel: CARD_STATUS_LABEL[r.status],
      contributor: { id: r.contributorId, name: r.contributorName },
      linkedVia: [via],
      mention: r.mention,
      classification: r.classification,
    });
  }
  return [...byId.values()].sort((a, b) => CARD_STATUS_ORDER[a.status] - CARD_STATUS_ORDER[b.status] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function machineEventsFor(db: Db, jobId: string): MachineEventVM[] {
  return db
    .select({
      id: machineEvents.id,
      machineId: machines.id,
      machineName: machines.name,
      assetTag: machines.assetTag,
      occurredOn: machineEvents.occurredOn,
      kind: machineEvents.kind,
      summary: machineEvents.summary,
      classification: machineEvents.classification,
    })
    .from(machineEvents)
    .innerJoin(machines, eq(machines.id, machineEvents.machineId))
    .where(eq(machineEvents.jobId, jobId))
    .orderBy(desc(machineEvents.occurredOn), asc(machineEvents.id))
    .all()
    .map((r) => ({
      id: r.id,
      machine: { id: r.machineId, name: r.machineName, assetTag: r.assetTag },
      occurredOn: r.occurredOn,
      kind: r.kind,
      kindLabel: MACHINE_EVENT_KIND_LABEL[r.kind],
      summary: r.summary,
      classification: r.classification,
    }));
}

function relatedQuotesFor(db: Db, role: Role, partId: string, excludeQuoteId: string | null): RelatedQuoteVM[] {
  const where = excludeQuoteId ? and(eq(quotes.partId, partId), ne(quotes.id, excludeQuoteId)) : eq(quotes.partId, partId);
  return db
    .select({
      quoteId: quotes.id,
      quoteNumber: quotes.quoteNumber,
      quotedOn: quotes.quotedOn,
      quotedById: quotes.quotedByPersonId,
      quotedByName: people.fullName,
      qty: quotes.qty,
      quotedHours: quotes.quotedHours,
      outcome: quotes.outcome,
      lostReason: quotes.lostReason,
      quoteClass: quotes.classification,
      jobId: jobs.id,
      jobNumber: jobs.jobNumber,
      jobStatus: jobs.status,
      actualHours: jobs.actualHours,
      variancePct: jobs.variancePct,
      jobClass: jobs.classification,
    })
    .from(quotes)
    .innerJoin(people, eq(people.id, quotes.quotedByPersonId))
    .leftJoin(jobs, eq(jobs.quoteId, quotes.id))
    .where(where)
    .orderBy(desc(quotes.quotedOn), desc(quotes.id))
    .all()
    .map((r) => {
      const status = recordStatus(r.jobStatus);
      const id = r.jobId ?? r.quoteId;
      return {
        id,
        href: jobHref(id),
        quoteId: r.quoteId,
        quoteNumber: r.quoteNumber,
        quotedOn: r.quotedOn,
        quotedBy: { id: r.quotedById, name: r.quotedByName },
        qty: r.qty,
        quotedHours: r.quotedHours,
        jobNumber: r.jobNumber,
        actualHours: r.actualHours,
        variancePct: r.jobId ? variance(r.quotedHours, r.actualHours, r.variancePct) : null,
        status,
        statusLabel: RECORD_STATUS_LABEL[status],
        outcome: gated(role, "winLoss", outcomeVm(r.outcome, r.lostReason)),
        classification: r.jobClass ? maxClass(r.quoteClass, r.jobClass) : r.quoteClass,
      };
    });
}
