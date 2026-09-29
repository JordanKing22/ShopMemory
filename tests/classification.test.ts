import { describe, expect, it } from "vitest";
import {
  REFERENCE_KINDS,
  classAtLeast,
  classBelow,
  defaultCardClass,
  deriveCaptureFloor,
  deriveCardFloor,
  deriveDocumentFloor,
  deriveGeneratedFloor,
  deriveInterviewFloor,
  deriveJobFloor,
  derivePartFloor,
  derivePhotoFloor,
  deriveQuizFloor,
  deriveQuoteFloor,
  raisingClasses,
  recomputeOnlyRaises,
  resolveClassification,
  type ExportControl,
} from "@/db/classification";
import { CLASSIFICATIONS, EXPORT_CONTROL, type Classification } from "@/db/schema/enums";
import { buildDictionary, detectEntities } from "@/lib/policy/entity-detect";

const G: Classification = "general";
const I: Classification = "internal";
const CC: Classification = "customer_confidential";
const EC: Classification = "export_controlled";

type PartFloorCustomer = { partClassificationFloor: Classification };
const AEROVANCE: PartFloorCustomer = { partClassificationFloor: CC };
const GRAYMOOR: PartFloorCustomer = { partClassificationFloor: EC };

describe("comparisons", () => {
  it("rank general < internal < customer_confidential < export_controlled", () => {
    expect(classBelow(G, I)).toBe(true);
    expect(classBelow(I, CC)).toBe(true);
    expect(classBelow(CC, EC)).toBe(true);
    expect(classBelow(EC, EC)).toBe(false);
    expect(classAtLeast(EC, CC)).toBe(true);
    expect(classAtLeast(I, I)).toBe(true);
    expect(classAtLeast(G, I)).toBe(false);
  });

  it("raisingClasses drops machine, material and person inputs", () => {
    expect([...REFERENCE_KINDS].sort()).toEqual(["machine", "material", "person"]);
    expect(
      raisingClasses([
        CC,
        { kind: "machine", classification: EC },
        { kind: "person", classification: I },
        { kind: "material", classification: EC },
        { kind: "job", classification: EC },
      ]),
    ).toEqual([CC, EC]);
    expect(raisingClasses()).toEqual([]);
  });
});

describe("part, quote and job floors", () => {
  it("part floor = customer's part floor, raised by itar / ear_controlled", () => {
    const table: [ExportControl, PartFloorCustomer | null, Classification][] = [
      ["none", AEROVANCE, CC],
      ["ear99", AEROVANCE, CC],
      ["ear_controlled", AEROVANCE, EC],
      ["itar", AEROVANCE, EC],
      ["none", GRAYMOOR, EC],
      ["ear99", GRAYMOOR, EC],
      ["none", null, I],
      ["ear99", null, I],
      ["itar", null, EC],
      ["ear_controlled", null, EC],
    ];
    for (const [exportControl, customer, expected] of table) {
      expect(derivePartFloor({ exportControl }, customer), `${exportControl} / ${customer?.partClassificationFloor}`).toBe(
        expected,
      );
    }
  });

  it("covers every export_control value", () => {
    for (const exportControl of EXPORT_CONTROL) {
      expect(CLASSIFICATIONS).toContain(derivePartFloor({ exportControl }, null));
    }
  });

  it("quote floor = part; job floor = quote (or part for internal work orders)", () => {
    for (const c of CLASSIFICATIONS) {
      expect(deriveQuoteFloor(c)).toBe(c);
      expect(deriveJobFloor(c)).toBe(c);
    }
    // PRT-A09-style override: the part was lowered with a reason, so its quotes/jobs follow the effective level.
    const partClass = resolveClassification({
      floor: derivePartFloor({ exportControl: "ear99" }, GRAYMOOR),
      defaultClass: EC,
      declared: CC,
      override: { direction: "down", reason: "Commercial spare, no controlled drawings (owner, fictional)" },
      subject: "part",
    }).classification;
    expect(partClass).toBe(CC);
    expect(deriveJobFloor(deriveQuoteFloor(partClass))).toBe(CC);
  });
});

