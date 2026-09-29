import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkCard,
  checkLinkRules,
  CONFIDENCE_PHRASES,
  MAX_TOPICS,
  type TraceCard,
  type TraceContext,
  type TraceErrorCode,
} from "@/lib/interview/traceability";
import {
  KC_091,
  KC_092,
  KC_093,
  KC_094,
  RAY_LIVE_CARDS,
  RAY_LIVE_CONTEXT,
  RAY_LIVE_EXPECTED_TOPICS,
  RAY_LIVE_TURNS,
  turnId,
} from "./fixtures/ray-live";

const ctx = RAY_LIVE_CONTEXT;
const codes = (card: TraceCard, c: TraceContext = ctx): TraceErrorCode[] => checkCard(card, c).errors.map((e) => e.code);
const edit = (card: TraceCard, patch: Partial<TraceCard>): TraceCard => ({ ...card, ...patch });

describe("ray-live fixture", () => {
  it("copies the §11.2 turns verbatim from PLAN.md", () => {
    const plan = readFileSync(path.join(process.cwd(), "PLAN.md"), "utf8");
    for (const t of RAY_LIVE_TURNS) {
      expect(plan.includes(`| "${t.text}" |`), `${t.key} is verbatim in PLAN.md §11.2`).toBe(true);
    }
  });

  it("numbers the turns T001…T009 with the scripted speakers", () => {
    expect(RAY_LIVE_TURNS.map((t) => [t.key, t.id, t.speaker])).toEqual([
      ["T0", "INT-LIVE-RAY-T001", "interviewer"],
      ["R1", "INT-LIVE-RAY-T002", "expert"],
      ["F1", "INT-LIVE-RAY-T003", "interviewer"],
      ["R2", "INT-LIVE-RAY-T004", "expert"],
      ["F2", "INT-LIVE-RAY-T005", "interviewer"],
      ["R3", "INT-LIVE-RAY-T006", "expert"],
      ["F3", "INT-LIVE-RAY-T007", "interviewer"],
      ["R4", "INT-LIVE-RAY-T008", "expert"],
      ["T5", "INT-LIVE-RAY-T009", "interviewer"],
    ]);
  });

  it("pins the Appendix A topics, §11.2 types/confidence and links", () => {
    for (const card of RAY_LIVE_CARDS) expect(card.topics).toEqual(RAY_LIVE_EXPECTED_TOPICS[card.id]);
    expect(RAY_LIVE_CARDS.map((c) => [c.id, c.type, c.expertConfidence])).toEqual([
      ["KC-091", "quoting_rule", "always"],
      ["KC-092", "setup_tip", "always"],
      ["KC-093", "customer_quirk", "always"],
      ["KC-094", "failure_story", "not_stated"],
    ]);
    expect(RAY_LIVE_CARDS.map((c) => c.links.map((l) => `${l.kind}:${l.id}:${l.basis}`))).toEqual([
      ["quote:Q-A01:session_context"],
      ["machine:m-dmu50:session_context", "quote:Q-A01:session_context"],
      ["customer:CUS-01:session_context"],
      ["job:J-A03:mentioned_candidate", "customer:CUS-01:session_context"],
    ]);
  });

  it("marks the scripted confidence spans", () => {
    const spans = (c: TraceCard) => c.evidence.filter((e) => e.confidence).map((e) => [e.turnId, e.quote]);
    expect(spans(KC_091)).toEqual([[turnId("R4"), "That one's always."]]);
    expect(spans(KC_092)).toEqual([[turnId("R2"), "Every time now."]]);
    expect(spans(KC_093)).toEqual([[turnId("R3"), "always wants"]]);
  });
});

