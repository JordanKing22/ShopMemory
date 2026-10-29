import { describe, expect, it } from "vitest";
import { csvCell, exportFileName, maxClassificationOf, toCsv, toJson, EXPORT_COLUMNS } from "@/lib/audit/export";
import type { AuditRow } from "@/lib/audit/types";
import { writeAhead } from "@/lib/audit/ai-audit";
import { aiAuditLog } from "@/db/schema";
import { writeAheadInput } from "./helpers/audit";
import { seededDb } from "./helpers/seeded-db";

describe("audit export", () => {
  it("guards formula cells and quotes CSV specials", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(null)).toBe("");
    expect(csvCell(["a"])).toBe('"[""a""]"');
  });

  it("exports every column except tenant_id, with snake_case headers", () => {
    const { db, sqlite } = seededDb();
    writeAhead(db, writeAheadInput({ userInputRedacted: "=cmd|' /C calc'!A0" }));
    const rows = db.select().from(aiAuditLog).all() as AuditRow[];
    const csv = toCsv(rows);
    const head = csv.split("\r\n")[0].split(",");
    expect(head).toHaveLength(EXPORT_COLUMNS.length);
    expect(head).toContain("user_input_redacted");
    expect(head).not.toContain("tenant_id");
    expect(csv).toContain("'=cmd");
    const json = JSON.parse(toJson(rows)) as Record<string, unknown>[];
    expect(Object.keys(json[0])).not.toContain("tenant_id");
    sqlite.close();
  });

  it("names the file after the highest classification included and the UTC date", () => {
    expect(maxClassificationOf([{ maxClassification: "internal" }, { maxClassification: "export_controlled" }])).toBe("export_controlled");
    expect(maxClassificationOf([])).toBe("empty");
    expect(exportFileName("customer_confidential", "2026-10-01T23:59:00.000Z", "csv")).toBe("floorwise-audit-customer-confidential-20261001.csv");
  });
});