describe("card floor", () => {
  const base = { sourceInterviewClass: null, isManualEntrySource: false, linkedRecordClasses: [], textMentions: [] };

  it("is general with no source, links or mentions", () => {
    expect(deriveCardFloor(base)).toBe(G);
  });

  it("takes the source interview", () => {
    expect(deriveCardFloor({ ...base, sourceInterviewClass: CC })).toBe(CC);
  });

  it("ignores hidden manual-entry sources", () => {
    expect(deriveCardFloor({ ...base, sourceInterviewClass: CC, isManualEntrySource: true })).toBe(G);
  });

  it("takes customer/part/job/quote links but not machine/material/person links", () => {
    expect(deriveCardFloor({ ...base, linkedRecordClasses: [CC, EC] })).toBe(EC);
    expect(
      deriveCardFloor({
        ...base,
        linkedRecordClasses: [
          { kind: "machine", classification: I },
          { kind: "material", classification: I },
          { kind: "person", classification: I },
        ],
      }),
    ).toBe(G);
    expect(deriveCardFloor({ ...base, linkedRecordClasses: [{ kind: "job", classification: EC }] })).toBe(EC);
  });

  it("takes text mentions (a card that mentions an export-controlled job inherits export_controlled)", () => {
    expect(deriveCardFloor({ ...base, textMentions: [EC] })).toBe(EC);
  });

  it("accepts detector output directly; person mentions don't raise it", () => {
    const dict = buildDictionary({
      customers: [
        { id: "CUS-01", name: "Aerovance", aliases: [], classification: CC, partClassificationFloor: CC },
      ],
      people: [{ id: "PER-02", fullName: "Marv Tollefson", aliases: ["Marv"] }],
      parts: [],
      jobs: [{ id: "J-A10", jobNumber: "RJ-26-0310", classification: EC }],
      quotes: [],
      stoplistNumbers: [],
    });
    const general = detectEntities("Marv warms the spindle up for twenty minutes on Mondays.", dict);
    expect(general.map((m) => m.kind)).toEqual(["person"]);
    expect(deriveCardFloor({ ...base, textMentions: general })).toBe(G);

    const customer = detectEntities("Aerovance wants a full first article.", dict);
    expect(deriveCardFloor({ ...base, textMentions: customer })).toBe(CC);

    const controlled = detectEntities("Same thing happened on RJ-26-0310.", dict);
    expect(deriveCardFloor({ ...base, textMentions: controlled })).toBe(EC);
  });

  it("is the max over all contributions", () => {
    expect(
      deriveCardFloor({ sourceInterviewClass: I, isManualEntrySource: false, linkedRecordClasses: [CC], textMentions: [I] }),
    ).toBe(CC);
  });

  it("default = max(floor, internal)", () => {
    expect(defaultCardClass(G)).toBe(I);
    expect(defaultCardClass(I)).toBe(I);
    expect(defaultCardClass(CC)).toBe(CC);
    expect(defaultCardClass(EC)).toBe(EC);
  });
});