describe("checkCard — the four scripted cards", () => {
  it.each(RAY_LIVE_CARDS.map((c) => [c.id, c] as const))("%s passes with zero errors", (_id, card) => {
    const res = checkCard(card, ctx);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it.each(RAY_LIVE_CARDS.map((c) => [c.id, c] as const))("%s passes the §7.3 link rules", (_id, card) => {
    expect(checkLinkRules(card)).toEqual([]);
  });

  it("also passes with the live-gate setting (no seed-basis links)", () => {
    for (const card of RAY_LIVE_CARDS) expect(codes(card, { ...ctx, allowSeedBasis: false })).toEqual([]);
  });
});

describe("checkCard — evidence", () => {
  it("rejects a card with no evidence", () => {
    expect(codes(edit(KC_094, { evidence: [] }))).toContain("evidence_missing");
  });

  it("rejects a quote that is not an exact substring", () => {
    const card = edit(KC_092, {
      evidence: [...KC_092.evidence, { turnId: turnId("R2"), quote: "leave twenty thou and unclamp it" }],
    });
    const res = checkCard(card, ctx);
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.code)).toEqual(["evidence_not_substring"]);
    expect(res.errors[0].detail).toBe("evidence[3]");
  });

  it("rejects a quote whose case or punctuation differs", () => {
    const card = edit(KC_092, { evidence: [{ turnId: turnId("R2"), quote: "every time now." }, ...KC_092.evidence] });
    expect(codes(card)).toEqual(["evidence_not_substring"]);
  });

  it("rejects an empty quote", () => {
    expect(codes(edit(KC_092, { evidence: [...KC_092.evidence, { turnId: turnId("R2"), quote: "  " }] }))).toEqual([
      "evidence_not_substring",
    ]);
  });

  it("rejects evidence on an interviewer turn (the teach-back is not the expert)", () => {
    const card = edit(KC_091, {
      evidence: [...KC_091.evidence, { turnId: turnId("F3"), quote: "add thirty-five percent to finishing" }],
    });
    expect(codes(card)).toEqual(["evidence_not_expert"]);
  });

  it("rejects evidence citing a turn that isn't in the session", () => {
    expect(codes(edit(KC_094, { evidence: [...KC_094.evidence, { turnId: "INT-01-T001", quote: "anything" }] }))).toEqual([
      "evidence_not_expert",
    ]);
  });

  it("does not let an interviewer-only quote support numbers", () => {
    // Only F3 cited: the evidence is invalid, so none of the card's numbers are backed.
    const card = edit(KC_091, {
      evidence: [{ turnId: turnId("F3"), quote: "add thirty-five percent to finishing, split it into two ops" }],
      thresholds: [],
      expertConfidence: "not_stated",
    });
    const c = codes(card);
    expect(c).toContain("evidence_not_expert");
    expect(c).toContain("number_unsupported");
  });

  it("keeps transcript text out of error messages", () => {
    const secret = "leave twenty thou and unclamp it";
    const res = checkCard(edit(KC_092, { evidence: [{ turnId: turnId("R2"), quote: secret }] }), ctx);
    for (const e of res.errors) {
      expect(e.message).not.toContain(secret);
      expect(e.message).not.toContain("duct support bracket");
    }
  });
});

