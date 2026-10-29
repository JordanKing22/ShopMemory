/**
 * redaction_tokens: the persisted pattern tokens (PN / EMAIL / PHONE / AMOUNT) so Reveal can resolve them later
 * (docs/AI-GATEWAY.md §7.2). Entity tokens are never stored: they are computed from the HMAC rule.
 * real_value is sensitive: never logged, never routable, returned only through Reveal.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { redactionTokens } from "@/db/schema";
import { normalizePatternValue } from "@/lib/redaction/patterns";
import type { PatternTokenKind, PatternTokenRecord, PatternTokenResolver, TokenKind } from "@/lib/redaction/types";

const SCOPE = "global";

/** Read access for the redactor: existing token for a value; whether a token string is already taken. */
export function createPatternTokenResolver(db: Db): PatternTokenResolver {
  return {
    tokenFor(kind: PatternTokenKind, value: string) {
      const row = db
        .select({ token: redactionTokens.token })
        .from(redactionTokens)
        .where(
          and(eq(redactionTokens.kind, kind), eq(redactionTokens.realValue, normalizePatternValue(kind, value)), eq(redactionTokens.scope, SCOPE)),
        )
        .get();
      return row?.token;
    },
    isTaken(token: string) {
      return db.select({ token: redactionTokens.token }).from(redactionTokens).where(eq(redactionTokens.token, token)).get() !== undefined;
    },
  };
}

/** Insert-or-ignore the tokens a request minted (called at R1, in the write-ahead transaction). */
export function persistPatternTokens(db: Db, minted: readonly PatternTokenRecord[], nowIso: string): void {
  for (const m of minted) {
    db.insert(redactionTokens)
      .values({ token: m.token, kind: m.kind, entityId: null, realValue: normalizePatternValue(m.kind, m.value), scope: SCOPE, createdAt: nowIso })
      .onConflictDoNothing()
      .run();
  }
}

/** The stored value of a pattern token (Reveal only). */
export function lookupPatternToken(db: Db, token: string): { kind: TokenKind; value: string } | null {
  const row = db.select({ kind: redactionTokens.kind, value: redactionTokens.realValue }).from(redactionTokens).where(eq(redactionTokens.token, token)).get();
  return row ?? null;
}