describe("resolveClassification", () => {
  it("nothing declared → the default, derived", () => {
    expect(resolveClassification({ floor: G, defaultClass: I })).toEqual({
      classification: I,
      source: "derived",
      reason: null,
    });
    expect(resolveClassification({ floor: EC, defaultClass: EC })).toEqual({
      classification: EC,
      source: "derived",
      reason: null,
    });
  });

  it("a default below the floor is raised to the floor", () => {
    expect(resolveClassification({ floor: CC, defaultClass: I }).classification).toBe(CC);
  });

  it("declared 'general' is allowed only when the floor is general", () => {
    expect(resolveClassification({ floor: G, defaultClass: defaultCardClass(G), declared: G, subject: "card" })).toEqual({
      classification: G,
      source: "derived",
      reason: null,
    });
    for (const floor of [I, CC, EC]) {
      const r = resolveClassification({ floor, defaultClass: defaultCardClass(floor), declared: G, subject: "card" });
      expect(r.error, floor).toContain(`'general' is lower than the records this card comes from ('${floor}')`);
      expect(r.classification).toBe(defaultCardClass(floor));
      expect(r.source).toBe("derived");
    }
  });

  it("declared at the floor is derived", () => {
    expect(resolveClassification({ floor: CC, defaultClass: CC, declared: CC })).toEqual({
      classification: CC,
      source: "derived",
      reason: null,
    });
  });

  it("declared below the floor without a down-override is an error that fails safe", () => {
    const r = resolveClassification({ floor: CC, defaultClass: CC, declared: I, subject: "card" });
    expect(r.error).toContain("'internal' is lower than the records this card comes from");
    expect(r.classification).toBe(CC);
    expect(r.source).toBe("derived");
    expect(r.reason).toBeNull();
    expect(resolveClassification({ floor: EC, defaultClass: EC, declared: CC }).error).toContain(
      "'customer_confidential' is lower than the records this record comes from ('export_controlled')",
    );
  });

  it("a down-override with a reason lowers below the floor", () => {
    expect(
      resolveClassification({
        floor: EC,
        defaultClass: EC,
        declared: CC,
        override: { direction: "down", reason: "  Commercial spare  " },
      }),
    ).toEqual({ classification: CC, source: "override_down", reason: "Commercial spare" });
  });

  it("override errors: missing reason, missing level, wrong direction", () => {
    const noReason = resolveClassification({
      floor: EC,
      defaultClass: EC,
      declared: CC,
      override: { direction: "down", reason: "   " },
      subject: "part",
    });
    expect(noReason.error).toBe("Changing a part's classification by override needs a reason.");
    expect(noReason.classification).toBe(EC);

    const noLevel = resolveClassification({ floor: CC, defaultClass: CC, override: { direction: "down", reason: "x" } });
    expect(noLevel.error).toContain("needs the classification it sets");
    expect(noLevel.classification).toBe(CC);

    const notLower = resolveClassification({
      floor: CC,
      defaultClass: CC,
      declared: EC,
      override: { direction: "down", reason: "x" },
    });
    expect(notLower.error).toContain("'export_controlled' is not lower than the derived 'customer_confidential'");
    expect(notLower.classification).toBe(EC); // fails safe: never below the declared level

    const notHigher = resolveClassification({
      floor: CC,
      defaultClass: CC,
      declared: I,
      override: { direction: "up", reason: "x" },
    });
    expect(notHigher.error).toContain("'internal' is not higher than the derived 'customer_confidential'");
    expect(notHigher.classification).toBe(CC);
  });

  it("an up-override with a reason raises", () => {
    expect(
      resolveClassification({ floor: I, defaultClass: I, declared: EC, override: { direction: "up", reason: "CTI in photo" } }),
    ).toEqual({ classification: EC, source: "override_up", reason: "CTI in photo" });
  });

  it("declared above the default without an override is accepted as override_up with a warning", () => {
    const r = resolveClassification({ floor: G, defaultClass: I, declared: CC });
    expect(r.classification).toBe(CC);
    expect(r.source).toBe("override_up");
    expect(r.reason).toBeNull();
    expect(r.error).toBeUndefined();
    expect(r.warning).toContain("higher than the derived 'internal'");
  });

  it("general card declared general but floor raised by a mention → error", () => {
    const floor = deriveCardFloor({
      sourceInterviewClass: null,
      isManualEntrySource: true,
      linkedRecordClasses: [{ kind: "machine", classification: I }],
      textMentions: [CC],
    });
    const r = resolveClassification({ floor, defaultClass: defaultCardClass(floor), declared: G, subject: "card" });
    expect(r.error).toContain("'general' is lower than the records this card comes from");
    expect(r.classification).toBe(CC);
  });
});

