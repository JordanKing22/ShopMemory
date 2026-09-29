/**
 * Role rules (PLAN.md §4.8). Pure: no DB, no env, no Next.js. The server decides the actor's role from the DB
 * (src/server/actor.ts); this module only answers "may this role see / do X?".
 *
 * Phase 2 covers the field gates that read-only screens need (prices, win/loss, contacts, departure) plus the
 * capabilities the shell shows. Phase 7 completes the full matrix (approvals, interviews, audit Reveal).
 */
import { ROLES, type Role } from "@/db/schema/enums";

export { ROLES };
export type { Role };

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  quoter: "Quoter",
  machinist: "Machinist",
  trainee: "Trainee",
};

/**
 * Fields hidden from some roles. Values of a hidden field must never reach the client (see src/lib/data/gate.ts).
 * - prices: prices, unit price, margins, shop rates, material cost, risk adders (never sent to any model either)
 * - winLoss: win/loss outcome and loss reason
 * - contacts: customer contacts and commercial terms (never sent to any model either)
 * - departure: planned departure dates, the departure factor in risk explanations, the "departing within 24 months" KPI
 */
export const GATED_FIELDS = ["prices", "winLoss", "contacts", "departure"] as const;
export type GatedField = (typeof GATED_FIELDS)[number];

const FIELD_VISIBILITY: Record<GatedField, Record<Role, boolean>> = {
  prices: { owner: true, quoter: true, machinist: false, trainee: false },
  winLoss: { owner: true, quoter: true, machinist: false, trainee: false },
  contacts: { owner: true, quoter: true, machinist: false, trainee: false },
  departure: { owner: true, quoter: true, machinist: false, trainee: false },
};

/** Unknown roles or fields see nothing (fail closed). */
export function canSee(role: Role, field: GatedField): boolean {
  return FIELD_VISIBILITY[field]?.[role] === true;
}

/** Copy for the visible pill that replaces a hidden value, e.g. "Hidden for Machinist role". */
export function hiddenLabel(role: Role): string {
  return `Hidden for ${ROLE_LABEL[role]} role`;
}

export const CAPABILITIES = [
  "viewAll",
  "switchPersona",
  "changeAiRouting",
  "resetDemo",
  "fullExport",
  "fullDelete",
  "generateDocuments",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export interface CanOptions {
  /** DEMO_OPEN_CONTROLS=true: any persona may change AI routing and reset the demo (PLAN.md §4.8). */
  demoOpenControls?: boolean;
}

/** Base matrix without demo overrides. */
const CAPABILITY_MATRIX: Record<Capability, Record<Role, boolean>> = {
  // Audit log: the owner sees every row; other roles see their own rows only.
  viewAll: { owner: true, quoter: false, machinist: false, trainee: false },
  // The demo persona switcher must work for every persona, or the presenter could not switch back.
  switchPersona: { owner: true, quoter: true, machinist: true, trainee: true },
  changeAiRouting: { owner: true, quoter: false, machinist: false, trainee: false },
  resetDemo: { owner: true, quoter: false, machinist: false, trainee: false },
  fullExport: { owner: true, quoter: false, machinist: false, trainee: false },
  fullDelete: { owner: true, quoter: false, machinist: false, trainee: false },
  generateDocuments: { owner: true, quoter: true, machinist: true, trainee: false },
};

/** Capabilities that DEMO_OPEN_CONTROLS opens to every persona. Full export/delete never open up. */
const OPEN_CONTROLS: ReadonlySet<Capability> = new Set<Capability>(["changeAiRouting", "resetDemo"]);

export function can(role: Role, cap: Capability, opts: CanOptions = {}): boolean {
  const row = CAPABILITY_MATRIX[cap];
  if (!row || !(role in row)) return false;
  if (opts.demoOpenControls === true && OPEN_CONTROLS.has(cap)) return true;
  return row[role] === true;
}
