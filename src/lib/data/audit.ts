/**
 * The /audit viewer's data (PLAN.md §4.7, docs/AI-GATEWAY.md §7.3). Pure query functions over an explicit Db.
 *
 * Scope: the owner (viewAll) sees every row; every other role sees only its own rows (actor_person_id = personId, or
 * the persona when there is no person). Names are resolved at view time (the audit stores IDs only). The free-text
 * filter is run through the redactor first, so "Aerovance" finds rows that only contain [[CUSTOMER_…]]; it is never
 * logged and only ever matched against redacted columns.
 */
import { and, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  aiAuditLog,
  customers,
  eventLog,
  jobs,
  knowledgeCards,
  parts,
  personas,
  quotes,
  type AuditTransport,
  type Classification,
  type EventKind,
  type ProviderKind,
  type Role,
} from "@/db/schema";
import { can } from "@/lib/auth/roles";
import { DECISION_LABEL, FEATURE_LABEL, OUTCOME_LABEL, TRANSPORT_LABEL, providerLine, replayLabel, storedFormLabel } from "@/lib/audit/labels";
import { canRevealRow } from "@/lib/audit/reveal";
import { isSeededRequestId, type AuditFilters, type AuditRow, type AuditViewer, type EventRow } from "@/lib/audit/types";
import { renderNotice } from "@/lib/policy/notices";
import type { Notice, RenderedNotice } from "@/lib/policy/types";
import { redactText } from "@/lib/redaction/redact";
import type { PatternTokenResolver, RedactionDictionary } from "@/lib/redaction/types";
import { tokensIn } from "@/lib/redaction/patterns";
import { labelNamePart } from "./personas";

export const AUDIT_PAGE_LIMIT = 200;

export interface AuditRowVM {
  id: number;
  createdAt: string;
  requestId: string;
  actorLabel: string;
  actorRole: Role;
  feature: string;
  featureLabel: string;
  task: string;
  mode: string;
  decision: AuditRow["decision"];
  decisionLabel: string;
  providerKind: ProviderKind | null;
  providerLabel: string;
  maxClassification: Classification | null;
  sentCount: number;
  withheldCount: number;
  transport: AuditTransport;
  replayLabel: string | null;
  outcome: AuditRow["outcome"];
  outcomeLabel: string;
  isSeeded: boolean;
  canReveal: boolean;
  tokenCount: number;
}

export interface AuditRecordVM {
  ref: string;
  label: string;
  classification?: Classification;
  reason?: string;
}

export interface AuditDetailVM extends AuditRowVM {
  completedAt: string | null;
  parentId: number | null;
  attempt: number;
  model: string | null;
  servedModel: string | null;
  endpointHost: string | null;
  region: string | null;
  crossRegion: string | null;
  isCloud: boolean | null;
  transportLabel: string;
  cassetteProvenance: AuditRow["cassetteProvenance"];
  classificationsIncluded: Classification[];
  recordsSent: AuditRecordVM[];
  recordsWithheld: AuditRecordVM[];
  notice: RenderedNotice | null;
  tokensUsed: string[];
  userInputRedacted: string | null;
  /** Pretty-printed canonical JSON of what was sent (cloud) or the storage-redacted rendering (local). */
  requestPayloadRedacted: string | null;
  payloadHash: string | null;
  storedFormLabel: string | null;
  responseRedacted: string | null;
  promptVersion: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  ttftMs: number | null;
  stopReason: string | null;
  errorCode: string | null;
  citationsValid: number;
  citationsStripped: number;
  policyVersion: string;
  appVersion: string;
  /** The repair-retry chain this row belongs to (parent first), when there is one. */
  retryChain: number[];
}

export interface EventRowVM {
  id: number;
  createdAt: string;
  kind: EventKind;
  actorLabel: string;
  subject: string | null;
  classification: Classification | null;
  details: string;
}

export interface AuditListVM {
  rows: AuditRowVM[];
  events?: EventRowVM[];
  truncated: boolean;
  scope: "all" | "own";
}

function personaLabels(db: Db): Map<string, string> {
  return new Map(db.select({ id: personas.id, label: personas.label }).from(personas).all().map((p) => [p.id, labelNamePart(p.label)]));
}