describe("checkCard — numeric claims", () => {
  it("rejects an invented '0.030 in' in the statement", () => {
    const res = checkCard(edit(KC_092, { statement: `${KC_092.statement} Leave 0.030 in on the floor.` }), ctx);
    expect(res.errors.map((e) => e.code)).toEqual(["number_unsupported"]);
    expect(res.errors[0].message).toContain("0.030 in");
    expect(res.errors[0].detail).toBe("statement");
  });

  it("rejects invented numbers in title, actions and conditions", () => {
    expect(codes(edit(KC_091, { title: "Thin-wall Ti: add 40% to finishing" }))).toEqual(["number_unsupported"]);
    expect(codes(edit(KC_091, { actions: [...KC_091.actions, "Split it into three ops"] }))).toEqual(["number_unsupported"]);
    expect(codes(edit(KC_091, { appliesWhen: ["Walls taller than about 12× the wall"] }))).toEqual(["number_unsupported"]);
    expect(codes(edit(KC_091, { doesNotApplyWhen: ["Walls under 0.5 in tall"] }))).toEqual(["number_unsupported"]);
  });

  it("rejects a wrong unit for a spoken number", () => {
    expect(codes(edit(KC_093, { statement: "Aerovance adds about 3% for every new revision." }))).toEqual(["number_unsupported"]);
  });

  it("uses the evidence quotes, not the whole cited turn", () => {
    // R2 says "about four thou", but none of KC-092's quotes contain it.
    expect(codes(edit(KC_092, { statement: `${KC_092.statement} Walls can spring about 0.004 in.` }))).toEqual([
      "number_unsupported",
    ]);
  });

  it("accepts spoken-form equivalents and ratio parts", () => {
    const card = edit(KC_094, {
      statement: "Walls sprang about four thou (0.004 in); 4 of 12 failed, so 4 parts out of a lot of 12 were scrapped.",
    });
    expect(codes(card)).toEqual([]);
  });

  it("ignores digits inside Ti-6Al-4V, Inconel 718 and AV-2231-07", () => {
    const card = edit(KC_092, {
      statement: `${KC_092.statement} Written for Ti-6Al-4V on AV-2231-07; Inconel 718 is a separate interview.`,
    });
    expect(codes(card)).toEqual([]);
    // Without the protected-term list, "718" becomes an unsupported claim (Ti-6Al-4V and AV-2231-07
    // stay identifiers either way).
    const res = checkCard(card, { ...ctx, protectedTerms: [] });
    expect(res.errors.map((e) => e.code)).toEqual(["number_unsupported"]);
    expect(res.errors[0].message).toContain('"718"');
  });

  it("does not let protected digits in the evidence vouch for a claim", () => {
    // R4 (cited by KC-091) contains "Inconel 718" and "6061"; a claim of 718 hours must still fail.
    expect(codes(edit(KC_091, { actions: [...KC_091.actions, "Budget 718 hours"] }))).toEqual(["number_unsupported"]);
  });
});

describe("checkCard — thresholds", () => {
  it("rejects a verbatim that isn't in a cited turn", () => {
    const card = edit(KC_092, { thresholds: [...KC_092.thresholds, { verbatim: "about ten times the wall", value: 10, unit: "x" }] });
    expect(codes(card)).toEqual(["threshold_verbatim_missing"]);
  });

  it("rejects a value that doesn't match its verbatim", () => {
    expect(codes(edit(KC_092, { thresholds: [{ verbatim: "leave twenty thou", value: 0.03, unit: "in" }] }))).toEqual([
      "number_unsupported",
    ]);
    expect(codes(edit(KC_092, { thresholds: [{ verbatim: "leave twenty thou", value: 20, unit: null }] }))).toEqual([
      "number_unsupported",
    ]);
  });

  it("accepts unit aliases and non-numeric thresholds, rejects unknown units", () => {
    expect(codes(edit(KC_093, { thresholds: [{ verbatim: "about three more hours", value: 3, unit: "hours" }] }))).toEqual([]);
    expect(codes(edit(KC_093, { thresholds: [{ verbatim: "every new revision", value: null, unit: null }] }))).toEqual([]);
    expect(codes(edit(KC_093, { thresholds: [{ verbatim: "about three more hours", value: 3, unit: "shifts" }] }))).toEqual([
      "number_unsupported",
    ]);
  });
});

