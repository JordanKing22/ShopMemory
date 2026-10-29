/**
 * P1 — role projection for the model (PLAN.md §4.2 P1, §4.8; docs/AI-GATEWAY.md §10.3). Records reach a prompt builder
 * only as LlmProjection<T>: an explicit allowlist of columns. Pricing fields, customer contacts and commercial terms
 * are NEVER selected (not for any role); win/loss and quoter notes only for roles that may see win/loss; departure data
 * never. Records the role can't see (or unapproved cards) are dropped silently, so their existence isn't revealed.
 * The `title` returned beside a projection is for the viewer's own UI (source chips); it is never sent or stored.
 */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { customers, jobs, knowledgeCards, materials, parts, quotes, type Classification, type Role } from "@/db/schema";
import { canSee } from "@/lib/auth/roles";
import type { RecordRef } from "./types";

export type LlmProjection<T> = T & { readonly __llm: true };

export interface LoadedRecord {
  ref: RecordRef;
  classification: Classification;
  /** Viewer-facing label (never sent to a model, never stored in the audit). */
  title: string;
  projection: LlmProjection<Record<string, unknown>>;
}

/** Field names that must never appear in any projection (tests/ai-projection.test.ts asserts it for every role). */
export const NEVER_PROJECTED = [
  "shopRateUsdPerHr",
  "materialCostUsd",
  "outsideProcessingUsd",
  "riskAdderHours",
  "scrapAllowancePct",
  "unitPriceUsd",
  "totalPriceUsd",
  "targetMarginPct",
  "contactName",
  "contactEmail",
  "paymentTerms",
  "annualSpendUsd",
  "pricingNotesMd",
  "plannedDepartureDate",
  "departureKind",
] as const;

const llm = <T extends Record<string, unknown>>(v: T) => v as LlmProjection<T>;

function materialNames(db: Db, ids: string[]): Map<string, string> {
  if (ids.length === 0) return new Map();
  return new Map(db.select({ id: materials.id, name: materials.name }).from(materials).where(inArray(materials.id, ids)).all().map((m) => [m.id, m.name]));
}

function customerNames(db: Db, ids: string[]): Map<string, string> {
  if (ids.length === 0) return new Map();
  return new Map(db.select({ id: customers.id, name: customers.name }).from(customers).where(inArray(customers.id, ids)).all().map((c) => [c.id, c.name]));
}

function loadOne(db: Db, role: Role, ref: RecordRef): LoadedRecord | null {
  const winLoss = canSee(role, "winLoss");
  if (ref.kind === "card") {
    const c = db.select().from(knowledgeCards).where(eq(knowledgeCards.id, ref.id)).get();
    if (!c || c.status !== "approved") return null;
    return {
      ref,
      classification: c.classification,
      title: `${c.id} · ${c.title}`,
      projection: llm({
        type: c.type,
        title: c.title,
        statement: c.statement,
        rationale: c.rationale,
        commonMistake: c.commonMistake,
        appliesWhen: c.appliesWhen,
        doesNotApplyWhen: c.doesNotApplyWhen,
        cues: c.cues,
        actions: c.actions,
        thresholds: c.thresholds,
        expertConfidence: c.expertConfidence,
      }),
    };
  }
  if (ref.kind === "part") {
    const p = db.select().from(parts).where(eq(parts.id, ref.id)).get();
    if (!p) return null;
    const mat = materialNames(db, [p.materialId]).get(p.materialId) ?? null;
    const cust = p.customerId ? (customerNames(db, [p.customerId]).get(p.customerId) ?? null) : null;
    return {
      ref,
      classification: p.classification,
      title: `${p.partNumber} · ${p.description}`,
      projection: llm({
        partNumber: p.partNumber,
        revision: p.revision,
        description: p.description,
        family: p.family,
        material: mat,
        customer: cust,
        features: p.features,
        minWallIn: p.minWallIn,
        maxWallHeightIn: p.maxWallHeightIn,
        tightestTolIn: p.tightestTolIn,
        complexity: p.complexity,
      }),
    };
  }
  if (ref.kind === "quote") {
    const q = db.select().from(quotes).where(eq(quotes.id, ref.id)).get();
    if (!q) return null;
    const p = db.select().from(parts).where(eq(parts.id, q.partId)).get();
    const cust = customerNames(db, [q.customerId]).get(q.customerId) ?? null;
    return {
      ref,
      classification: q.classification,
      title: `${q.quoteNumber}${p ? ` · ${p.partNumber}` : ""}`,
      projection: llm({
        quoteNumber: q.quoteNumber,
        partNumber: p?.partNumber ?? null,
        customer: cust,
        quotedOn: q.quotedOn,
        qty: q.qty,
        quotedSetupHours: q.quotedSetupHours,
        quotedCycleMinutes: q.quotedCycleMinutes,
        quotedHours: q.quotedHours,
        leadTimeDays: q.leadTimeDays,
        judgmentDrivers: q.judgmentDrivers,
        ...(winLoss ? { outcome: q.outcome, lostReason: q.lostReason, quoterNotes: q.quoterNotesMd } : {}),
      }),
    };
  }
  if (ref.kind === "job") {
    const j = db.select().from(jobs).where(eq(jobs.id, ref.id)).get();
    if (!j) return null;
    const p = db.select().from(parts).where(eq(parts.id, j.partId)).get();
    const q = j.quoteId ? db.select({ quotedHours: quotes.quotedHours }).from(quotes).where(eq(quotes.id, j.quoteId)).get() : undefined;
    const cust = p?.customerId ? (customerNames(db, [p.customerId]).get(p.customerId) ?? null) : null;
    const mat = p ? (materialNames(db, [p.materialId]).get(p.materialId) ?? null) : null;
    return {
      ref,
      classification: j.classification,
      title: `${j.jobNumber}${p ? ` · ${p.description}` : ""}`,
      projection: llm({
        jobNumber: j.jobNumber,
        partNumber: p?.partNumber ?? null,
        partDescription: p?.description ?? null,
        material: mat,
        customer: cust,
        status: j.status,
        startedOn: j.startedOn,
        shippedOn: j.shippedOn,
        quotedHours: q?.quotedHours ?? null,
        actualHours: j.actualHours,
        variancePct: j.variancePct,
        scrapQty: j.scrapQty,
        ncrCount: j.ncrCount,
        onTime: j.onTime,
        debrief: j.debriefMd,
      }),
    };
  }
  if (ref.kind === "customer") {
    const c = db.select().from(customers).where(eq(customers.id, ref.id)).get();
    if (!c) return null;
    return {
      ref,
      classification: c.classification,
      title: c.name,
      projection: llm({ name: c.name, industry: c.industry, segment: c.segment, qualityRequirements: c.qualityRequirementsMd }),
    };
  }
  return null;
}

/**
 * Loads records for a prompt, in order, dropping unknown, invisible and duplicate references silently. Every persona
 * may open every record in this demo (PLAN.md §4.8), so visibility here is about record state (approved cards only)
 * and field gates; a real deployment adds per-person export access (PLAN.md §15).
 */
export function loadRecordsForLlm(db: Db, role: Role, refs: readonly RecordRef[]): LoadedRecord[] {
  const seen = new Set<string>();
  const out: LoadedRecord[] = [];
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = loadOne(db, role, ref);
    if (r) out.push(r);
  }
  return out;
}