describe("interview, document, photo and generated floors", () => {
  it("interview floor is at least internal", () => {
    expect(deriveInterviewFloor({ contextClasses: [], consentLevel: null, textMentions: [] })).toBe(I);
    expect(deriveInterviewFloor({ contextClasses: [], consentLevel: G, textMentions: [] })).toBe(I);
  });

  it("interview floor takes context, consent level and content", () => {
    expect(deriveInterviewFloor({ contextClasses: [CC], consentLevel: null, textMentions: [] })).toBe(CC);
    expect(deriveInterviewFloor({ contextClasses: [CC], consentLevel: EC, textMentions: [] })).toBe(EC);
    expect(deriveInterviewFloor({ contextClasses: [I], consentLevel: I, textMentions: [EC] })).toBe(EC);
    expect(
      deriveInterviewFloor({
        contextClasses: [{ kind: "machine", classification: EC }],
        consentLevel: null,
        textMentions: [{ kind: "person", classification: CC }],
      }),
    ).toBe(I);
  });

  it("document / quiz floor = max of source cards", () => {
    expect(deriveDocumentFloor([])).toBe(G);
    expect(deriveDocumentFloor([I, I])).toBe(I);
    expect(deriveDocumentFloor([I, CC, I])).toBe(CC);
    expect(deriveDocumentFloor([I, EC])).toBe(EC);
    expect(deriveQuizFloor([CC])).toBe(CC);
  });

  it("document extras add linked records and the body scan", () => {
    expect(deriveDocumentFloor([I], { linkedRecordClasses: [EC] })).toBe(EC);
    expect(deriveDocumentFloor([I], { textMentions: [CC] })).toBe(CC);
    expect(deriveDocumentFloor([I], { linkedRecordClasses: [{ kind: "machine", classification: EC }] })).toBe(I);
  });

  it("photo floor is at least internal and uses the machine's recent jobs only when no job is linked", () => {
    expect(derivePhotoFloor({ linkedRecordClasses: [], jobLinked: false })).toBe(I);
    expect(derivePhotoFloor({ linkedRecordClasses: [], jobLinked: false, recentMachineJobClasses: [CC, EC] })).toBe(EC);
    expect(derivePhotoFloor({ linkedRecordClasses: [CC], jobLinked: true, recentMachineJobClasses: [EC] })).toBe(CC);
    expect(derivePhotoFloor({ linkedRecordClasses: [], jobLinked: false, textMentions: [EC] })).toBe(EC);
    expect(deriveCaptureFloor({ linkedRecordClasses: [{ kind: "machine", classification: EC }], jobLinked: false })).toBe(I);
  });

  it("generated outputs inherit max(sent sources, request floor)", () => {
    expect(deriveGeneratedFloor([], G)).toBe(G);
    expect(deriveGeneratedFloor([I, CC], G)).toBe(CC);
    expect(deriveGeneratedFloor([I], EC)).toBe(EC);
  });
});

describe("recomputeOnlyRaises", () => {
  it("never lowers and flags over-classification", () => {
    for (const current of CLASSIFICATIONS) {
      for (const recomputed of CLASSIFICATIONS) {
        const { next, flagOverClassified } = recomputeOnlyRaises(current, recomputed);
        expect(classAtLeast(next, current)).toBe(true);
        expect(classAtLeast(next, recomputed)).toBe(true);
        expect(flagOverClassified).toBe(classBelow(recomputed, current));
      }
    }
  });

  it("examples", () => {
    expect(recomputeOnlyRaises(I, EC)).toEqual({ next: EC, flagOverClassified: false });
    expect(recomputeOnlyRaises(EC, I)).toEqual({ next: EC, flagOverClassified: true });
    expect(recomputeOnlyRaises(CC, CC)).toEqual({ next: CC, flagOverClassified: false });
  });
});