describe("checkCard — links", () => {
  it("rejects a machine link to m-vf4 claimed as session context", () => {
    const res = checkCard(edit(KC_092, { links: [...KC_092.links, { kind: "machine", id: "m-vf4", basis: "session_context" }] }), ctx);
    expect(res.errors.map((e) => e.code)).toEqual(["link_unsupported"]);
    expect(res.errors[0].message).toContain("m-vf4");
  });

  it("requires the session slot of the same kind", () => {
    expect(codes(edit(KC_091, { links: [{ kind: "part", id: "Q-A01", basis: "session_context" }] }))).toContain("link_unsupported");
    expect(codes(edit(KC_091, { links: [...KC_091.links, { kind: "part", id: "PRT-A01", basis: "session_context" }] }))).toEqual([]);
  });

  it("rejects a mentioned record that wasn't sent as a candidate", () => {
    const card = edit(KC_094, {
      links: [...KC_094.links, { kind: "job", id: "J-A02", basis: "mentioned_candidate", mention: "duct support bracket in April" }],
    });
    expect(codes(card)).toEqual(["link_unsupported"]);
  });

  it("rejects a candidate whose mention isn't in an expert turn", () => {
    const c = { ...ctx, candidates: [{ kind: "job" as const, id: "J-A03", mention: "duct bracket from April" }] };
    // The rejected J-A03 link no longer supports the Ti topic either.
    expect(codes(KC_094, c)).toEqual(["link_unsupported", "topic_unsupported"]);
  });

  it("rejects a candidate mentioned only by the interviewer", () => {
    const c = { ...ctx, candidates: [{ kind: "job" as const, id: "J-A03", mention: "fuel line bracket" }] };
    const card = edit(KC_094, { links: [{ kind: "job", id: "J-A03", basis: "mentioned_candidate" }, KC_094.links[1]] });
    expect(codes(card, c)).toEqual(["link_unsupported", "topic_unsupported"]);
  });

  it("rejects a link mention that isn't in an expert turn", () => {
    const card = edit(KC_094, {
      links: [{ kind: "job", id: "J-A03", basis: "mentioned_candidate", mention: "the April job" }, KC_094.links[1]],
    });
    expect(codes(card)).toEqual(["link_unsupported", "topic_unsupported"]);
  });

  it("accepts seed-basis links unless the live gate turns them off", () => {
    const card = edit(KC_091, { links: [...KC_091.links, { kind: "job", id: "J-A02", basis: "seed" }] });
    expect(codes(card)).toEqual([]);
    expect(codes(card, { ...ctx, allowSeedBasis: false })).toEqual(["link_unsupported"]);
  });
});

describe("checkCard — topics", () => {
  it("rejects t-mat-in718 on KC-094 (Inconel isn't in R2 and J-A03 is Ti)", () => {
    const res = checkCard(edit(KC_094, { topics: ["t-thin-wall", "t-mat-ti64", "t-mat-in718"] }), ctx);
    expect(res.errors.map((e) => e.code)).toEqual(["topic_unsupported"]);
    expect(res.errors[0].message).toContain("t-mat-in718");
  });

  it("supports KC-094's Ti topic only through J-A03's material", () => {
    const withoutJob = edit(KC_094, { links: [KC_094.links[1]] });
    expect(codes(withoutJob)).toEqual(["topic_unsupported"]);
    expect(checkLinkRules(withoutJob)).toHaveLength(1);
  });

  it("rejects more than three topics", () => {
    expect(MAX_TOPICS).toBe(3);
    const card = edit(KC_091, { topics: [...KC_091.topics, "t-mat-in718"] });
    expect(codes(card)).toEqual(["too_many_topics"]);
  });

  it("supports a material topic by a mention in the card or evidence", () => {
    expect(codes(edit(KC_091, { topics: ["t-thin-wall", "t-mat-in718", "t-quoting"] }))).toEqual([]);
  });

  it("needs a customer link for a customer topic", () => {
    const card = edit(KC_093, { links: [] });
    expect(codes(card)).toEqual(["topic_unsupported"]);
    expect(checkLinkRules(card)).toEqual(["Card KC-093 (customer_quirk) must link a customer."]);
  });

  it("needs a machine link for a machine topic (session context alone isn't enough)", () => {
    expect(codes(edit(KC_092, { links: [KC_092.links[1]] }))).toEqual(["topic_unsupported"]);
  });

  it("supports a process topic by a tag word or the session topic", () => {
    const noSessionTopic: TraceContext = { ...ctx, sessionContext: { ...ctx.sessionContext, topicId: undefined } };
    expect(codes(KC_094, noSessionTopic)).toEqual([]); // "walls" is a thin-wall tag
    expect(codes(edit(KC_094, { topics: ["t-thin-wall", "t-quoting"] }))).toEqual(["topic_unsupported"]);
  });

  it("rejects an unknown topic", () => {
    expect(codes(edit(KC_093, { topics: ["t-cus-01", "t-made-up"] }))).toEqual(["topic_unsupported"]);
  });
});

