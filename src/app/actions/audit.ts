"use server";
/**
 * Reveal (PLAN.md §4.7): re-hydrates the tokens in ONE audit row's own tokens_used, for the viewer's role, at render
 * time. Nothing revealed is stored; the reveal itself is logged (counts only).
 */
import { z } from "zod";
import { writeEvent } from "@/lib/audit/events";
import { canRevealRow, revealRow } from "@/lib/audit/reveal";
import { lookupPatternToken } from "@/lib/audit/token-store";
import type { RevealResult } from "@/lib/audit/types";
import { auditRowForReveal } from "@/lib/data/audit";
import { cachedRedactionDictionary } from "@/lib/data/dictionary";
import { assertCan, requireActor } from "@/server/actor";
import { getDb } from "@/server/db";
import { viewerOf } from "@/server/queries/audit";
import { SafeError, withSafeErrors } from "@/server/safe";

const Id = z.number().int().positive().max(2 ** 31);

export const revealAuditRow = withSafeErrors(async (rowId: number): Promise<RevealResult> => {
  const actor = await requireActor();
  assertCan(actor, "revealAudit");
  const id = Id.safeParse(rowId);
  if (!id.success) throw new SafeError("invalid_request", "That request couldn't be read.");
  const db = getDb();
  const row = auditRowForReveal(db, id.data);
  const viewer = viewerOf(actor);
  if (!row || !canRevealRow(row, viewer)) throw new SafeError("forbidden", "You can reveal only your own audit rows in this demo.");
  const dict = cachedRedactionDictionary(db);
  const result = revealRow(row, viewer, (token) => {
    const entity = dict.entityTokens.get(token);
    if (entity) return { kind: entity.kind, value: entity.display };
    return lookupPatternToken(db, token);
  });
  writeEvent(
    db,
    {
      kind: "audit_reveal",
      actor: { personaId: actor.personaId, personId: actor.personId, role: actor.role },
      subjectKind: "ai_audit_log",
      subjectId: String(row.id),
      classification: row.maxClassification,
      details: { auditId: row.id, tokenCount: result.entries.length, revealedCount: result.entries.filter((e) => e.value !== null).length },
    },
    new Date().toISOString(),
  );
  return result;
}, "revealAuditRow");
