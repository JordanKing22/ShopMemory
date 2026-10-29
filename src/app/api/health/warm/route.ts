/**
 * POST /api/health/warm (PLAN.md §4.11): pre-loads the local model with the identical options, so the first local
 * answer doesn't pay the load time. A no-op (health: null) unless the effective mode uses a live Ollama.
 */
import { writeEvent } from "@/lib/audit/events";
import { warmLocalModel } from "@/server/ai";
import { assertCan, requireActor } from "@/server/actor";
import { getDb } from "@/server/db";
import { withSafeErrors } from "@/server/safe";

export const POST = withSafeErrors(async (): Promise<Response> => {
  const actor = await requireActor();
  assertCan(actor, "testAiConnection");
  const health = await warmLocalModel();
  if (health) {
    writeEvent(
      getDb(),
      {
        kind: "health_check",
        actor: { personaId: actor.personaId, personId: actor.personId, role: actor.role },
        subjectKind: "provider",
        subjectId: "ollama",
        details: { providerKind: "ollama", deep: true, warm: true, status: health.status },
      },
      health.checkedAt ?? new Date().toISOString(),
    );
  }
  return new Response(JSON.stringify({ ok: health === null || health.status === "ready", health }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}, "api_health_warm");