describe("checkCard — confidence", () => {
  it("rejects 'always' on KC-093 without a confidence evidence span", () => {
    const card = edit(KC_093, { evidence: KC_093.evidence.map((e) => ({ ...e, confidence: false })) });
    expect(codes(card)).toEqual(["confidence_unsupported"]);
  });

  it("rejects a confidence span that states a different level", () => {
    expect(codes(edit(KC_091, { expertConfidence: "usually" }))).toEqual(["confidence_unsupported"]);
    expect(codes(edit(KC_092, { expertConfidence: "sometimes" }))).toEqual(["confidence_unsupported"]);
  });

  it("rejects a flagged span without a confidence phrase", () => {
    const card = edit(KC_093, {
      evidence: [
        { ...KC_093.evidence[0], confidence: false },
        { turnId: turnId("R3"), quote: "Aerovance", confidence: true },
        KC_093.evidence[2],
      ],
    });
    expect(codes(card)).toEqual(["confidence_unsupported"]);
  });

  it("accepts not_stated without a span and exempts failure stories", () => {
    expect(codes(edit(KC_093, { expertConfidence: "not_stated" }))).toEqual([]);
    expect(codes(edit(KC_094, { expertConfidence: "always" }))).toEqual([]);
  });

  it("lists phrases for every stated level", () => {
    expect(Object.keys(CONFIDENCE_PHRASES).sort()).toEqual(["always", "not_sure", "sometimes", "usually"]);
    expect(CONFIDENCE_PHRASES.always).toEqual(expect.arrayContaining(["always", "every time"]));
    expect(CONFIDENCE_PHRASES.usually).toEqual(expect.arrayContaining(["usually", "most of the time"]));
    expect(CONFIDENCE_PHRASES.sometimes).toEqual(expect.arrayContaining(["sometimes", "depends"]));
  });
});

describe("checkCard — several errors at once", () => {
  it("reports every broken rule", () => {
    const card = edit(KC_092, {
      statement: "Leave 0.030 in.",
      links: [{ kind: "machine", id: "m-vf4", basis: "session_context" }, KC_092.links[1]],
      evidence: [{ turnId: turnId("R2"), quote: "Now I rough, leave twenty thou" }],
      topics: ["t-thin-wall", "t-mat-ti64", "t-m-dmu50", "t-mat-in718"],
    });
    const c = codes(card);
    expect(c).toEqual(
      expect.arrayContaining([
        "number_unsupported",
        "link_unsupported",
        "too_many_topics",
        "topic_unsupported",
        "confidence_unsupported",
      ]),
    );
    expect(checkCard(card, ctx).ok).toBe(false);
  });
});

describe("checkLinkRules (PLAN.md §7.3)", () => {
  it("requires a job or quote on rules, setup tips, failure stories and inspection gotchas", () => {
    for (const type of ["quoting_rule", "failure_story", "inspection_gotcha"] as const) {
      expect(checkLinkRules({ type, links: [{ kind: "customer" }] })).toEqual([`Card (${type}) must link at least one job or quote.`]);
      expect(checkLinkRules({ type, links: [{ kind: "job" }] })).toEqual([]);
      expect(checkLinkRules({ type, links: [{ kind: "quote" }] })).toEqual([]);
    }
  });

  it("requires a machine on setup tips and machine quirks", () => {
    expect(checkLinkRules({ id: "KC-200", type: "setup_tip", links: [{ kind: "job" }] })).toEqual([
      "Card KC-200 (setup_tip) must link a machine.",
    ]);
    expect(checkLinkRules({ type: "setup_tip", links: [] })).toHaveLength(2);
    expect(checkLinkRules({ type: "machine_quirk", links: [] })).toEqual(["Card (machine_quirk) must link a machine."]);
    expect(checkLinkRules({ type: "machine_quirk", links: [{ kind: "machine" }] })).toEqual([]);
  });

  it("requires a customer on customer quirks and allows generic quirks without a job", () => {
    expect(checkLinkRules({ type: "customer_quirk", links: [{ kind: "job" }] })).toEqual([
      "Card (customer_quirk) must link a customer.",
    ]);
    expect(checkLinkRules({ type: "customer_quirk", links: [{ kind: "customer" }] })).toEqual([]);
  });
});
