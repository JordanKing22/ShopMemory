/**
 * ai_audit_log writer (PLAN.md §4.7, docs/AI-GATEWAY.md §7.1–§7.2). Synchronous (better-sqlite3).
 *
 * - writeAhead (R1): a call that will reach a transport is inserted with outcome "pending" and completed_at null.
 * - finalize (R5): ONE update of that row (WHERE completed_at IS NULL); the ai_audit_log_immutable trigger aborts any
 *   later update. Returns false when the row is gone (Reset happened mid-stream) or already complete.
 * - writeComplete: blocked / held decisions: one finished row, transport "none", nothing sent.
 *
 * Only REDACTED text, IDs and enums reach these columns (CLAUDE.md hard rule 2); the caller redacts first.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { aiAuditLog } from "@/db/schema";
import type { AuditCompleteInput, AuditFinalizeInput, AuditInsert, AuditTargetFields, AuditWriteAheadInput } from "./types";

function targetColumns(t: AuditTargetFields | null): Partial<AuditInsert> {
  if (!t) return { providerKind: null, targetClass: null, model: null, endpointHost: null, region: null, crossRegion: null, isCloud: null };
  return {
    providerKind: t.providerKind,
    targetClass: t.targetClass,
    model: t.model,
    endpointHost: t.endpointHost,
    region: t.region,
    crossRegion: t.crossRegion,
    isCloud: t.isCloud,
  };
}

function baseColumns(input: AuditWriteAheadInput | AuditCompleteInput): AuditInsert {
  return {
    createdAt: input.createdAt,
    requestId: input.requestId,
    actorPersonId: input.actor.personId,
    actorPersonaId: input.actor.personaId,
    actorRole: input.actor.role,
    feature: input.feature,
    task: input.task,
    mode: input.mode,
    decision: input.decision,
    transport: "none",
    maxClassification: input.maxClassification,
    classificationsIncluded: input.classificationsIncluded,
    recordsSent: [],
    recordsWithheld: input.recordsWithheld,
    noticeKey: input.notice?.key ?? null,
    noticeParams: input.notice?.params ?? null,
    redactionTokenCount: input.tokensUsed.length,
    tokensUsed: input.tokensUsed,
    userInputRedacted: input.userInputRedacted,
    promptVersion: input.promptVersion,
    outcome: "pending",
    policyVersion: input.policyVersion,
    appVersion: input.appVersion,
    demoEpoch: input.demoEpoch,
  };
}

export function writeAhead(db: Db, input: AuditWriteAheadInput): number {
  const row: AuditInsert = {
    ...baseColumns(input),
    ...targetColumns(input.target),
    parentId: input.parentId ?? null,
    attempt: input.attempt ?? 1,
    transport: input.transport,
    cassetteProvenance: input.cassetteProvenance,
    recordsSent: input.recordsSent,
    requestPayloadRedacted: input.requestPayloadRedacted,
    payloadHash: input.payloadHash,
    payloadStoredForm: input.payloadStoredForm,
    outcome: "pending",
    completedAt: null,
  };
  return db.insert(aiAuditLog).values(row).returning({ id: aiAuditLog.id }).get().id;
}

export function finalize(db: Db, id: number, input: AuditFinalizeInput): boolean {
  const set: Partial<AuditInsert> = {
    completedAt: input.completedAt,
    outcome: input.outcome,
    servedModel: input.servedModel,
    responseRedacted: input.responseRedacted,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    latencyMs: input.latencyMs === null ? null : Math.round(input.latencyMs),
    ttftMs: input.ttftMs === null ? null : Math.round(input.ttftMs),
    stopReason: input.stopReason,
    errorCode: input.errorCode,
    citationsValid: input.citationsValid,
    citationsStripped: input.citationsStripped,
  };
  if (input.tokensUsed) {
    set.tokensUsed = input.tokensUsed;
    set.redactionTokenCount = input.tokensUsed.length;
  }
  const r = db
    .update(aiAuditLog)
    .set(set)
    .where(and(eq(aiAuditLog.id, id), isNull(aiAuditLog.completedAt)))
    .run();
  return r.changes === 1;
}

export function writeComplete(db: Db, input: AuditCompleteInput): number {
  const row: AuditInsert = {
    ...baseColumns(input),
    ...targetColumns(input.target),
    transport: "none",
    outcome: input.decision,
    completedAt: input.createdAt,
    latencyMs: 0,
    citationsValid: 0,
    citationsStripped: 0,
  };
  return db.insert(aiAuditLog).values(row).returning({ id: aiAuditLog.id }).get().id;
}
