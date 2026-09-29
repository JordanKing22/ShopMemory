/**
 * Field gate for view models (PLAN.md §4.8). A hidden field's value must not exist in the RSC payload at all:
 * data functions call gated() so the value is dropped on the server, and the page renders the "Hidden for {Role}
 * role" pill from `label`. Never hide a value with CSS.
 */
import { canSee, hiddenLabel, type GatedField, type Role } from "@/lib/auth/roles";

export type Hidden = { hidden: true; label: string };
export type Visible<T> = { hidden: false; value: T };
export type Gated<T> = Hidden | Visible<T>;

export function gated<T>(role: Role, field: GatedField, value: T): Gated<T> {
  // Build a fresh object in both branches so the hidden branch can never carry the value along.
  if (!canSee(role, field)) return { hidden: true, label: hiddenLabel(role) };
  return { hidden: false, value };
}

/** Convenience for code that needs the raw value or null (e.g. sorting). Returns null when hidden. */
export function gatedValue<T>(g: Gated<T>): T | null {
  return g.hidden ? null : g.value;
}
