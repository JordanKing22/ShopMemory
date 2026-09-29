import { describe, expect, it } from "vitest";
import {
  extractNumbers,
  findTermSpans,
  numberSupported,
  numbersEqual,
  parseUnit,
  type NumberMention,
  type NumberUnit,
} from "@/lib/interview/numbers";

/** Extracts and asserts exactly one mention. */
function one(text: string): NumberMention {
  const found = extractNumbers(text);
  expect(found, `numbers in ${JSON.stringify(text)}`).toHaveLength(1);
  return found[0];
}

function m(value: number, unit: NumberUnit | null, extra: Partial<NumberMention> = {}): NumberMention {
  return { value, unit, raw: String(value), start: 0, end: 0, ...extra };
}

describe("extractNumbers — normalization table", () => {
  const table: [string, number, NumberUnit | null][] = [
    // digits
    ["0.040", 0.04, null],
    [".040", 0.04, null],
    ["35", 35, null],
    ["1,800", 1800, null],
    ["58.0", 58, null],
    // number words
    ["four", 4, null],
    ["twenty", 20, null],
    ["thirty-five", 35, null],
    ["thirty five", 35, null],
    ["forty", 40, null],
    ["ten", 10, null],
    ["twelve", 12, null],
    ["three", 3, null],
    ["Four", 4, null],
    ["a hundred and ten", 110, null],
    ["one hundred", 100, null],
    ["two hundred fifty", 250, null],
    ["twelve hundred", 1200, null],
    ["two thousand five hundred", 2500, null],
    ["a thousand", 1000, null],
    // thou → inches
    ["forty thou", 0.04, "in"],
    ["twenty thou", 0.02, "in"],
    ["about four thou", 0.004, "in"],
    ["40 thou", 0.04, "in"],
    ["five thousandths of an inch", 0.005, "in"],
    // percent
    ["thirty-five percent", 35, "%"],
    ["35%", 35, "%"],
    ["35 %", 35, "%"],
    ["35 percent", 35, "%"],
    ["+35 %", 35, "%"],
    // times
    ["about ten times", 10, "x"],
    ["10 times", 10, "x"],
    ["10×", 10, "x"],
    ["10x", 10, "x"],
    // hours
    ["about three more hours", 3, "h"],
    ["3 hours", 3, "h"],
    ["3 h", 3, "h"],
    ["~3 h CMM", 3, "h"],
    ["3h", 3, "h"],
    ["3 hrs", 3, "h"],
    ["a 3-hour job", 3, "h"],
    ["58.0 h", 58, "h"],
    ["one hour", 1, "h"],
    // inches
    ["0.040 in", 0.04, "in"],
    ["0.040in", 0.04, "in"],
    ['0.040"', 0.04, "in"],
    ["1.60 inches", 1.6, "in"],
    ["2 inch", 2, "in"],
    ["four inches", 4, "in"],
    ["leave 0.020 in, unclamp", 0.02, "in"],
    ["a 2 in.", 2, "in"],
  ];
  it.each(table)("%s → %d %s", (text, value, unit) => {
    const n = one(text);
    expect(n.value).toBeCloseTo(value, 12);
    expect(n.unit).toBe(unit);
    expect(text.slice(n.start, n.end)).toBe(n.raw);
  });

  it("parses 'four of the twelve' and '4 of 12' as the same ratio", () => {
    const a = one("four of the twelve failed");
    const b = one("4 of 12 scrapped");
    const c = one("4 out of 12");
    expect(a).toMatchObject({ unit: "ratio", numerator: 4, denominator: 12, raw: "four of the twelve" });
    expect(b).toMatchObject({ unit: "ratio", numerator: 4, denominator: 12, raw: "4 of 12" });
    expect(a.value).toBeCloseTo(4 / 12, 12);
    expect(numbersEqual(a, b)).toBe(true);
    expect(numbersEqual(a, c)).toBe(true);
  });

  it("keeps a preposition 'in' after an integer as a bare number", () => {
    expect(one("3 in titanium")).toMatchObject({ value: 3, unit: null, raw: "3" });
    expect(one("four in April")).toMatchObject({ value: 4, unit: null });
  });

  it("treats 'one' as a number except when it is a pronoun", () => {
    expect(extractNumbers("That one's always.")).toEqual([]);
    expect(extractNumbers("the one on the left")).toEqual([]);
    expect(one("One clamping, rough and finish.")).toMatchObject({ value: 1, unit: null });
    expect(one("in one clamping")).toMatchObject({ value: 1 });
    expect(one("one of the twelve")).toMatchObject({ unit: "ratio", numerator: 1, denominator: 12 });
  });

  it("does not treat identifiers, codes and ordinals as numbers", () => {
    for (const text of [
      "Ti-6Al-4V",
      "AV-2231-07",
      "RJ-26-0310",
      "GDS-4410-120",
      "J-A03",
      "Q-A01",
      "KC-091",
      "INT-LIVE-RAY-T004",
      "m-dmu50",
      "316L",
      "2nd op",
      "the first article",
      "often, tone, someone, anyone",
    ]) {
      expect(extractNumbers(text), text).toEqual([]);
    }
  });

  it("does not treat stray words as number words", () => {
    expect(extractNumbers("a spare blank and the walls")).toEqual([]);
    expect(extractNumbers("every time now")).toEqual([]);
  });

  it("extracts every number in R2 in order", () => {
    const r2 =
      "The duct support bracket in April, while I was out. One clamping, rough and finish. When they unclamped, the walls sprang about four thou and four of the twelve failed profile on the CMM. Aerovance won't take rework without their MRB signing off, so we scrapped them. Now I rough, leave twenty thou, unclamp and let it sit, then finish in soft jaws with light passes. Every time now.";
    const found = extractNumbers(r2);
    expect(found.map((n) => [n.raw, n.value, n.unit])).toEqual([
      ["One", 1, null],
      ["four thou", 0.004, "in"],
      ["four of the twelve", 4 / 12, "ratio"],
      ["twenty thou", 0.02, "in"],
    ]);
    for (const n of found) expect(r2.slice(n.start, n.end)).toBe(n.raw);
  });

  it("extracts every number in R3 and R4", () => {
    const r3 =
      "They take the cycle time the software gives them and stop there. On thin Ti the finish passes run a lot slower, so I add thirty-five percent to finishing. And Aerovance always wants a full first article on every new revision — about three more hours of CMM time and paperwork.";
    expect(extractNumbers(r3).map((n) => [n.raw, n.value, n.unit])).toEqual([
      ["thirty-five percent", 35, "%"],
      ["three more hours", 3, "h"],
    ]);
    const r4 =
      "Close. Under forty thou and taller than about ten times the wall — a short thin wall is fine. Same on Inconel 718. On 6061 I don't bother. That one's always.";
    const terms = ["Inconel 718", "6061"];
    expect(extractNumbers(r4, { skipSpans: findTermSpans(r4, terms) }).map((n) => [n.raw, n.value, n.unit])).toEqual([
      ["forty thou", 0.04, "in"],
      ["ten times", 10, "x"],
    ]);
    // Without protection the material names leak digits.
    expect(extractNumbers(r4).map((n) => n.value)).toEqual([0.04, 10, 718, 6061]);
  });

  it("separates numbers joined by punctuation or 'and'", () => {
    expect(extractNumbers("twenty, four").map((n) => n.value)).toEqual([20, 4]);
    expect(extractNumbers("four thou and four of the twelve").map((n) => n.unit)).toEqual(["in", "ratio"]);
  });

  it("honours skipSpans", () => {
    const text = "Inconel 718 at 35%";
    const spans = findTermSpans(text, ["Inconel 718"]);
    expect(spans).toEqual([{ start: 0, end: 11 }]);
    expect(extractNumbers(text, { skipSpans: spans }).map((n) => n.raw)).toEqual(["35%"]);
  });

  it("returns an empty list for text without numbers", () => {
    expect(extractNumbers("")).toEqual([]);
    expect(extractNumbers("The walls.")).toEqual([]);
  });
});

