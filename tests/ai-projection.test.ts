import { describe, expect, it } from "vitest";
import { ROLES } from "@/db/schema/enums";
import { NEVER_PROJECTED, loadRecordsForLlm } from "@/lib/ai/projection";
import type { RecordRef } from "@/lib/ai/types";
import { seededDb } from "./helpers/seeded-db";

const REFS: RecordRef[] = [
  { kind: "job", id: "J-A02" },
  { kind: "job", id: "J-A10" },
  { kind: "quote", id: "Q-A01" },
  { kind: "part", id: "PRT-A01" },
  { kind: "card", id: "KC-001" },
  { kind: "customer", id: "CUS-01" },
];

function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysDeep(x, out);
    }
  }
  return out;
}

describe("LLM projections (PLAN.md §4.8: pricing and contacts never reach a model)", () => {
  const { db } = seededDb();

  for (const role of ROLES) {
    it(`${role}: no pricing, contact or departure field, no $ amount`, () => {
      const recs = loadRecordsForLlm(db, role, REFS);
      expect(recs.map((r) => `${r.ref.kind}:${r.ref.id}`)).toEqual(REFS.map((r) => `${r.kind}:${r.id}`));
      const keys = keysDeep(recs.map((r) => r.projection));
      for (const f of NEVER_PROJECTED) expect(keys.has(f), f).toBe(false);
      expect(JSON.stringify(recs.map((r) => r.projection))).not.toMatch(/\$\s?\d/);
    });
  }

  it("win/loss and quoter notes only for roles that may see win/loss", () => {
    const [q] = loadRecordsForLlm(db, "quoter", [{ kind: "quote", id: "Q-A01" }]);
    const [m] = loadRecordsForLlm(db, "machinist", [{ kind: "quote", id: "Q-A01" }]);
    expect(q.projection).toHaveProperty("outcome");
    expect(m.projection).not.toHaveProperty("outcome");
    expect(m.projection).not.toHaveProperty("quoterNotes");
  });

  it("drops unknown records and unapproved cards silently, and de-duplicates", () => {
    const recs = loadRecordsForLlm(db, "owner", [
      { kind: "card", id: "KC-066" }, // a draft
      { kind: "job", id: "J-NOPE" },
      { kind: "job", id: "J-A02" },
      { kind: "job", id: "J-A02" },
    ]);
    expect(recs.map((r) => r.ref.id)).toEqual(["J-A02"]);
  });
});
