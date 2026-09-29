/**
 * The scripted live interview with Ray (PLAN.md §11.2, step 2) and the four cards it must yield
 * (KC-091…094, topics per Appendix A, links per the §11.2 card table), as plain objects for the
 * pure traceability checks. Turn texts are copied verbatim from PLAN.md §11.2 (a test asserts they
 * still appear there). All wording is fictional placeholder content for SME review.
 */
import type { TraceCard, TraceContext, TraceTurn } from "@/lib/interview/traceability";

export interface RayLiveTurn extends TraceTurn {
  /** Script key from PLAN.md §11.2 (T0, R1, F1, …). */
  key: string;
  /** Interview move for interviewer turns (null for the expert and the wrap-up). */
  move: string | null;
}

const T = (n: number) => `INT-LIVE-RAY-T${String(n).padStart(3, "0")}`;

export const RAY_LIVE_TURNS: readonly RayLiveTurn[] = [
  {
    key: "T0",
    id: T(1),
    speaker: "interviewer",
    move: "ANCHOR",
    text: "Thanks, Ray. You quoted the AV-2231-07 fuel line bracket for Aerovance on Sep 11 at 58 hours for 24 pieces. In one sentence, what drove that number the most?",
  },
  {
    key: "R1",
    id: T(2),
    speaker: "expert",
    move: null,
    text: "The walls. Anything under forty thou in titanium moves on you, so I padded the finish passes, split it into two ops, and priced in a spare blank.",
  },
  {
    key: "F1",
    id: T(3),
    speaker: "interviewer",
    move: "INCIDENT",
    text: "You said titanium under forty thou 'moves on you.' Walk me through the last job where that actually happened.",
  },
  {
    key: "R2",
    id: T(4),
    speaker: "expert",
    move: null,
    text: "The duct support bracket in April, while I was out. One clamping, rough and finish. When they unclamped, the walls sprang about four thou and four of the twelve failed profile on the CMM. Aerovance won't take rework without their MRB signing off, so we scrapped them. Now I rough, leave twenty thou, unclamp and let it sit, then finish in soft jaws with light passes. Every time now.",
  },
  {
    key: "F2",
    id: T(5),
    speaker: "interviewer",
    move: "NOVICE_GAP",
    text: "When a newer quoter picks up a bracket like this, what are they most likely to get wrong?",
  },
  {
    key: "R3",
    id: T(6),
    speaker: "expert",
    move: null,
    text: "They take the cycle time the software gives them and stop there. On thin Ti the finish passes run a lot slower, so I add thirty-five percent to finishing. And Aerovance always wants a full first article on every new revision — about three more hours of CMM time and paperwork.",
  },
  {
    key: "F3",
    id: T(7),
    speaker: "interviewer",
    move: "TEACH_BACK",
    text: "Let me say it back as a rule: anything under forty thou in titanium — add thirty-five percent to finishing, split it into two ops, leave twenty thou, and price in a spare blank, because when they unclamped, the walls sprang. What did I get wrong or leave out?",
  },
  {
    key: "R4",
    id: T(8),
    speaker: "expert",
    move: null,
    text: "Close. Under forty thou and taller than about ten times the wall — a short thin wall is fine. Same on Inconel 718. On 6061 I don't bother. That one's always.",
  },
  {
    key: "T5",
    id: T(9),
    speaker: "interviewer",
    move: "WRAP",
    text: "Got it — I've added the height limit, Inconel 718 and the 6061 exception. I'll draft cards for you to review.",
  },
];

/** Turn id by script key ("R2" → "INT-LIVE-RAY-T004"). */
export function turnId(key: string): string {
  const t = RAY_LIVE_TURNS.find((x) => x.key === key);
  if (!t) throw new Error(`unknown script key ${key}`);
  return t.id;
}

