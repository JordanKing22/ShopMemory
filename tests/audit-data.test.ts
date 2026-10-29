import { describe, expect, it } from "vitest";
import { writeAhead, writeComplete } from "@/lib/audit/ai-audit";
import { writeEvent } from "@/lib/audit/events";
import type { AuditViewer } from "@/lib/audit/types";
import { auditRowDetail, exportAuditRows, listAuditRows, type AuditSearchDeps } from "@/lib/data/audit";
import { NO_PATTERN_TOKENS, redactText } from "@/lib/redaction";
import { completeInput, writeAheadInput } from "./helpers/audit";
import { seedRedactionDictionary } from "./helpers/dictionary";
import { seededDb } from "./helpers/seeded-db";

const dict = seedRedactionDictionary();
const deps: AuditSearchDeps = { dict, patterns: NO_PATTERN_TOKENS };
const owner: AuditViewer = { role: "owner", personId: null, personaId: "P-OWNER" };
const maya: AuditViewer = { role: "quoter", personId: "PER-05", personaId: "P-PER-05" };
const marv: AuditViewer = { role: "machinist", personId: "PER-02", personaId: "P-PER-02" };

function setup() {
  const s = seededDb();
  const q = redactText("How do we quote thin-wall Ti brackets for Aerovance?", dict, NO_PATTERN_TOKENS);
  const mayas = writeAhead(
    s.db,
    writeAheadInput({
      requestId: "req_maya",
      feature: "ask_shop",
      task: "ask_shop",
      decision: "withheld_partial",
      userInputRedacted: q.value,
      tokensUsed: q.tokensUsed,
      recordsSent: ["card:KC-001"],
      recordsWithheld: [{ ref: "job:J-A06", classification: "export_controlled", reason: "not_cleared_for_target" }],
      notice: { key: "withheld_records", params: { count: 1, recordKinds: "job", classification: "export_controlled", mode: "cloud", providerKind: "anthropic", model: "claude-sonnet-5-5" } },
    }),
  );
  const marvs = writeComplete(s.db, completeInput({ requestId: "req_marv", actor: { personaId: "P-PER-02", personId: "PER-02", role: "machinist" } }));
  writeEvent(s.db, { kind: "settings_change", actor: { personaId: "P-PER-05", personId: "PER-05", role: "quoter" }, details: { mode: "local" } }, "2026-10-01T10:00:00.000Z");
  return { ...s, mayas, marvs };
}

describe("audit data layer", () => {
  it("owner sees every row; other roles only their own (seeded history included in the counts)", () => {
    const { db, sqlite, mayas, marvs } = setup();
    const all = listAuditRows(db, owner, {}, deps);
    expect(all.scope).toBe("all");
    expect(all.rows.map((r) => r.id)).toEqual(expect.arrayContaining([mayas, marvs]));
    const own = listAuditRows(db, maya, {}, deps);
    expect(own.scope).toBe("own");
    expect(own.rows.every((r) => r.actorLabel === "Maya Chen")).toBe(true);
    expect(own.rows.map((r) => r.id)).toContain(mayas);
    expect(own.rows.map((r) => r.id)).not.toContain(marvs);
    expect(auditRowDetail(db, marv, mayas)).toBeNull();
    expect(exportAuditRows(db, marv, {}, deps).every((r) => r.actorPersonId === "PER-02")).toBe(true);
    sqlite.close();
  });

  it("free-text search runs through the redactor: a customer name finds its tokenized row", () => {
    const { db, sqlite, mayas } = setup();
    expect(listAuditRows(db, owner, { q: "Aerovance" }, deps).rows.map((r) => r.id)).toContain(mayas);
    expect(listAuditRows(db, owner, { q: "thin-wall Ti" }, deps).rows.map((r) => r.id)).toContain(mayas);
    expect(listAuditRows(db, owner, { q: "100%_\\" }, deps).rows).toEqual([]);
    sqlite.close();
  });

  it("filters by decision, feature and replay kind", () => {
    const { db, sqlite, mayas, marvs } = setup();
    expect(listAuditRows(db, owner, { decision: "blocked" }, deps).rows.map((r) => r.id)).toContain(marvs);
    expect(listAuditRows(db, owner, { decision: "blocked" }, deps).rows.map((r) => r.id)).not.toContain(mayas);
    expect(listAuditRows(db, owner, { replay: "not_sent" }, deps).rows.every((r) => r.transport === "none")).toBe(true);
    expect(listAuditRows(db, owner, { feature: "ask_shop", replay: "replay" }, deps).rows.map((r) => r.id)).toEqual([mayas]);
    sqlite.close();
  });

  it("detail resolves names, records and the notice at view time; labels replays honestly", () => {
    const { db, sqlite, mayas } = setup();
    const d = auditRowDetail(db, maya, mayas)!;
    expect(d.actorLabel).toBe("Maya Chen");
    expect(d.replayLabel).toBe("REPLAY · scripted (not model output)");
    expect(d.storedFormLabel).toBe("sent: redacted · stored: as sent");
    expect(d.recordsWithheld[0]).toMatchObject({ ref: "job:J-A06", classification: "export_controlled" });
    expect(d.recordsWithheld[0].label).toMatch(/^job RJ-/);
    expect(d.notice?.title).toBe("1 related job was withheld from this answer.");
    expect(d.canReveal).toBe(true);
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
    sqlite.close();
  });

  it("includes activity events on request, scoped the same way", () => {
    const { db, sqlite } = setup();
    expect(listAuditRows(db, maya, { includeEvents: true }, deps).events?.map((e) => e.kind)).toContain("settings_change");
    expect(listAuditRows(db, marv, { includeEvents: true }, deps).events?.some((e) => e.kind === "settings_change")).toBe(false);
    sqlite.close();
  });
});
