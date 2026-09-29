/**
 * PLAN.md Appendix A — the exact inputs behind the §6 golden numbers, encoded for tests.
 * Fictional data. If you change anything here, PLAN.md §6 / Appendix A must change with it.
 *
 * Card confidences the appendix leaves unstated (failure stories, the two pending cards) are chosen
 * here; they do not affect the numbers (failure stories always weigh 1.0; pending cards never count).
 */
import type { CoverageCard, CoverageExpertise, CoverageInput, CoveragePerson, CoverageTopic } from "@/lib/coverage/compute";
import type { ExpertiseLevel } from "@/lib/coverage/params";

export const DEMO_TODAY = "2026-09-15";

/** Person IDs in matrix column order: R Ray · M Marv · L Linda · T Tomás · Y Maya · D Devin · P Priya · J Jonah. */
export const PERSON_IDS = ["PER-01", "PER-02", "PER-03", "PER-04", "PER-05", "PER-06", "PER-07", "PER-08"] as const;
export type PersonId = (typeof PERSON_IDS)[number];

export const RAY = "PER-01";
export const MARV = "PER-02";
export const LINDA = "PER-03";
export const TOMAS = "PER-04";
export const MAYA = "PER-05";
export const DEVIN = "PER-06";
export const PRIYA = "PER-07";
export const JONAH = "PER-08";

export const PERSON_NAMES: Readonly<Record<PersonId, string>> = {
  "PER-01": "Ray",
  "PER-02": "Marv",
  "PER-03": "Linda",
  "PER-04": "Tomás",
  "PER-05": "Maya",
  "PER-06": "Devin",
  "PER-07": "Priya",
  "PER-08": "Jonah",
};

export const PEOPLE: CoveragePerson[] = [
  { id: RAY, hireDate: "1995-06-05", plannedDepartureDate: "2028-05-15" },
  { id: MARV, hireDate: "2000-08-14", plannedDepartureDate: null },
  { id: LINDA, hireDate: "2004-03-01", plannedDepartureDate: "2029-11-15" },
  { id: TOMAS, hireDate: "1999-01-11", plannedDepartureDate: "2031-01-15" },
  { id: MAYA, hireDate: "2026-01-12", plannedDepartureDate: null },
  { id: DEVIN, hireDate: "2026-03-09", plannedDepartureDate: null },
  { id: PRIYA, hireDate: "2025-10-13", plannedDepartureDate: null },
  { id: JONAH, hireDate: "2025-07-14", plannedDepartureDate: null },
];

type Row = readonly [ExpertiseLevel, ExpertiseLevel, ExpertiseLevel, ExpertiseLevel, ExpertiseLevel, ExpertiseLevel, ExpertiseLevel, ExpertiseLevel];

/** The 28 × 8 matrix, rows in Appendix A order, columns in {@link PERSON_IDS} order. */
export const EXPERTISE_MATRIX: ReadonlyArray<readonly [string, Row]> = [
  ["t-thin-wall", [3, 1, 1, 0, 0, 0, 0, 0]],
  ["t-quoting", [3, 1, 0, 2, 1, 0, 0, 0]],
  ["t-5ax-workholding", [2, 3, 0, 0, 0, 1, 0, 1]],
  ["t-tight-tol", [2, 2, 2, 2, 0, 0, 1, 0]],
  ["t-fai-cmm", [1, 1, 3, 0, 0, 0, 2, 0]],
  ["t-outside-proc", [2, 0, 2, 1, 1, 0, 0, 0]],
  ["t-cam", [1, 2, 0, 1, 0, 0, 0, 2]],
  ["t-m-vf4", [1, 2, 0, 1, 0, 1, 0, 1]],
  ["t-m-st20", [0, 0, 0, 2, 0, 1, 0, 1]],
  ["t-m-dmu50", [2, 3, 0, 0, 0, 0, 0, 1]],
  ["t-m-genos", [1, 2, 0, 0, 0, 1, 0, 1]],
  ["t-m-integrex", [1, 1, 0, 3, 0, 0, 0, 2]],
  ["t-m-swiss", [0, 0, 0, 3, 0, 1, 0, 2]],
  ["t-m-cmm", [0, 0, 3, 0, 0, 0, 2, 0]],
  ["t-m-wedm", [1, 2, 0, 1, 0, 0, 0, 0]],
  ["t-mat-6061", [2, 2, 1, 2, 1, 1, 1, 1]],
  ["t-mat-7075", [2, 2, 1, 1, 1, 1, 0, 1]],
  ["t-mat-174ph", [2, 2, 1, 2, 0, 0, 0, 1]],
  ["t-mat-316", [1, 1, 1, 2, 0, 1, 0, 1]],
  ["t-mat-ti64", [3, 1, 0, 0, 0, 0, 0, 1]],
  ["t-mat-in718", [3, 1, 0, 2, 0, 0, 0, 0]],
  ["t-mat-peek", [1, 1, 0, 2, 0, 0, 0, 1]],
  ["t-cus-01", [3, 1, 2, 0, 1, 0, 1, 0]], // Aerovance
  ["t-cus-02", [2, 2, 2, 1, 0, 0, 0, 0]], // Halvorsen
  ["t-cus-03", [1, 0, 2, 2, 1, 0, 1, 1]], // Sutrella
  ["t-cus-04", [1, 2, 1, 0, 1, 1, 0, 1]], // Quantrel
  ["t-cus-05", [2, 2, 2, 1, 0, 0, 0, 0]], // Graymoor
  ["t-cus-06", [2, 1, 1, 1, 0, 0, 0, 0]], // Velmont
];