export const RAY_LIVE_CONTEXT: TraceContext = {
  turns: RAY_LIVE_TURNS,
  sessionContext: {
    quoteId: "Q-A01",
    partId: "PRT-A01",
    customerId: "CUS-01",
    machineId: "m-dmu50",
    topicId: "t-thin-wall",
  },
  candidates: [{ kind: "job", id: "J-A03", mention: "duct support bracket in April" }],
  protectedTerms: [
    "Ti-6Al-4V",
    "Inconel 718",
    "6061",
    "AV-2231-07",
    "Aerovance",
    "DMU 50",
    "Q-A01",
    "PRT-A01",
    "CUS-01",
    "J-A03",
    "m-dmu50",
  ],
  recordFacts: {
    materialOf: { "J-A03": "mat-ti64", "Q-A01": "mat-ti64", "PRT-A01": "mat-ti64" },
    topicOfMaterial: { "mat-ti64": "t-mat-ti64", "mat-in718": "t-mat-in718", "mat-6061": "t-mat-6061" },
    topicOfMachine: { "m-dmu50": "t-m-dmu50", "m-vf4": "t-m-vf4" },
    topicOfCustomer: { "CUS-01": "t-cus-01" },
    materialAliases: {
      "mat-ti64": ["Ti", "titanium", "Ti-6Al-4V", "Grade 5"],
      "mat-in718": ["Inconel 718", "Inconel", "IN718"],
      "mat-6061": ["6061", "6061-T6"],
    },
    processTopicTags: {
      "t-thin-wall": ["thin", "wall", "walls", "thin-wall"],
      "t-quoting": ["quote", "quoted", "quoting", "price", "priced", "pricing"],
      "t-fai-cmm": ["first article", "FAI", "CMM"],
    },
  },
};

export const KC_091: TraceCard = {
  id: "KC-091",
  type: "quoting_rule",
  title: "Thin-wall Ti / Inconel 718: add 35% to finishing, two ops, spare blank",
  statement:
    "When a titanium or Inconel 718 wall is under 0.040 in and taller than about 10 times the wall, add 35% to finishing, split it into two ops and price in a spare blank.",
  actions: [
    "Add 35% to the finishing time the software gives you",
    "Pad the finish passes",
    "Split it into two ops",
    "Price in a spare blank",
  ],
  appliesWhen: [
    "Ti-6Al-4V or Inconel 718 walls under 0.040 in (\"under forty thou\")",
    "Wall height more than about 10× the wall thickness",
  ],
  doesNotApplyWhen: ["6061", "A short thin wall"],
  thresholds: [
    { verbatim: "under forty thou", value: 0.04, unit: "in" },
    { verbatim: "taller than about ten times the wall", value: 10, unit: "x" },
    { verbatim: "thirty-five percent", value: 35, unit: "%" },
  ],
  expertConfidence: "always",
  topics: ["t-thin-wall", "t-mat-ti64", "t-quoting"],
  links: [{ kind: "quote", id: "Q-A01", basis: "session_context" }],
  evidence: [
    {
      turnId: T(2),
      quote: "Anything under forty thou in titanium moves on you, so I padded the finish passes, split it into two ops, and priced in a spare blank.",
    },
    { turnId: T(6), quote: "On thin Ti the finish passes run a lot slower, so I add thirty-five percent to finishing." },
    {
      turnId: T(8),
      quote: "Under forty thou and taller than about ten times the wall — a short thin wall is fine. Same on Inconel 718. On 6061 I don't bother.",
    },
    { turnId: T(8), quote: "That one's always.", confidence: true },
  ],
};

export const KC_092: TraceCard = {
  id: "KC-092",
  type: "setup_tip",
  title: "Thin Ti walls: rough, leave 0.020 in, unclamp and rest, finish in soft jaws",
  statement:
    "Don't rough and finish thin titanium walls in one clamping. Rough, leave 0.020 in, unclamp and let it sit, then finish in soft jaws with light passes.",
  actions: [
    "Rough the part",
    "Leave 0.020 in (\"twenty thou\") for finishing",
    "Unclamp and let it sit",
    "Finish in soft jaws with light passes",
  ],
  appliesWhen: ["Thin titanium walls"],
  doesNotApplyWhen: [],
  thresholds: [{ verbatim: "leave twenty thou", value: 0.02, unit: "in" }],
  expertConfidence: "always",
  topics: ["t-thin-wall", "t-mat-ti64", "t-m-dmu50"],
  links: [
    { kind: "machine", id: "m-dmu50", basis: "session_context" },
    { kind: "quote", id: "Q-A01", basis: "session_context" },
  ],
  evidence: [
    { turnId: T(4), quote: "One clamping, rough and finish. When they unclamped, the walls sprang" },
    { turnId: T(4), quote: "Now I rough, leave twenty thou, unclamp and let it sit, then finish in soft jaws with light passes." },
    { turnId: T(4), quote: "Every time now.", confidence: true },
  ],
};