describe("numbersEqual", () => {
  it("matches spoken and written forms", () => {
    expect(numbersEqual(one("forty thou"), one("0.040 in"))).toBe(true);
    expect(numbersEqual(one("twenty thou"), one("0.020\""))).toBe(true);
    expect(numbersEqual(one("thirty-five percent"), one("35%"))).toBe(true);
    expect(numbersEqual(one("about ten times"), one("10×"))).toBe(true);
    expect(numbersEqual(one("three more hours"), one("3 h"))).toBe(true);
  });

  it("allows a bare number to match a unit-bearing one of the same value", () => {
    expect(numbersEqual(m(35, null), m(35, "%"))).toBe(true);
    expect(numbersEqual(m(3, "h"), m(3, null))).toBe(true);
    expect(numbersEqual(m(0.04, null), m(0.04, "in"))).toBe(true);
  });

  it("rejects different units, different values and bare-vs-thou confusions", () => {
    expect(numbersEqual(m(35, "%"), m(35, "h"))).toBe(false);
    expect(numbersEqual(m(0.04, "in"), m(0.03, "in"))).toBe(false);
    expect(numbersEqual(one("40"), one("forty thou"))).toBe(false);
    expect(numbersEqual(m(10, "x"), m(10, "in"))).toBe(false);
  });

  it("uses a 1e-6 absolute tolerance for inches and a tight relative one elsewhere", () => {
    expect(numbersEqual(m(0.0400004, "in"), m(0.04, "in"))).toBe(true);
    expect(numbersEqual(m(0.041, "in"), m(0.04, "in"))).toBe(false);
    expect(numbersEqual(m(0.1 + 0.2, null), m(0.3, null))).toBe(true);
    expect(numbersEqual(m(35.0001, "%"), m(35, "%"))).toBe(false);
  });

  it("compares ratios by numerator and denominator", () => {
    expect(numbersEqual(one("4 of 12"), one("1 of 3"))).toBe(false);
    expect(numbersEqual(one("4 of 12"), m(4 / 12, null))).toBe(false);
    expect(numbersEqual(m(0.5, "ratio"), m(0.5, "ratio"))).toBe(true);
  });
});

