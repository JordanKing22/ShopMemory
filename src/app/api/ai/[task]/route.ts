/**
 * POST /api/ai/[task] (PLAN.md §4.2, docs/AI-GATEWAY.md §10.4, §14): every AI surface calls this. Returns the
 * runAI() events as NDJSON; a client disconnect (request.signal) aborts the provider call. User text arrives only in
 * the body; the actor comes from the signed persona cookie, never the client.
 */
import { AIError } from "@/lib/ai/errors";
import { ndjsonResponse } from "@/lib/ai/ndjson";
import { AIRequestBodySchema, readJsonBody } from "@/lib/ai/request-schema";
import { TASK_NAMES, type TaskName } from "@/lib/ai/types";
import { runAI } from "@/server/ai";
import { assertCan, requireActor } from "@/server/actor";
import { withSafeErrors } from "@/server/safe";

export const POST = withSafeErrors(async (request: Request, ctx: RouteContext<"/api/ai/[task]">): Promise<Response> => {
  const actor = await requireActor();
  assertCan(actor, "useAi");
  const { task } = await ctx.params;
  if (!(TASK_NAMES as readonly string[]).includes(task)) return errorResponse(new AIError("task_unknown"));
  const body = AIRequestBodySchema.safeParse(await readJsonBody(request));
  if (!body.success) return errorResponse(new AIError("invalid_request"));
  const run = runAI(
    { ...body.data, task: task as TaskName, actor: { personaId: actor.personaId, personId: actor.personId, role: actor.role } },
    { signal: request.signal },
  );
  return ndjsonResponse(run.events);
}, "api_ai_task");

function errorResponse(e: AIError): Response {
  return new Response(`${JSON.stringify({ t: "error", ...e.toJSON() })}\n`, {
    status: e.status,
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
