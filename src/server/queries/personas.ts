import "server-only";
/**
 * Server wrappers for persona lookups (src/lib/data/personas.ts). Used by src/server/actor.ts to resolve the
 * actor, by the header persona switcher, and by the setPersona Server Action.
 *
 * The actor lookups are synchronous and skip connection(): getActor() already awaits cookies(), which makes the
 * render dynamic. listPersonas() awaits connection() first so a layout that only lists personas never
 * prerenders seed data.
 */
import { connection } from "next/server";
import {
  getDefaultOwnerPersona as getDefaultOwnerPersonaFrom,
  getPersonaWithRole as getPersonaWithRoleFrom,
  isSwitchablePersona as isSwitchablePersonaFrom,
  listSwitcherPersonas,
  type PersonaOption,
  type PersonaWithRole,
} from "@/lib/data/personas";
import { getDb } from "@/server/db";

export type { PersonaOption, PersonaWithRole };

/** Personas for the header switcher (show_in_switcher, seed order). */
export async function listPersonas(): Promise<PersonaOption[]> {
  await connection();
  return listSwitcherPersonas(getDb());
}

/** A persona and its role, read from the DB (never from the cookie). Null when unknown. */
export function getPersonaWithRole(id: string): PersonaWithRole | null {
  return getPersonaWithRoleFrom(getDb(), id);
}

/** The fallback actor: the default owner persona (P-OWNER). Null only if the demo data is missing. */
export function getDefaultOwnerPersona(): PersonaWithRole | null {
  return getDefaultOwnerPersonaFrom(getDb());
}

/** True when setPersona may switch to this persona. */
export function isSwitchablePersona(id: string): boolean {
  return isSwitchablePersonaFrom(getDb(), id);
}
