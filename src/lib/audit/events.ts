/**
 * event_log writer (PLAN.md §4.7): consent, persona switches, settings changes, exports, reveals, resets, health
 * checks… details_json holds IDs, enums, counts and booleans only — never payloads, names or transcript text, so this
 * writer refuses any string that doesn't look like an identifier (a programming error, reported without the value).
 */
import type { Db } from "@/db/client";
import { eventLog } from "@/db/schema";
import type { EventInput } from "./types";

const SAFE_STRING = /^[A-Za-z0-9_.:,|/-]{0,64}$/;

export class UnsafeEventDetailsError extends Error {
  constructor() {
    super("Event details may hold only IDs, enums, counts and booleans.");
    this.name = "UnsafeEventDetailsError";
  }
}

export function assertSafeDetails(details: EventInput["details"]): void {
  for (const v of Object.values(details ?? {})) {
    if (typeof v === "string" && !SAFE_STRING.test(v)) throw new UnsafeEventDetailsError();
    if (typeof v === "number" && !Number.isFinite(v)) throw new UnsafeEventDetailsError();
  }
}

export function writeEvent(db: Db, input: EventInput, nowIso: string): number {
  assertSafeDetails(input.details);
  for (const v of [input.subjectKind, input.subjectId]) {
    if (typeof v === "string" && !SAFE_STRING.test(v)) throw new UnsafeEventDetailsError();
  }
  return db
    .insert(eventLog)
    .values({
      createdAt: nowIso,
      actorPersonId: input.actor?.personId ?? null,
      actorPersonaId: input.actor?.personaId ?? null,
      actorRole: input.actor?.role ?? null,
      kind: input.kind,
      subjectKind: input.subjectKind ?? null,
      subjectId: input.subjectId ?? null,
      classification: input.classification ?? null,
      detailsJson: input.details ?? null,
    })
    .returning({ id: eventLog.id })
    .get().id;
}
