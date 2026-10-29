import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { aiAuditLog, eventLog, redactionTokens } from "@/db/schema";
import { finalize, writeAhead, writeComplete } from "@/lib/audit/ai-audit";
import { UnsafeEventDetailsError, writeEvent } from "@/lib/audit/events";
import { createPatternTokenResolver, lookupPatternToken, persistPatternTokens } from "@/lib/audit/token-store";
import { APP_VERSION } from "@/lib/audit/types";
import { completeInput, writeAheadInput } from "./helpers/audit";
import { seededDb } from "./helpers/seeded-db";

describe("ai_audit_log writer", () => {
  it("write-ahead inserts a pending row; finalize completes it exactly once; the trigger blocks later updates", () => {
    const { db, sqlite } = seededDb();
    const id = writeAhead(db, writeAheadInput({ recordsSent: ["card:KC-001"], tokensUsed: ["[[PERSON_ABCD]]"] }));
    const pending = db.select().from(aiAuditLog).where(eq(aiAuditLog.id, id)).get()!;
    expect(pending).toMatchObject({ outcome: "pending", completedAt: null, transport: "demo_replay_exact", attempt: 1, redactionTokenCount: 1 });

    const fin = {
      completedAt: "2026-10-01T10:00:02.000Z",
      outcome: "ok" as const,
      servedModel: null,
      responseRedacted: "Received.",
      inputTokens: null,
      outputTokens: null,
      latencyMs: 1200.4,
      ttftMs: 700,
      stopReason: "end_turn",
      errorCode: null,
      citationsValid: 0,
      citationsStripped: 0,
    };
    expect(finalize(db, id, fin)).toBe(true);
    expect(finalize(db, id, fin)).toBe(false); // already complete: 0 rows
    const done = db.select().from(aiAuditLog).where(eq(aiAuditLog.id, id)).get()!;
    expect(done).toMatchObject({ outcome: "ok", latencyMs: 1200, responseRedacted: "Received." });
    expect(() => sqlite.prepare("UPDATE ai_audit_log SET outcome = 'aborted' WHERE id = ?").run(id)).toThrow(/immutable/);
    expect(finalize(db, 99999, fin)).toBe(false); // row gone (reset mid-stream)
    sqlite.close();
  });

  it("blocked / held rows are written complete: nothing sent, transport none, completed_at = created_at", () => {
    const { db, sqlite } = seededDb();
    const id = writeComplete(db, completeInput());
    const row = db.select().from(aiAuditLog).where(eq(aiAuditLog.id, id)).get()!;
    expect(row).toMatchObject({
      outcome: "blocked",
      transport: "none",
      requestPayloadRedacted: null,
      payloadHash: null,
      recordsSent: [],
      noticeKey: "blocked_request_controlled",
      completedAt: row.createdAt,
    });
    sqlite.close();
  });

  it("APP_VERSION matches package.json", () => {
    expect(APP_VERSION).toBe((JSON.parse(fs.readFileSync("package.json", "utf8")) as { version: string }).version);
  });
});

describe("event_log writer", () => {
  it("stores IDs, enums, counts and booleans; refuses free text without echoing it", () => {
    const { db, sqlite } = seededDb();
    const id = writeEvent(
      db,
      { kind: "settings_change", actor: { personaId: "P-OWNER", personId: null, role: "owner" }, subjectKind: "app_setting", subjectId: "ai_routing", details: { mode: "local", ok: true, n: 2 } },
      "2026-10-01T10:00:00.000Z",
    );
    expect(db.select().from(eventLog).where(eq(eventLog.id, id)).get()!.detailsJson).toEqual({ mode: "local", ok: true, n: 2 });
    let message = "";
    try {
      writeEvent(db, { kind: "audit_export", actor: null, details: { q: "How do we quote Aerovance?" } }, "2026-10-01T10:00:00.000Z");
    } catch (e) {
      expect(e).toBeInstanceOf(UnsafeEventDetailsError);
      message = (e as Error).message;
    }
    expect(message).not.toContain("Aerovance");
    sqlite.close();
  });
});

describe("redaction_tokens store", () => {
  it("persists minted pattern tokens insert-or-ignore and resolves them by value and by token", () => {
    const { db, sqlite } = seededDb();
    const minted = [{ token: "[[AMOUNT_ABCD]]", kind: "AMOUNT" as const, value: "$1,800" }];
    persistPatternTokens(db, minted, "2026-10-01T10:00:00.000Z");
    persistPatternTokens(db, minted, "2026-10-01T10:00:00.000Z");
    expect(db.select().from(redactionTokens).all()).toHaveLength(1);
    const r = createPatternTokenResolver(db);
    expect(r.tokenFor("AMOUNT", " $1,800 ")).toBe("[[AMOUNT_ABCD]]");
    expect(r.isTaken("[[AMOUNT_ABCD]]")).toBe(true);
    expect(lookupPatternToken(db, "[[AMOUNT_ABCD]]")).toEqual({ kind: "AMOUNT", value: "$1,800" });
    sqlite.close();
  });
});