function actorLabel(labels: Map<string, string>, row: { actorPersonaId: string | null; actorRole: Role | null }): string {
  return (row.actorPersonaId && labels.get(row.actorPersonaId)) || (row.actorRole ? `(${row.actorRole})` : "System");
}

function scopeCondition(viewer: AuditViewer): SQL | undefined {
  if (can(viewer.role, "viewAll")) return undefined;
  if (viewer.personId) return eq(aiAuditLog.actorPersonId, viewer.personId);
  return and(sql`${aiAuditLog.actorPersonId} IS NULL`, eq(aiAuditLog.actorPersonaId, viewer.personaId));
}

function eventScope(viewer: AuditViewer): SQL | undefined {
  if (can(viewer.role, "viewAll")) return undefined;
  if (viewer.personId) return eq(eventLog.actorPersonId, viewer.personId);
  return eq(eventLog.actorPersonaId, viewer.personaId);
}

/** Escape LIKE wildcards; used with ESCAPE '\'. */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface AuditSearchDeps {
  dict: RedactionDictionary;
  /** Read-only: searching never mints or persists tokens. */
  patterns: PatternTokenResolver;
}

function filterConditions(f: AuditFilters, deps: AuditSearchDeps): SQL[] {
  const c: SQL[] = [];
  if (f.from && DATE_RE.test(f.from)) c.push(sql`substr(${aiAuditLog.createdAt}, 1, 10) >= ${f.from}`);
  if (f.to && DATE_RE.test(f.to)) c.push(sql`substr(${aiAuditLog.createdAt}, 1, 10) <= ${f.to}`);
  if (f.personaId) c.push(eq(aiAuditLog.actorPersonaId, f.personaId));
  if (f.role) c.push(eq(aiAuditLog.actorRole, f.role));
  if (f.feature) c.push(eq(aiAuditLog.feature, f.feature));
  if (f.providerKind) c.push(eq(aiAuditLog.providerKind, f.providerKind));
  if (f.model) c.push(eq(aiAuditLog.model, f.model));
  if (f.mode) c.push(eq(aiAuditLog.mode, f.mode));
  if (f.decision) c.push(eq(aiAuditLog.decision, f.decision));
  if (f.classification) c.push(eq(aiAuditLog.maxClassification, f.classification));
  if (f.outcome) c.push(eq(aiAuditLog.outcome, f.outcome));
  if (f.replay === "live") c.push(eq(aiAuditLog.transport, "live"));
  if (f.replay === "replay") c.push(inArray(aiAuditLog.transport, ["demo_replay_exact", "demo_replay_scenario"]));
  if (f.replay === "fallback") c.push(eq(aiAuditLog.transport, "demo_fallback"));
  if (f.replay === "seeded") c.push(eq(aiAuditLog.transport, "seeded"));
  if (f.replay === "not_sent") c.push(eq(aiAuditLog.transport, "none"));
  const q = f.q?.trim().slice(0, 200);
  if (q) {
    const redacted = redactText(q, deps.dict, deps.patterns).value;
    const pattern = `%${likeEscape(redacted)}%`;
    const text = or(
      sql`${aiAuditLog.userInputRedacted} LIKE ${pattern} ESCAPE '\\'`,
      sql`${aiAuditLog.requestPayloadRedacted} LIKE ${pattern} ESCAPE '\\'`,
      sql`${aiAuditLog.responseRedacted} LIKE ${pattern} ESCAPE '\\'`,
      ...tokensIn(redacted).map((t) => like(aiAuditLog.tokensUsed, `%"${t}"%`)),
    );
    if (text) c.push(text);
  }
  return c;
}

function toRowVM(r: AuditRow, labels: Map<string, string>, viewer: AuditViewer): AuditRowVM {
  return {
    id: r.id,
    createdAt: r.createdAt,
    requestId: r.requestId,
    actorLabel: actorLabel(labels, r),
    actorRole: r.actorRole,
    feature: r.feature,
    featureLabel: FEATURE_LABEL[r.feature] ?? r.feature,
    task: r.task,
    mode: r.mode,
    decision: r.decision,
    decisionLabel: DECISION_LABEL[r.decision],
    providerKind: r.providerKind,
    providerLabel: providerLine(r),
    maxClassification: r.maxClassification,
    sentCount: r.recordsSent.length,
    withheldCount: r.recordsWithheld.length,
    transport: r.transport,
    replayLabel: replayLabel(r),
    outcome: r.outcome,
    outcomeLabel: OUTCOME_LABEL[r.outcome],
    isSeeded: isSeededRequestId(r.requestId),
    canReveal: canRevealRow(r, viewer) && r.tokensUsed.length > 0,
    tokenCount: r.tokensUsed.length,
  };
}

