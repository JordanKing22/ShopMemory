/**
 * Signed persona cookie (PLAN.md §4.8). Pure (node:crypto only) so it can be unit-tested outside Next.js.
 *
 * Value format: "<personaId>.<base64url HMAC-SHA256>". The cookie carries only the persona ID; the role is always
 * read from the DB (src/server/actor.ts). The secret is a per-boot random key held by the server, never persisted.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const PERSONA_COOKIE = "fw_persona";

/** Persona IDs are short opaque identifiers like P-OWNER or P-PER-01 (no dots, so the split is unambiguous). */
const PERSONA_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** SHA-256 = 32 bytes = 43 base64url characters without padding. */
const SIGNATURE_RE = /^[A-Za-z0-9_-]{43}$/;
/** Domain separation so this key can never be confused with another HMAC use. */
const CONTEXT = "fw_persona:v1:";

export type PersonaSecret = string | Uint8Array;

function secretLength(secret: PersonaSecret): number {
  return typeof secret === "string" ? secret.length : secret.byteLength;
}

function mac(personaId: string, secret: PersonaSecret): Buffer {
  return createHmac("sha256", secret).update(CONTEXT + personaId, "utf8").digest();
}

export function isValidPersonaId(personaId: unknown): personaId is string {
  return typeof personaId === "string" && PERSONA_ID_RE.test(personaId);
}

export function signPersona(personaId: string, secret: PersonaSecret): string {
  // Error messages never echo the input.
  if (!isValidPersonaId(personaId)) throw new Error("signPersona: invalid persona id");
  if (secretLength(secret) === 0) throw new Error("signPersona: empty secret");
  return `${personaId}.${mac(personaId, secret).toString("base64url")}`;
}

/** Returns the persona ID when the value was signed with this secret, otherwise null. Never throws. */
export function verifyPersona(value: unknown, secret: PersonaSecret): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) return null;
  if (secretLength(secret) === 0) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [personaId, signature] = parts;
  if (!isValidPersonaId(personaId) || !SIGNATURE_RE.test(signature)) return null;

  const given = Buffer.from(signature, "base64url");
  // Reject non-canonical encodings (different strings that decode to the same bytes).
  if (given.length !== 32 || given.toString("base64url") !== signature) return null;

  const expected = mac(personaId, secret);
  if (expected.length !== given.length) return null;
  return timingSafeEqual(expected, given) ? personaId : null;
}
