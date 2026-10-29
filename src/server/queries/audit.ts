import "server-only";
import { connection } from "next/server";
import { createPatternTokenResolver } from "@/lib/audit/token-store";
import type { AuditFilters, AuditViewer } from "@/lib/audit/types";
import { auditRowDetail, listAuditRows, type AuditDetailVM, type AuditListVM } from "@/lib/data/audit";
import { cachedRedactionDictionary } from "@/lib/data/dictionary";
import { assertCan, requireActor, type Actor } from "@/server/actor";
import { getDb } from "@/server/db";

export function viewerOf(actor: Actor): AuditViewer {
  return { role: actor.role, personId: actor.personId, personaId: actor.personaId };
}

/** /audit list: owner sees every row, others their own (docs/AI-GATEWAY.md §7.3). */
export async function getAuditPage(filters: AuditFilters): Promise<AuditListVM> {
  await connection();
  const actor = await requireActor();
  assertCan(actor, "viewAudit");
  const db = getDb();
  return listAuditRows(db, viewerOf(actor), filters, { dict: cachedRedactionDictionary(db), patterns: createPatternTokenResolver(db) });
}

/** One audit row's detail, or null when it doesn't exist or isn't the viewer's to see. */
export async function getAuditDetail(id: number): Promise<AuditDetailVM | null> {
  await connection();
  const actor = await requireActor();
  assertCan(actor, "viewAudit");
  return auditRowDetail(getDb(), viewerOf(actor), id);
}
