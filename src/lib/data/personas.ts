/**
 * Persona lookups (PLAN.md §4.8). Pure query functions over an explicit Db handle, no Next.js imports, so they
 * run under Vitest and tsx. The async wrappers for the app live in src/server/queries/personas.ts.
 *
 * These functions establish WHO the actor is, so unlike other data functions they take no actor. The role
 * always comes from the personas table, never from the cookie.
 */
import { and, asc, eq, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { people, personas } from "@/db/schema";
import type { Role } from "@/lib/auth/roles";

/** One entry in the header persona switcher. */
export interface PersonaOption {
  id: string;
  label: string;
  role: Role;
}

export interface PersonaWithRole {
  id: string;
  /** e.g. "Ray Delgado · Lead Quoter". */
  label: string;
  role: Role;
  /** people.id, or null for the persona-only owner. */
  personId: string | null;
  /** Short name: people.display_name ("Ray"), or the first name in the label for the owner ("Dana"). */
  displayName: string;
  /** people.full_name ("Ray Delgado"), or the name part of the label for the owner ("Dana Whitcomb"). */
  fullName: string;
}

/** "Dana Whitcomb · Owner/GM" → "Dana Whitcomb". */
export function labelNamePart(label: string): string {
  return label.split(" · ")[0].trim() || label.trim();
}

type Row = {
  id: string;
  label: string;
  role: Role;
  personId: string | null;
  personDisplayName: string | null;
  personFullName: string | null;
};

function toPersona(row: Row): PersonaWithRole {
  const namePart = labelNamePart(row.label);
  return {
    id: row.id,
    label: row.label,
    role: row.role,
    personId: row.personId,
    displayName: row.personDisplayName ?? (namePart.split(/\s+/)[0] || namePart),
    fullName: row.personFullName ?? namePart,
  };
}

function findOne(db: Db, where: SQL | undefined): PersonaWithRole | null {
  const row = db
    .select({
      id: personas.id,
      label: personas.label,
      role: personas.role,
      personId: personas.personId,
      personDisplayName: people.displayName,
      personFullName: people.fullName,
    })
    .from(personas)
    .leftJoin(people, eq(people.id, personas.personId))
    .where(where)
    .limit(1)
    .get();
  return row ? toPersona(row) : null;
}

/** Personas offered in the header switcher (show_in_switcher), in seed sort order. */
export function listSwitcherPersonas(db: Db): PersonaOption[] {
  return db
    .select({ id: personas.id, label: personas.label, role: personas.role })
    .from(personas)
    .where(eq(personas.showInSwitcher, true))
    .orderBy(asc(personas.sortOrder), asc(personas.id))
    .all();
}

/** Any persona by ID (null when unknown). The role returned is the DB's. */
export function getPersonaWithRole(db: Db, id: string): PersonaWithRole | null {
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return null;
  return findOne(db, eq(personas.id, id));
}

/** The default owner persona (is_default_for_role for role "owner", i.e. P-OWNER): the fallback actor. */
export function getDefaultOwnerPersona(db: Db): PersonaWithRole | null {
  return findOne(db, and(eq(personas.role, "owner"), eq(personas.isDefaultForRole, true)));
}

/** True when the persona exists and is offered in the switcher (what setPersona accepts in Phase 2). */
export function isSwitchablePersona(db: Db, id: string): boolean {
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return false;
  const row = db
    .select({ id: personas.id })
    .from(personas)
    .where(and(eq(personas.id, id), eq(personas.showInSwitcher, true)))
    .limit(1)
    .get();
  return row !== undefined;
}
