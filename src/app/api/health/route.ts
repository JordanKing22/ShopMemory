/**
 * GET /api/health (PLAN.md §4.11 preflight). The basic report needs no actor: configuration and cached health only,
 * never a network call, never a value. ?deep=1 probes the providers (no shop data: Anthropic models.retrieve, Ollama
 * /api/version + /api/show + /api/ps) and needs testAiConnection; in DEMO_MODE without live local nothing is probed.
 */
import { writeEvent } from "@/lib/audit/events";
import { getHealthReport } from "@/server/ai";
import { assertCan, requireActor } from "@/server/actor";
import { getDb } from "@/server/db";
import { withSafeErrors } from "@/server/safe";

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } as const;

export const GET = withSafeErrors(async (request: Request): Promise<Response> => {
  const deep = new URL(request.url).searchParams.get("deep") === "1";
  if (!deep) return new Response(JSON.stringify(await getHealthReport(false)), { status: 200, headers: HEADERS });
  const actor = await requireActor();
  assertCan(actor, "testAiConnection");
  const report = await getHealthReport(true);
  for (const p of report.providers) {
    writeEvent(
      getDb(),
      {
        kind: "health_check",
        actor: { personaId: actor.personaId, personId: actor.personId, role: actor.role },
        subjectKind: "provider",
        subjectId: p.kind,
        details: { providerKind: p.kind, deep: true, warm: false, status: p.status },
      },
      report.checkedAt,
    );
  }
  return new Response(JSON.stringify(report), { status: 200, headers: HEADERS });
}, "api_health");
