"use server";
/**
 * Demo persona switcher (PLAN.md §4.8). The cookie holds only a signed persona ID — never the role, which
 * getActor() reads from the DB on every request.
 */
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PERSONA_COOKIE } from "@/lib/auth/persona-cookie";
import { assertCan, isSwitchablePersona, requireActor, signPersonaCookie } from "@/server/actor";
import { SafeError, withSafeErrors } from "@/server/safe";

const PersonaIdInput = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** Secure only when the request arrived over https (the LAN tablet proxy); plain http on 127.0.0.1 otherwise. */
async function requestIsHttps(): Promise<boolean> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (proto) return proto === "https";
  return (h.get("origin") ?? "").toLowerCase().startsWith("https://");
}

const setPersonaSafe = withSafeErrors(async (personaId: unknown): Promise<void> => {
  const actor = await requireActor();
  assertCan(actor, "switchPersona");

  // Never echo the input back in an error.
  const parsed = PersonaIdInput.safeParse(personaId);
  if (!parsed.success || !isSwitchablePersona(parsed.data)) {
    throw new SafeError("invalid_persona", "That persona isn't available.");
  }

  const store = await cookies();
  store.set(PERSONA_COOKIE, signPersonaCookie(parsed.data), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: await requestIsHttps(),
  });
  revalidatePath("/", "layout");
}, "setPersona");

export async function setPersona(personaId: string): Promise<void> {
  return setPersonaSafe(personaId);
}
