import { describe, expect, it } from "vitest";
import { monthsBetween, formatMonthDay, demoClockIso } from "@/lib/time";
import { maxClass } from "@/db/schema/enums";

describe("time", () => {
  it("counts whole months the same way everywhere", () => {
    expect(monthsBetween("2026-09-15", "2028-05-15")).toBe(20); // Ray: retires in 20 months
    expect(monthsBetween("2026-01-12", "2026-09-15")).toBe(8); // Maya: 8 months
    expect(monthsBetween("2026-03-09", "2026-09-15")).toBe(6);
  });
  it("formats month/day for templates in en-US UTC", () => {
    expect(formatMonthDay("2026-09-11")).toBe("Sep 11");
  });
  it("builds the demo clock from DEMO_TODAY plus real time of day", () => {
    expect(demoClockIso("2026-09-15", new Date("2026-09-29T13:45:10.000Z"))).toBe("2026-09-15T13:45:10.000Z");
  });
});

describe("classification", () => {
  it("takes the max", () => {
    expect(maxClass("internal", "export_controlled", "general")).toBe("export_controlled");
  });
});
