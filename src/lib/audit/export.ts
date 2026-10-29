/**
 * Audit export (PLAN.md §4.7): CSV with a formula-injection guard, or JSON. Every column except tenant_id; payload
 * columns are already redacted. The file name carries the highest classification included. Pure.
 */
import { CLASS_RANK, type Classification } from "@/db/schema/enums";
import type { AuditExportFormat, AuditRow } from "./types";

export const EXPORT_COLUMNS = [
  "id",
  "createdAt",
  "completedAt",
  "requestId",
  "parentId",
  "attempt",
  "actorPersonId",
  "actorPersonaId",
  "actorRole",
  "feature",
  "task",
  "mode",
  "decision",
  "providerKind",
  "targetClass",
  "model",
  "servedModel",
  "endpointHost",
  "region",
  "crossRegion",
  "isCloud",
  "transport",
  "cassetteProvenance",
  "maxClassification",
  "classificationsIncluded",
  "recordsSent",
  "recordsWithheld",
  "noticeKey",
  "noticeParams",
  "redactionTokenCount",
  "tokensUsed",
  "userInputRedacted",
  "requestPayloadRedacted",
  "payloadHash",
  "payloadStoredForm",
  "responseRedacted",
  "promptVersion",
  "inputTokens",
  "outputTokens",
  "latencyMs",
  "ttftMs",
  "stopReason",
  "outcome",
  "errorCode",
  "citationsValid",
  "citationsStripped",
  "policyVersion",
  "appVersion",
  "demoEpoch",
] as const satisfies readonly (keyof AuditRow)[];

/** snake_case header names, matching the database columns. */
const header = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Cells a spreadsheet would treat as a formula get a leading apostrophe. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (typeof value === "string") {
    s = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  } else if (typeof value === "number" || typeof value === "boolean") {
    s = String(value);
  } else {
    s = JSON.stringify(value);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: readonly AuditRow[]): string {
  const lines = [EXPORT_COLUMNS.map(header).join(",")];
  for (const r of rows) lines.push(EXPORT_COLUMNS.map((c) => csvCell(r[c])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

export function toJson(rows: readonly AuditRow[]): string {
  return `${JSON.stringify(
    rows.map((r) => Object.fromEntries(EXPORT_COLUMNS.map((c) => [header(c), r[c] ?? null]))),
    null,
    2,
  )}\n`;
}

export function maxClassificationOf(rows: readonly Pick<AuditRow, "maxClassification">[]): Classification | "empty" {
  let best: Classification | null = null;
  for (const r of rows) {
    const c = r.maxClassification;
    if (c && (best === null || CLASS_RANK[c] > CLASS_RANK[best])) best = c;
  }
  return best ?? "empty";
}

/** floorwise-audit-<classification>-<YYYYMMDD>.<csv|json> (UTC date of the injected clock). */
export function exportFileName(maxClassification: Classification | "empty", nowIso: string, format: AuditExportFormat): string {
  const date = nowIso.slice(0, 10).replace(/-/g, "");
  return `floorwise-audit-${maxClassification.replace(/_/g, "-")}-${date}.${format}`;
}