export const KC_093: TraceCard = {
  id: "KC-093",
  type: "customer_quirk",
  title: "Aerovance: full first article on every new revision (~3 h CMM + paperwork); no rework without their MRB",
  statement:
    "Aerovance always wants a full first article on every new revision, which adds about 3 hours of CMM time and paperwork. They won't take rework without their MRB signing off, so nonconforming parts get scrapped.",
  actions: [
    "Add about 3 hours of CMM time and paperwork for every new revision",
    "Scrap nonconforming parts instead of reworking them unless their MRB signs off",
  ],
  appliesWhen: ["Any new revision of an Aerovance part"],
  doesNotApplyWhen: [],
  thresholds: [{ verbatim: "about three more hours", value: 3, unit: "h" }],
  expertConfidence: "always",
  topics: ["t-cus-01", "t-fai-cmm"],
  links: [{ kind: "customer", id: "CUS-01", basis: "session_context" }],
  evidence: [
    {
      turnId: T(6),
      quote: "Aerovance always wants a full first article on every new revision — about three more hours of CMM time and paperwork.",
    },
    { turnId: T(6), quote: "always wants", confidence: true },
    { turnId: T(4), quote: "Aerovance won't take rework without their MRB signing off, so we scrapped them." },
  ],
};

export const KC_094: TraceCard = {
  id: "KC-094",
  type: "failure_story",
  title: "Duct support bracket in April: walls sprang about 0.004 in after unclamping; 4 of 12 scrapped",
  statement:
    "On the duct support bracket in April the parts were roughed and finished in one clamping. When they were unclamped the walls sprang about 0.004 in and four of the twelve failed profile on the CMM. Aerovance won't take rework without their MRB signing off, so they were scrapped.",
  actions: ["Rough, unclamp and let it sit before finishing instead of roughing and finishing in one clamping"],
  appliesWhen: ["Thin walls roughed and finished in one clamping"],
  doesNotApplyWhen: [],
  thresholds: [{ verbatim: "about four thou", value: 0.004, unit: "in" }],
  expertConfidence: "not_stated",
  topics: ["t-thin-wall", "t-mat-ti64", "t-cus-01"],
  links: [
    { kind: "job", id: "J-A03", basis: "mentioned_candidate", mention: "duct support bracket in April" },
    { kind: "customer", id: "CUS-01", basis: "session_context" },
  ],
  evidence: [
    { turnId: T(4), quote: "The duct support bracket in April, while I was out. One clamping, rough and finish." },
    {
      turnId: T(4),
      quote: "When they unclamped, the walls sprang about four thou and four of the twelve failed profile on the CMM.",
    },
    { turnId: T(4), quote: "Aerovance won't take rework without their MRB signing off, so we scrapped them." },
    { turnId: T(4), quote: "Now I rough, leave twenty thou, unclamp and let it sit" },
  ],
};

/** The four scripted cards in ID order. */
export const RAY_LIVE_CARDS: readonly TraceCard[] = [KC_091, KC_092, KC_093, KC_094];

/** Appendix A topics per scripted card (the golden coverage numbers depend on exactly these). */
export const RAY_LIVE_EXPECTED_TOPICS: Readonly<Record<string, readonly string[]>> = {
  "KC-091": ["t-thin-wall", "t-mat-ti64", "t-quoting"],
  "KC-092": ["t-thin-wall", "t-mat-ti64", "t-m-dmu50"],
  "KC-093": ["t-cus-01", "t-fai-cmm"],
  "KC-094": ["t-thin-wall", "t-mat-ti64", "t-cus-01"],
};
