import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  GATED_FIELDS,
  ROLE_LABEL,
  ROLES,
  can,
  canSee,
  hiddenLabel,
  type Capability,
  type GatedField,
  type Role,
} from "@/lib/auth/roles";

// PLAN.md §4.8, written out as the expected table so a change to roles.ts has to change this too.
const SEE: Record<Role, Record<GatedField, boolean>> = {
  owner: { prices: true, winLoss: true, contacts: true, departure: true },
  quoter: { prices: true, winLoss: true, contacts: true, departure: true },
  machinist: { prices: false, winLoss: false, contacts: false, departure: false },
  trainee: { prices: false, winLoss: false, contacts: false, departure: false },
};

const CAN_CLOSED: Record<Role, Record<Capability, boolean>> = {
  owner: { viewAll: true, switchPersona: true, changeAiRouting: true, resetDemo: true, fullExport: true, fullDelete: true, generateDocuments: true },
  quoter: { viewAll: false, switchPersona: true, changeAiRouting: false, resetDemo: false, fullExport: false, fullDelete: false, generateDocuments: true },
  machinist: { viewAll: false, switchPersona: true, changeAiRouting: false, resetDemo: false, fullExport: false, fullDelete: false, generateDocuments: true },
  trainee: { viewAll: false, switchPersona: true, changeAiRouting: false, resetDemo: false, fullExport: false, fullDelete: false, generateDocuments: false },
};

// DEMO_OPEN_CONTROLS=true opens only AI routing and Reset to every persona.
const CAN_OPEN: Record<Role, Record<Capability, boolean>> = {
  owner: { ...CAN_CLOSED.owner },
  quoter: { ...CAN_CLOSED.quoter, changeAiRouting: true, resetDemo: true },
  machinist: { ...CAN_CLOSED.machinist, changeAiRouting: true, resetDemo: true },
  trainee: { ...CAN_CLOSED.trainee, changeAiRouting: true, resetDemo: true },
};

describe("roles", () => {
  it("has the four roles with their labels", () => {
    expect([...ROLES]).toEqual(["owner", "quoter", "machinist", "trainee"]);
    expect(ROLE_LABEL).toEqual({ owner: "Owner", quoter: "Quoter", machinist: "Machinist", trainee: "Trainee" });
  });

  it.each(ROLES.flatMap((r) => GATED_FIELDS.map((f) => [r, f] as const)))("canSee(%s, %s)", (role, field) => {
    expect(canSee(role, field)).toBe(SEE[role][field]);
  });

  it("hides every gated field from machinist and trainee, shows every one to owner and quoter", () => {
    for (const f of GATED_FIELDS) {
      expect(canSee("owner", f)).toBe(true);
      expect(canSee("quoter", f)).toBe(true);
      expect(canSee("machinist", f)).toBe(false);
      expect(canSee("trainee", f)).toBe(false);
    }
  });

  it("fails closed for unknown roles and fields", () => {
    expect(canSee("admin" as Role, "prices")).toBe(false);
    expect(canSee("owner", "salary" as GatedField)).toBe(false);
    expect(can("admin" as Role, "switchPersona")).toBe(false);
    expect(can("owner", "sudo" as Capability)).toBe(false);
    expect(can("admin" as Role, "resetDemo", { demoOpenControls: true })).toBe(false);
  });

  it("words the hidden pill exactly", () => {
    expect(hiddenLabel("machinist")).toBe("Hidden for Machinist role");
    expect(hiddenLabel("trainee")).toBe("Hidden for Trainee role");
    expect(hiddenLabel("quoter")).toBe("Hidden for Quoter role");
    expect(hiddenLabel("owner")).toBe("Hidden for Owner role");
  });

  it.each(ROLES.flatMap((r) => CAPABILITIES.map((c) => [r, c] as const)))("can(%s, %s) without open controls", (role, cap) => {
    expect(can(role, cap)).toBe(CAN_CLOSED[role][cap]);
    expect(can(role, cap, { demoOpenControls: false })).toBe(CAN_CLOSED[role][cap]);
  });

  it.each(ROLES.flatMap((r) => CAPABILITIES.map((c) => [r, c] as const)))("can(%s, %s) with DEMO_OPEN_CONTROLS", (role, cap) => {
    expect(can(role, cap, { demoOpenControls: true })).toBe(CAN_OPEN[role][cap]);
  });

  it("never opens full export or full delete to non-owners", () => {
    for (const r of ROLES.filter((x) => x !== "owner")) {
      expect(can(r, "fullExport", { demoOpenControls: true })).toBe(false);
      expect(can(r, "fullDelete", { demoOpenControls: true })).toBe(false);
    }
  });
});