function eventVM(e: EventRow, labels: Map<string, string>): EventRowVM {
  const details = Object.entries(e.detailsJson ?? {})
    .map(([k, v]) => `${k}: ${v === null ? "—" : String(v)}`)
    .join(" · ");
  return {
    id: e.id,
    createdAt: e.createdAt,
    kind: e.kind,
    actorLabel: actorLabel(labels, e),
    subject: e.subjectKind ? `${e.subjectKind}${e.subjectId ? ` ${e.subjectId}` : ""}` : null,
    classification: e.classification,
    details,
  };
}

export function listAuditRows(db: Db, viewer: AuditViewer, filters: AuditFilters, deps: AuditSearchDeps): AuditListVM {
  const conds = [scopeCondition(viewer), ...filterConditions(filters, deps)].filter((x): x is SQL => x !== undefined);
  const rows = db
    .select()
    .from(aiAuditLog)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(aiAuditLog.createdAt), desc(aiAuditLog.id))
    .limit(AUDIT_PAGE_LIMIT + 1)
    .all();
  const labels = personaLabels(db);
  const out: AuditListVM = {
    rows: rows.slice(0, AUDIT_PAGE_LIMIT).map((r) => toRowVM(r, labels, viewer)),
    truncated: rows.length > AUDIT_PAGE_LIMIT,
    scope: can(viewer.role, "viewAll") ? "all" : "own",
  };
  if (filters.includeEvents) {
    const scope = eventScope(viewer);
    const ev = db
      .select()
      .from(eventLog)
      .where(scope)
      .orderBy(desc(eventLog.createdAt), desc(eventLog.id))
      .limit(AUDIT_PAGE_LIMIT)
      .all();
    out.events = ev.map((e) => eventVM(e, labels));
  }
  return out;
}

/** Every row the viewer may see that matches the filters (export; no page limit). */
export function exportAuditRows(db: Db, viewer: AuditViewer, filters: AuditFilters, deps: AuditSearchDeps): AuditRow[] {
  const conds = [scopeCondition(viewer), ...filterConditions(filters, deps)].filter((x): x is SQL => x !== undefined);
  return db
    .select()
    .from(aiAuditLog)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(aiAuditLog.createdAt), desc(aiAuditLog.id))
    .all();
}

/** "job RJ-26-0310", "card KC-091", "part AV-2231-07", "quote RQ-26-0911", "customer Aerovance" (view-time labels). */
export function recordLabels(db: Db, refs: readonly string[]): Map<string, string> {
  const byKind = new Map<string, string[]>();
  for (const r of refs) {
    const i = r.indexOf(":");
    if (i < 0) continue;
    const kind = r.slice(0, i);
    byKind.set(kind, [...(byKind.get(kind) ?? []), r.slice(i + 1)]);
  }
  const out = new Map<string, string>();
  const ids = (k: string) => [...new Set(byKind.get(k) ?? [])];
  if (ids("job").length) for (const j of db.select({ id: jobs.id, n: jobs.jobNumber }).from(jobs).where(inArray(jobs.id, ids("job"))).all()) out.set(`job:${j.id}`, `job ${j.n}`);
  if (ids("quote").length) for (const q of db.select({ id: quotes.id, n: quotes.quoteNumber }).from(quotes).where(inArray(quotes.id, ids("quote"))).all()) out.set(`quote:${q.id}`, `quote ${q.n}`);
  if (ids("part").length) for (const p of db.select({ id: parts.id, n: parts.partNumber }).from(parts).where(inArray(parts.id, ids("part"))).all()) out.set(`part:${p.id}`, `part ${p.n}`);
  if (ids("card").length) for (const c of db.select({ id: knowledgeCards.id, t: knowledgeCards.title }).from(knowledgeCards).where(inArray(knowledgeCards.id, ids("card"))).all()) out.set(`card:${c.id}`, `card ${c.id} · ${c.t}`);
  if (ids("customer").length) for (const c of db.select({ id: customers.id, n: customers.name }).from(customers).where(inArray(customers.id, ids("customer"))).all()) out.set(`customer:${c.id}`, `customer ${c.n}`);
  for (const r of refs) if (!out.has(r)) out.set(r, r.replace(":", " "));
  return out;
}

