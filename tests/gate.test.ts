import { describe, expect, it } from "vitest";
import { GATED_FIELDS, ROLES } from "@/lib/auth/roles";
import { gated, gatedValue } from "@/lib/data/gate";

const CANARY = { unitPrice: 14884.62, note: "PRICE-CANARY-9731" };

describe("gated()", () => {
  it.each(GATED_FIELDS.flatMap((f) => (["machinist", "trainee"] as const).map((r) => [r, f] as const)))(
    "hides %s / %s and never carries the value",
    (role, field) => {
      const g = gated(role, field, CANARY);
      const label = role === "machinist" ? "Hidden for Machinist role" : "Hidden for Trainee role";
      expect(g).toEqual({ hidden: true, label });
      expect(Object.keys(g).sort()).toEqual(["hidden", "label"]);
      expect("value" in g).toBe(false);
      const serialized = JSON.stringify(g);
      expect(serialized).not.toContain("PRICE-CANARY-9731");
      expect(serialized).not.toContain("14884");
      expect(gatedValue(g)).toBeNull();
    },
  );

  it.each(GATED_FIELDS.flatMap((f) => (["owner", "quoter"] as const).map((r) => [r, f] as const)))(
    "shows %s / %s",
    (role, field) => {
      const g = gated(role, field, CANARY);
      expect(g).toEqual({ hidden: false, value: CANARY });
      expect(gatedValue(g)).toBe(CANARY);
    },
  );

  it("hides falsy values the same way (no leak through 0, empty string or null)", () => {
    for (const v of [0, "", null, false]) {
      expect(gated("machinist", "prices", v)).toEqual({ hidden: true, label: "Hidden for Machinist role" });
    }
    expect(gated("owner", "prices", 0)).toEqual({ hidden: false, value: 0 });
  });

  it("covers every role", () => {
    expect([...ROLES].sort()).toEqual(["machinist", "owner", "quoter", "trainee"]);
  });
});