export const TOPIC_IDS: readonly string[] = EXPERTISE_MATRIX.map(([id]) => id);

export const TOPICS: CoverageTopic[] = TOPIC_IDS.map((id) => ({ id }));

/** Flattened matrix, level-0 pairs included (the engine treats missing and 0 alike). */
export const EXPERTISE: CoverageExpertise[] = EXPERTISE_MATRIX.flatMap(([topicId, row]) =>
  row.map((level, i) => ({ personId: PERSON_IDS[i], topicId, level })),
);

/** Short topic names used in the Appendix A card table → topic IDs. */
export const SHORT_TOPIC: Readonly<Record<string, string>> = {
  "thin-wall": "t-thin-wall",
  ti64: "t-mat-ti64",
  quoting: "t-quoting",
  dmu50: "t-m-dmu50",
  "cus-01": "t-cus-01",
  "fai-cmm": "t-fai-cmm",
  in718: "t-mat-in718",
  "174ph": "t-mat-174ph",
  "outside-proc": "t-outside-proc",
  "cus-02": "t-cus-02",
  "cus-06": "t-cus-06",
  genos: "t-m-genos",
  "7075": "t-mat-7075",
  "6061": "t-mat-6061",
  "cus-04": "t-cus-04",
  wedm: "t-m-wedm",
  "cus-05": "t-cus-05",
};

function card(
  id: string,
  sourcePersonId: string,
  type: CoverageCard["type"],
  confidence: CoverageCard["confidence"],
  shortTopics: string[],
  status: CoverageCard["status"] = "approved",
): CoverageCard {
  const topicIds = shortTopics.map((s) => {
    const t = SHORT_TOPIC[s];
    if (!t) throw new Error(`Unknown short topic ${s}`);
    return t;
  });
  return { id, sourcePersonId, type, confidence, status, topicIds };
}

/** Seeded cards before demo step 2 (approved unless noted). */
export const BEFORE_CARDS: CoverageCard[] = [
  card("KC-001", RAY, "quoting_rule", "usually", ["thin-wall", "ti64", "quoting"]),
  card("KC-002", RAY, "setup_tip", "always", ["thin-wall", "ti64", "dmu50"]),
  card("KC-003", RAY, "customer_quirk", "always", ["cus-01", "fai-cmm"]),
  card("KC-004", RAY, "quoting_rule", "usually", ["in718", "quoting"]),
  card("KC-005", RAY, "failure_story", "not_stated", ["174ph", "outside-proc", "cus-02"]),
  card("KC-006", RAY, "quoting_rule", "usually", ["cus-06", "quoting"]), // export_controlled, from INT-02
  card("KC-007", RAY, "machine_quirk", "always", ["genos"]),
  card("KC-008", RAY, "quoting_rule", "sometimes", ["7075", "quoting", "cus-01"]),
  card("KC-009", RAY, "setup_tip", "always", ["6061", "cus-04"]),
  card("KC-010", RAY, "quoting_rule", "always", ["outside-proc", "quoting"]),
  card("KC-011", RAY, "machine_quirk", "always", ["wedm"], "pending_review"),
  card("KC-012", RAY, "customer_quirk", "usually", ["cus-05"], "pending_review"),
  card("KC-021", MARV, "failure_story", "not_sure", ["ti64"]),
  card("KC-034", LINDA, "inspection_gotcha", "always", ["thin-wall"]),
];

/** The four cards Ray approves at the end of scripted step 2 (all approved). */
export const SCRIPTED_CARDS: CoverageCard[] = [
  card("KC-091", RAY, "quoting_rule", "always", ["thin-wall", "ti64", "quoting"]),
  card("KC-092", RAY, "setup_tip", "always", ["thin-wall", "ti64", "dmu50"]),
  card("KC-093", RAY, "customer_quirk", "always", ["cus-01", "fai-cmm"]),
  card("KC-094", RAY, "failure_story", "not_stated", ["thin-wall", "ti64", "cus-01"]),
];

/** Appendix A as a coverage input; pass extra cards (e.g. {@link SCRIPTED_CARDS}) to append. */
export function appendixAInput(extraCards: CoverageCard[] = []): CoverageInput {
  return {
    demoToday: DEMO_TODAY,
    people: PEOPLE.map((p) => ({ ...p })),
    topics: TOPICS.map((t) => ({ ...t })),
    expertise: EXPERTISE.map((e) => ({ ...e })),
    cards: [...BEFORE_CARDS, ...extraCards].map((c) => ({ ...c, topicIds: [...c.topicIds] })),
  };
}
