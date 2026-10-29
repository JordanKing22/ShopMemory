/**
 * POST /api/ai/preview: "What will be sent" (PLAN.md §4.6) — the same runAI() as a real call, as a dry run (P0–P8),
 * so the preview is byte-identical to what would be sent. Nothing is sent, persisted or audited. (UI in Phase 7.)
 */
import { AIError, toAIError } from "@/lib/ai/errors";
import { PreviewBodySchema, readJsonBody } from "@/lib/ai/request-schema";
import { runAI } from "@/server/ai";
import { assertCan, requireActor } from "@/server/actor";
import { withSafeErrors } from "@/server/safe";

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" } as const;

export const POST = withSafeErrors(async (request: Request): Promise<Response> => {
  const actor = await requireActor();
  assertCan(actor, "useAi");
  const body = PreviewBodySchema.safeParse(await readJsonBody(request));
  if (!body.success) return error(new AIError("invalid_request"));
  const { task, ...rest } = body.data;
  try {
    const preview = await runAI({ ...rest, task, actor: { personaId: actor.personaId, personId: actor.personId, role: actor.role } }, { dryRun: true });
    return new Response(JSON.stringify(preview), { status: 200, headers: HEADERS });
  } catch (err) {
    return error(toAIError(err));
  }
}, "api_ai_preview");

function error(e: AIError): Response {
  return new Response(JSON.stringify({ error: e.toJSON() }), { status: e.status, headers: HEADERS });
}