/** A label for a bare opaque ID in notice params ("J-A10" → "job RJ-26-0310"). */
export function labelForId(db: Db, id: string): string | null {
  const kind = /^J-/.test(id) ? "job" : /^Q-/.test(id) ? "quote" : /^PRT-/.test(id) ? "part" : /^KC-/.test(id) ? "card" : /^CUS-/.test(id) ? "customer" : null;
  if (!kind) return null;
  return recordLabels(db, [`${kind}:${id}`]).get(`${kind}:${id}`) ?? null;
}

function prettyJson(s: string | null): string | null {
  if (!s) return s;
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

export function auditRowDetail(db: Db, viewer: AuditViewer, id: number): AuditDetailVM | null {
  const scope = scopeCondition(viewer);
  const r = db
    .select()
    .from(aiAuditLog)
    .where(scope ? and(eq(aiAuditLog.id, id), scope) : eq(aiAuditLog.id, id))
    .get();
  if (!r) return null;
  const labels = personaLabels(db);
  const refs = [...r.recordsSent, ...r.recordsWithheld.map((w) => w.ref)];
  const recLabels = recordLabels(db, refs);
  const notice: Notice | null = r.noticeKey ? ({ key: r.noticeKey, params: r.noticeParams ?? {} } as Notice) : null;
  const rootId = r.parentId ?? r.id;
  const chain = db
    .select({ id: aiAuditLog.id })
    .from(aiAuditLog)
    .where(or(eq(aiAuditLog.id, rootId), eq(aiAuditLog.parentId, rootId)))
    .orderBy(aiAuditLog.id)
    .all()
    .map((x) => x.id);
  return {
    ...toRowVM(r, labels, viewer),
    completedAt: r.completedAt,
    parentId: r.parentId,
    attempt: r.attempt,
    model: r.model,
    servedModel: r.servedModel,
    endpointHost: r.endpointHost,
    region: r.region,
    crossRegion: r.crossRegion,
    isCloud: r.isCloud,
    transportLabel: TRANSPORT_LABEL[r.transport],
    cassetteProvenance: r.cassetteProvenance,
    classificationsIncluded: r.classificationsIncluded,
    recordsSent: r.recordsSent.map((ref) => ({ ref, label: recLabels.get(ref) ?? ref })),
    recordsWithheld: r.recordsWithheld.map((w) => ({ ref: w.ref, label: recLabels.get(w.ref) ?? w.ref, classification: w.classification, reason: w.reason })),
    notice: notice ? renderNotice(notice, { role: viewer.role, recordLabel: (rid) => labelForId(db, rid) }) : null,
    tokensUsed: r.tokensUsed,
    userInputRedacted: r.userInputRedacted,
    requestPayloadRedacted: prettyJson(r.requestPayloadRedacted),
    payloadHash: r.payloadHash,
    storedFormLabel: storedFormLabel(r.payloadStoredForm),
    responseRedacted: r.responseRedacted,
    promptVersion: r.promptVersion,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    latencyMs: r.latencyMs,
    ttftMs: r.ttftMs,
    stopReason: r.stopReason,
    errorCode: r.errorCode,
    citationsValid: r.citationsValid,
    citationsStripped: r.citationsStripped,
    policyVersion: r.policyVersion,
    appVersion: r.appVersion,
    retryChain: chain.length > 1 ? chain : [],
  };
}

/** The raw row for Reveal (scope is checked by the caller with canRevealRow). */
export function auditRowForReveal(db: Db, id: number): Pick<AuditRow, "id" | "tokensUsed" | "actorPersonaId" | "actorPersonId" | "maxClassification"> | null {
  return (
    db
      .select({
        id: aiAuditLog.id,
        tokensUsed: aiAuditLog.tokensUsed,
        actorPersonaId: aiAuditLog.actorPersonaId,
        actorPersonId: aiAuditLog.actorPersonId,
        maxClassification: aiAuditLog.maxClassification,
      })
      .from(aiAuditLog)
      .where(eq(aiAuditLog.id, id))
      .get() ?? null
  );
}
