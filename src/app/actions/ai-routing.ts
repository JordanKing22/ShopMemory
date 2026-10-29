"use server";
/**
 * setAiRouting (PLAN.md §4.11): the in-app mode + cloud-provider setting. Precedence stays in src/lib/policy/summary.ts:
 * AI_SETTINGS_LOCKED=true ignores it. Options whose configuration is missing are refused with the reason (names of
 * settings, never values). Logged to event_log; Reset demo clears it.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { appSettings } from "@/db/schema";
import { writeEvent } from "@/lib/audit/events";
import { getEnv } from "@/lib/env";
import { readAiRoutingSetting } from "@/lib/ai/routing";
import { resolveEffectiveRouting, routingOptionAvailability } from "@/lib/policy/summary";
import { AI_ROUTING_SETTING_KEY, type EffectiveRouting } from "@/lib/policy/types";
import { assertCan, requireActor } from "@/server/actor";
import { getDb } from "@/server/db";
import { SafeError, withSafeErrors } from "@/server/safe";

const Input = z.object({ mode: z.enum(["cloud", "local", "hybrid"]), cloudProvider: z.enum(["anthropic", "bedrock"]) }).strict();

export type SetAiRoutingResult = { ok: true; routing: EffectiveRouting } | { ok: false; reason: string };

export const setAiRouting = withSafeErrors(async (input: unknown): Promise<SetAiRoutingResult> => {
  const actor = await requireActor();
  assertCan(actor, "changeAiRouting");
  const parsed = Input.safeParse(input);
  if (!parsed.success) throw new SafeError("invalid_request", "That setting couldn't be read.");
  const env = getEnv();
  const options = routingOptionAvailability(env);
  const mode = options.modes[parsed.data.mode];
  if (!mode.enabled) return { ok: false, reason: mode.reason ?? "That mode isn't available." };
  if (parsed.data.mode !== "local") {
    const provider = options.cloudProviders[parsed.data.cloudProvider];
    if (!provider.enabled) return { ok: false, reason: provider.reason ?? "That provider isn't available." };
  }
  const db = getDb();
  const previous = resolveEffectiveRouting(env, readAiRoutingSetting(db));
  const nowIso = new Date().toISOString();
  db.$client.transaction(() => {
    db.insert(appSettings)
      .values({ key: AI_ROUTING_SETTING_KEY, value: parsed.data, updatedAt: nowIso, updatedByPersonaId: actor.personaId })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: parsed.data, updatedAt: nowIso, updatedByPersonaId: actor.personaId } })
      .run();
    writeEvent(
      db,
      {
        kind: "settings_change",
        actor: { personaId: actor.personaId, personId: actor.personId, role: actor.role },
        subjectKind: "app_setting",
        subjectId: AI_ROUTING_SETTING_KEY,
        details: {
          mode: parsed.data.mode,
          cloudProvider: parsed.data.cloudProvider,
          previousMode: previous.mode,
          previousCloudProvider: previous.cloudProvider,
        },
      },
      nowIso,
    );
  })();
  revalidatePath("/", "layout");
  return { ok: true, routing: resolveEffectiveRouting(env, parsed.data) };
}, "setAiRouting");
