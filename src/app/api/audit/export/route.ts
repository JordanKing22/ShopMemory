/**
 * POST /api/audit/export (PLAN.md §4.7): the rows the viewer can see (owner: all), as CSV or JSON. Filters travel in
 * the body (free text never goes in a URL). Payload columns are already redacted. Writes an audit_export event.
 */
import { AuditExportBodySchema } from "@/lib/audit/filters";
import { exportFileName, maxClassificationOf, toCsv, toJson } from "@/lib/audit/export";
import { writeEvent } from "@/lib/audit/events";
import { createPatternTokenResolver } from "@/lib/audit/token-store";
import { exportAuditRows } from "@/lib/data/audit";
import { cachedRedactionDictionary } from "@/lib/data/dictionary";
import { assertCan, requireActor } from "@/server/actor";
import { getDb } from "@/server/db";
import { viewerOf } from "@/server/queries/audit";
import { SafeError, withSafeErrors } from "@/server/safe";

const MAX_BODY = 16 * 1024;

export const POST = withSafeErrors(async (request: Request): Promise<Response> => {
  const actor = await requireActor();
  assertCan(actor, "exportAudit");
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new SafeError("invalid_request", "That request couldn't be read.");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new SafeError("invalid_request", "That request couldn't be read.");
  }
  const body = AuditExportBodySchema.safeParse(json);
  if (!body.success) throw new SafeError("invalid_request", "That request couldn't be read.");

  const db = getDb();
  const rows = exportAuditRows(db, viewerOf(actor), body.data.filters, {
    dict: cachedRedactionDictionary(db),
    patterns: createPatternTokenResolver(db),
  });
  const nowIso = new Date().toISOString();
  const maxClass = maxClassificationOf(rows);
  writeEvent(
    db,
    {
      kind: "audit_export",
      actor: { personaId: actor.personaId, personId: actor.personId, role: actor.role },
      subjectKind: "ai_audit_log",
      classification: maxClass === "empty" ? null : maxClass,
      details: { format: body.data.format, rowCount: rows.length, maxClassification: maxClass, includeEvents: false },
    },
    nowIso,
  );
  const format = body.data.format;
  return new Response(format === "csv" ? toCsv(rows) : toJson(rows), {
    status: 200,
    headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(maxClass, nowIso, format)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}, "audit_export");
