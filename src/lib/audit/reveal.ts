/**
 * Reveal (PLAN.md §4.7): re-hydrates, at render time only, the tokens listed in that row's own tokens_used (tokens the
 * redactor produced from that request), filtered by the viewer's role. A literal "[[CONTACT_…]]" the user typed was
 * escaped before redaction, so it is never in tokens_used and reveals nothing. Pure.
 *
 * Scope: the owner (viewAll) may reveal any row; every other role only its own rows. Per kind: CUSTOMER, PERSON,
 * PART, JOB, QUOTE, PN → every role; AMOUNT → roles that see prices; CONTACT, EMAIL, PHONE → roles that see contacts.
 */
import { can, canSee, hiddenLabel } from "@/lib/auth/roles";
import { isToken, parseToken } from "@/lib/redaction/patterns";
import type { TokenKind } from "@/lib/redaction/types";
import type { AuditRow, AuditViewer, RevealResult } from "./types";

type RevealRow = Pick<AuditRow, "id" | "tokensUsed" | "actorPersonaId" | "actorPersonId">;

export function canRevealRow(row: Pick<AuditRow, "actorPersonaId" | "actorPersonId">, viewer: AuditViewer): boolean {
  if (can(viewer.role, "viewAll")) return true;
  if (viewer.personId) return row.actorPersonId === viewer.personId;
  return row.actorPersonId === null && row.actorPersonaId === viewer.personaId;
}

/** Same scope as Reveal: rows the viewer may see at all. */
export const canViewRow = canRevealRow;

export function kindVisibleTo(kind: TokenKind, viewer: Pick<AuditViewer, "role">): boolean {
  if (kind === "AMOUNT") return canSee(viewer.role, "prices");
  if (kind === "CONTACT" || kind === "EMAIL" || kind === "PHONE") return canSee(viewer.role, "contacts");
  return true;
}

export function revealRow(
  row: RevealRow,
  viewer: AuditViewer,
  lookup: (token: string) => { kind: TokenKind; value: string } | null,
): RevealResult {
  if (!canRevealRow(row, viewer)) return { rowId: row.id, entries: [] };
  const entries = (row.tokensUsed ?? [])
    .filter((t) => isToken(t))
    .map((token) => {
      const kind = parseToken(token)!.kind;
      if (!kindVisibleTo(kind, viewer)) return { token, value: null, hiddenLabel: hiddenLabel(viewer.role) };
      const hit = lookup(token);
      return { token, value: hit && hit.kind === kind ? hit.value : null };
    });
  return { rowId: row.id, entries };
}
