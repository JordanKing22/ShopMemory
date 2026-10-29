/**
 * POST body of /api/ai/[task] and /api/ai/preview (docs/AI-GATEWAY.md §10.3). Unknown keys are rejected; user text
 * travels only here, never in a URL. Record references only — never bodies or classifications.
 */
import { z } from "zod";
import { FEATURES, TASK_NAMES } from "./types";

export const MAX_BODY_BYTES = 64 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const RECORD_KINDS = [
  "card",
  "job",
  "quote",
  "part",
  "customer",
  "machine",
  "material",
  "person",
  "document",
  "interview",
  "quote_log",
  "ask_thread",
  "quiz",
] as const;

export const AIRequestBodySchema = z
  .object({
    feature: z.enum(FEATURES),
    input: z
      .object({
        text: z.string().max(4000).optional(),
        turns: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) }).strict()).max(40).optional(),
      })
      .strict()
      .optional(),
    pinned: z.array(z.object({ kind: z.enum(RECORD_KINDS), id: z.string().regex(ID) }).strict()).max(10).optional(),
    retrievalQuery: z.string().max(4000).optional(),
    sessionId: z.string().regex(ID).optional(),
    threadId: z.string().regex(ID).optional(),
    consentId: z.string().regex(ID).optional(),
    excludeAboveClearance: z.boolean().optional(),
    confirmNotControlled: z.boolean().optional(),
    previewToken: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    scenarioHint: z.string().regex(/^[a-z0-9_.-]{1,64}$/).optional(),
  })
  .strict();

export const PreviewBodySchema = AIRequestBodySchema.extend({ task: z.enum(TASK_NAMES) }).strict();

/** Reads and parses a JSON body with a size cap. Returns null on anything invalid (the caller answers invalid_request). */
export async function readJsonBody(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null; // the parse error can echo input: discarded
  }
}
