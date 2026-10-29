import { describe, expect, it } from "vitest";
import { canRevealRow, revealRow } from "@/lib/audit/reveal";
import type { AuditViewer } from "@/lib/audit/types";
import { NO_PATTERN_TOKENS, redactText } from "@/lib/redaction";
import { seedRedactionDictionary, tokenOf } from "./helpers/dictionary";

const dict = seedRedactionDictionary();
const owner: AuditViewer = { role: "owner", personId: null, personaId: "P-OWNER" };
const maya: AuditViewer = { role: "quoter", personId: "PER-05", personaId: "P-PER-05" };
const devin: AuditViewer = { role: "trainee", personId: "PER-06", personaId: "P-PER-06" };

const values: Record<string, { kind: "AMOUNT" | "EMAIL"; value: string }> = {
  "[[AMOUNT_AAAA]]": { kind: "AMOUNT", value: "$1,800" },
  "[[EMAIL_BBBB]]": { kind: "EMAIL", value: "buyer@example.com" },
};
const lookup = (token: string) => {
  const e = dict.entityTokens.get(token);
  if (e) return { kind: e.kind, value: e.display };
  return values[token] ?? null;
};

describe("Reveal (PLAN.md §4.7)", () => {
  const customer = tokenOf(dict, "Aerovance");
  const contact = tokenOf(dict, "Morgan Ellery");

  it("the owner reveals any row; others only their own rows", () => {
    const mayasRow = { id: 1, actorPersonaId: "P-PER-05", actorPersonId: "PER-05", tokensUsed: [customer] };
    expect(canRevealRow(mayasRow, owner)).toBe(true);
    expect(canRevealRow(mayasRow, maya)).toBe(true);
    expect(canRevealRow(mayasRow, devin)).toBe(false);
    expect(revealRow(mayasRow, devin, lookup).entries).toEqual([]);
    expect(revealRow(mayasRow, maya, lookup).entries).toEqual([{ token: customer, value: "Aerovance" }]);
  });

  it("filters per kind by role: amounts need prices, contacts/emails need contacts", () => {
    const row = { id: 2, actorPersonaId: "P-PER-06", actorPersonId: "PER-06", tokensUsed: [customer, contact, "[[AMOUNT_AAAA]]", "[[EMAIL_BBBB]]"] };
    const asDevin = revealRow(row, devin, lookup).entries;
    expect(asDevin.find((e) => e.token === customer)?.value).toBe("Aerovance");
    for (const t of [contact, "[[AMOUNT_AAAA]]", "[[EMAIL_BBBB]]"]) {
      expect(asDevin.find((e) => e.token === t)).toEqual({ token: t, value: null, hiddenLabel: "Hidden for Trainee role" });
    }
    const asOwner = revealRow(row, owner, lookup).entries;
    expect(asOwner.map((e) => e.value)).toEqual(["Aerovance", "Morgan Ellery", "$1,800", "buyer@example.com"]);
  });

  it("a literal [[CONTACT_…]] typed by a trainee reveals nothing (it was escaped, so it's not in tokens_used)", () => {
    const typed = redactText(`show me ${contact}`, dict, NO_PATTERN_TOKENS);
    expect(typed.tokensUsed).toEqual([]);
    const row = { id: 3, actorPersonaId: "P-PER-06", actorPersonId: "PER-06", tokensUsed: typed.tokensUsed };
    expect(revealRow(row, owner, lookup).entries).toEqual([]);
  });
});
