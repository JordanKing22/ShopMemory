/**
 * zod schema for /audit filters (URL search params on the page, POST body of the export). Unknown values are dropped,
 * never echoed. Pure.
 */
import { z } from "zod";
import { AI_MODES, AUDIT_DECISIONS, AUDIT_OUTCOMES, CLASSIFICATIONS, PROVIDER_KINDS, ROLES } from "@/db/schema/enums";
import { FEATURES } from "@/lib/ai/types";
import { AUDIT_EXPORT_FORMATS, AUDIT_REPLAY_FILTERS, type AuditFilters } from "./types";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/);

export const AuditFiltersSchema = z
  .object({
    from: date.optional(),
    to: date.optional(),
    personaId: id.optional(),
    role: z.enum(ROLES).optional(),
    feature: z.enum(FEATURES).optional(),
    providerKind: z.enum(PROVIDER_KINDS).optional(),
    model: z.string().max(200).optional(),
    mode: z.enum(AI_MODES).optional(),
    decision: z.enum(AUDIT_DECISIONS).optional(),
    classification: z.enum(CLASSIFICATIONS).optional(),
    replay: z.enum(AUDIT_REPLAY_FILTERS).optional(),
    outcome: z.enum(AUDIT_OUTCOMES).optional(),
    q: z.string().max(200).optional(),
    includeEvents: z.boolean().optional(),
  })
  .strict();

export const AuditExportBodySchema = z
  .object({ format: z.enum(AUDIT_EXPORT_FORMATS), filters: AuditFiltersSchema.default({}) })
  .strict();

/** Search params → filters: each key validated on its own; an invalid value is ignored. */
export function filtersFromSearchParams(sp: Readonly<Record<string, string | string[] | undefined>>): AuditFilters {
  const out: Record<string, unknown> = {};
  const shape = AuditFiltersSchema.shape;
  for (const [k, schema] of Object.entries(shape)) {
    const raw = sp[k];
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (v === undefined || v === "") continue;
    const value = k === "includeEvents" ? v === "1" || v === "true" : v;
    const parsed = (schema as z.ZodType).safeParse(value);
    if (parsed.success) out[k] = parsed.data;
  }
  return out as AuditFilters;
}
