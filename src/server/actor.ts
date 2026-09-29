import "server-only";
/**
 * Who is acting (PLAN.md §4.8). The signed fw_persona cookie carries only a persona ID; the role, person and label
 * always come from the DB (via src/lib/data/personas.ts). The HMAC key is 32 random bytes created lazily per server
 * boot and kept on globalThis (surviving dev HMR). It is never persisted or logged, so a restart simply returns
 * everyone to the default owner.
 */
import { randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { getEnv } from "@/lib/env";
import { can, type Capability, type Role } from "@/lib/auth/roles";
import { PERSONA_COOKIE, signPersona, verifyPersona } from "@/lib/auth/persona-cookie";
import type { PersonaWithRole } from "@/lib/data/personas";
import { getDefaultOwnerPersona, getPersonaWithRole } from "@/server/queries/personas";
import { SafeError } from "@/server/safe";

export { listPersonas, isSwitchablePersona, type PersonaOption } from "@/server/queries/personas";

export interface Actor {
  personaId: string;
  personId: string | null;
  role: Role;
  label: string;
  displayName: string;
}

const g = globalThis as typeof globalThis & { __floorwisePersonaSecret?: Buffer };

function personaSecret(): Buffer {
  if (!g.__floorwisePersonaSecret) g.__floorwisePersonaSecret = randomBytes(32);
  return g.__floorwisePersonaSecret;
}

/** Cookie value for a persona, signed with this boot's secret. Used by the setPersona Server Action. */
export function signPersonaCookie(personaId: string): string {
  return signPersona(personaId, personaSecret());
}

function toActor(p: PersonaWithRole): Actor {
  return { personaId: p.id, personId: p.personId, role: p.role, label: p.label, displayName: p.displayName };
}

/** Memoized per request (React cache), so layout, page and queries share one lookup. */
export const getActor = cache(async (): Promise<Actor> => {
  await connection();
  const store = await cookies();
  const raw = store.get(PERSONA_COOKIE)?.value;
  const personaId = raw ? verifyPersona(raw, personaSecret()) : null;

  if (personaId) {
    const persona = getPersonaWithRole(personaId);
    if (persona) return toActor(persona);
  }

  const fallback = getDefaultOwnerPersona();
  if (!fallback) throw new SafeError("no_default_persona", "The demo data is missing its default owner persona. Run npm run seed.");
  return toActor(fallback);
});

export const requireActor = getActor;

export function assertCan(actor: Pick<Actor, "role">, cap: Capability): void {
  if (!can(actor.role, cap, { demoOpenControls: getEnv().DEMO_OPEN_CONTROLS })) {
    throw new SafeError("forbidden", "Your role can't do that in this demo.");
  }
}