describe("numberSupported", () => {
  const evidence = extractNumbers("the walls sprang about four thou and four of the twelve failed");
  it("backs bare claims with a ratio's numerator or denominator", () => {
    expect(numberSupported(m(4, null), evidence)).toBe(true);
    expect(numberSupported(m(12, null), evidence)).toBe(true);
    expect(numberSupported(m(5, null), evidence)).toBe(false);
  });
  it("does not back a unit-bearing claim with a ratio part", () => {
    expect(numberSupported(m(4, "h"), evidence)).toBe(false);
  });
  it("backs the same ratio and the thou value", () => {
    expect(numberSupported(one("4 of 12"), evidence)).toBe(true);
    expect(numberSupported(one("0.004 in"), evidence)).toBe(true);
    expect(numberSupported(one("0.030 in"), evidence)).toBe(false);
  });
});

describe("parseUnit", () => {
  it("maps aliases, empties and unknowns", () => {
    expect(parseUnit("in")).toBe("in");
    expect(parseUnit("Inches")).toBe("in");
    expect(parseUnit("%")).toBe("%");
    expect(parseUnit("percent")).toBe("%");
    expect(parseUnit("×")).toBe("x");
    expect(parseUnit("hours")).toBe("h");
    expect(parseUnit("ratio")).toBe("ratio");
    expect(parseUnit(null)).toBe(null);
    expect(parseUnit("  ")).toBe(null);
    expect(parseUnit("mm")).toBeUndefined();
  });
});

describe("findTermSpans", () => {
  it("matches case-insensitively on word edges", () => {
    expect(findTermSpans("use 6061-T6 here", ["6061"])).toEqual([{ start: 4, end: 8 }]);
    expect(findTermSpans("part 60610", ["6061"])).toEqual([]);
    expect(findTermSpans("INCONEL  718 and inconel 718", ["Inconel 718"])).toEqual([
      { start: 0, end: 12 },
      { start: 17, end: 28 },
    ]);
    expect(findTermSpans("anything", ["", "  "])).toEqual([]);
  });
  it("handles regex metacharacters in terms", () => {
    expect(findTermSpans("a (Ti) b", ["(Ti)"])).toEqual([{ start: 2, end: 6 }]);
  });
});
