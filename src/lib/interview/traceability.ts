/**
 * Pure traceability checks for knowledge cards (PLAN.md §8.2 "Traceability gate", §7.3 link
 * rules, §7.5 seed:check). Shared by `seed:check` (seeded and scripted cards) and, from Phase 5,
 * the live gate after `card_extract`. The gate rejects; it never warns.
 *
 * Everything here works on plain objects: no DB, no I/O, no clock. The caller loads the session
 * turns, the session context, the candidate records it sent, and the record facts (materials of
 * jobs/parts/quotes, topic mappings, aliases, process tags) from the seed/DB and passes them in.
 *
 * Rules implemented by `checkCard`:
 * 1. Evidence — at least one item; each quote is a non-empty exact substring of the cited turn,
 *    and that turn is an **expert** turn of this session.
 * 2. Thresholds — `verbatim` is an exact substring of the text of a turn cited by valid evidence;
 *    a non-null `value` must equal a number spoken in that verbatim (unit strings go through
 *    `parseUnit`; an unknown unit is rejected).
 * 3. Numeric claims — numbers in title, statement, actions, applies-when and does-not-apply-when
 *    (ignoring digits inside `protectedTerms`) must each be backed by a number in the cited
 *    evidence **quotes** (not the whole turn: the quote is what the reviewer sees next to the card,
 *    and it keeps a number said elsewhere in a long turn from vouching for a claim).
 * 4. Links — `session_context`: the id equals the session slot of the same kind (quote, part,
 *    customer, machine, job). `mentioned_candidate`: the record was sent as a candidate of the same
 *    kind, its candidate mention is an exact substring of an expert turn, and the link's own
 *    `mention` (when given) is one too. `seed`: allowed unless `ctx.allowSeedBasis === false`
 *    (the live gate passes false so a model can't claim seed provenance).
 * 5. Topics — at most `MAX_TOPICS`; each must be supported (only links that passed rule 4 count):
 *    material topic ← a material alias in the card text or evidence quotes, or a linked
 *    job/part/quote whose material maps to it (or a direct material link); customer topic ← a
 *    customer link; machine topic ← a machine link (session-context links count; the bare session
 *    context without a link does not); process topic ← one of its tag words in the card text or
 *    evidence quotes, or it is the session topic. A topic no mapping knows is unsupported.
 * 6. Confidence — anything but `not_stated` needs a valid evidence item flagged `confidence: true`
 *    whose quote contains a phrase stating **that** level (`CONFIDENCE_PHRASES`). failure_story
 *    cards are exempt (stories are events, not rules).
 *
 * Error messages carry IDs, field names and the number token only — never transcript text — so
 * they are safe to show and log (CLAUDE.md hard rule 2).
 */
import type { CardType, Confidence, LinkKind } from "@/db/schema/enums";
import { extractNumbers, findTermSpans, numberSupported, parseUnit, type NumberMention } from "./numbers";

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type TraceSpeaker = "interviewer" | "expert" | "system";

/** One transcript turn of the session the card was extracted from. */
export interface TraceTurn {
  id: string;
  speaker: TraceSpeaker;
  text: string;
}

export type TraceLinkBasis = "session_context" | "mentioned_candidate" | "seed";

export interface TraceLink {
  kind: LinkKind;
  id: string;
  basis: TraceLinkBasis;
  /** The words the expert used for this record (for `mentioned_candidate`). */
  mention?: string;
}

export interface TraceThreshold {
  /** The expert's exact words, e.g. "under forty thou". */
  verbatim: string;
  /** Normalized value, e.g. 0.04 (inches); null when the threshold isn't numeric. */
  value: number | null;
  /** Unit of `value` ("in", "%", "x", "h", "ratio" or an alias like "inch", "hours"); null if bare. */
  unit: string | null;
}

export interface TraceEvidence {
  turnId: string;
  /** Exact substring of the cited turn. */
  quote: string;
  /** True when this span is the one that states the expert's confidence. */
  confidence?: boolean;
}

/** The fields of a knowledge card the gate inspects. */
export interface TraceCard {
  id: string;
  type: CardType;
  title: string;
  statement: string;
  actions: readonly string[];
  appliesWhen: readonly string[];
  doesNotApplyWhen: readonly string[];
  thresholds: readonly TraceThreshold[];
  expertConfidence: Confidence;
  topics: readonly string[];
  links: readonly TraceLink[];
  evidence: readonly TraceEvidence[];
}

/** The records the session was anchored on (PLAN.md §8.2: quote, its part, customer, primary machine). */
export interface TraceSessionContext {
  quoteId?: string;
  partId?: string;
  customerId?: string;
  machineId?: string;
  /** For job-anchored sessions. */
  jobId?: string;
  /** The session topic (supports a process topic without a tag word). */
  topicId?: string;
}

/** A record the candidate-records step resolved from the expert's words and sent as a source. */
export interface TraceCandidate {
  kind: LinkKind;
  id: string;
  /** The expert's words that resolved to this record, e.g. "duct support bracket in April". */
  mention: string;
}

/** Record facts the topic rules need, loaded by the caller. */
export interface TraceRecordFacts {
  /** job / part / quote id → material id. */
  materialOf: Readonly<Record<string, string>>;
  /** material id → topic id. */
  topicOfMaterial: Readonly<Record<string, string>>;
  /** machine id → topic id. */
  topicOfMachine: Readonly<Record<string, string>>;
  /** customer id → topic id. */
  topicOfCustomer: Readonly<Record<string, string>>;
  /** material id → names/aliases as they may appear in text (matched case-insensitively on word edges). */
  materialAliases: Readonly<Record<string, readonly string[]>>;
  /** process topic id → words/phrases that support it (matched case-insensitively on word edges). */
  processTopicTags: Readonly<Record<string, readonly string[]>>;
}

export interface TraceContext {
  turns: readonly TraceTurn[];
  sessionContext: TraceSessionContext;
  candidates: readonly TraceCandidate[];
  /** Entity names, material names, machine names and record IDs whose digits are not numeric claims. */
  protectedTerms: readonly string[];
  recordFacts: TraceRecordFacts;
  /** Whether links with basis "seed" are accepted (default true; the live gate passes false). */
  allowSeedBasis?: boolean;
}

export type TraceErrorCode =
  | "evidence_missing"
  | "evidence_not_expert"
  | "evidence_not_substring"
  | "threshold_verbatim_missing"
  | "number_unsupported"
  | "link_unsupported"
  | "topic_unsupported"
  | "too_many_topics"
  | "confidence_unsupported";

export interface TraceError {
  code: TraceErrorCode;
  /** Plain-English explanation naming the card and the offending field/ID (no transcript text). */
  message: string;
  /** Machine-friendly pointer, e.g. "statement", "evidence[1]", "links[0]", "topics[2]". */
  detail?: string;
}

export interface TraceResult {
  ok: boolean;
  errors: TraceError[];
}

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

export const MAX_TOPICS = 3;

/**
 * Phrases that state each confidence level (general English, matched case-insensitively on word
 * edges). The confidence evidence span must contain one for the card's level.
 */
export const CONFIDENCE_PHRASES: Readonly<Record<Exclude<Confidence, "not_stated">, readonly string[]>> = {
  always: ["always", "every time", "every single time", "each time", "all the time", "without fail", "never"],
  usually: ["usually", "most of the time", "mostly", "typically", "generally", "normally", "as a rule"],
  sometimes: ["sometimes", "depends", "it depends", "now and then", "occasionally", "once in a while"],
  not_sure: ["not sure", "not certain", "don't know", "do not know", "i think", "i guess", "maybe"],
};

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive phrase match on word edges; internal whitespace matches any whitespace. */
function containsPhrase(text: string, phrase: string): boolean {
  const p = phrase.trim().replace(/’/g, "'");
  if (p === "") return false;
  const body = p.split(/\s+/).map(escapeRegExp).join("\\s+");
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "iu");
  return re.test(text.replace(/’/g, "'"));
}

function anyContains(texts: readonly string[], phrases: readonly string[]): boolean {
  return phrases.some((ph) => texts.some((t) => containsPhrase(t, ph)));
}

/** A negator just before a phrase ("not always", "doesn't usually", "isn't every time") reverses it. */
const NEGATED_BEFORE = /(?:\b(?:not|never|hardly|rarely|seldom)|n't|n’t)\s+(?:\p{L}+\s+)?$/iu;

/** Like containsPhrase, but an occurrence preceded (within one word) by a negator doesn't count. */
function statesPhrase(text: string, phrase: string): boolean {
  const p = phrase.trim().replace(/’/g, "'");
  if (p === "") return false;
  const body = p.split(/\s+/).map(escapeRegExp).join("\\s+");
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu");
  const t = text.replace(/’/g, "'");
  for (const m of t.matchAll(re)) {
    if (!NEGATED_BEFORE.test(t.slice(Math.max(0, (m.index ?? 0) - 24), m.index ?? 0))) return true;
  }
  return false;
}

function numbersIn(text: string, protectedTerms: readonly string[]): NumberMention[] {
  return extractNumbers(text, { skipSpans: findTermSpans(text, protectedTerms) });
}

function keysWithValue(map: Readonly<Record<string, string>>, value: string): string[] {
  return Object.keys(map).filter((k) => map[k] === value);
}

const SESSION_SLOT: Partial<Record<LinkKind, keyof TraceSessionContext>> = {
  quote: "quoteId",
  part: "partId",
  customer: "customerId",
  machine: "machineId",
  job: "jobId",
};

// ---------------------------------------------------------------------------------------------
// checkCard
// ---------------------------------------------------------------------------------------------

/** Runs every traceability rule on one card. `ok` is true only when `errors` is empty. */
export function checkCard(card: TraceCard, ctx: TraceContext): TraceResult {
  const errors: TraceError[] = [];
  const push = (code: TraceErrorCode, message: string, detail?: string) =>
    errors.push(detail === undefined ? { code, message } : { code, message, detail });
  const turnsById = new Map(ctx.turns.map((t) => [t.id, t]));
  const expertTexts = ctx.turns.filter((t) => t.speaker === "expert").map((t) => t.text);
  const includedInExpertTurn = (s: string | undefined) => !!s && s.trim() !== "" && expertTexts.some((t) => t.includes(s));

  // 1. Evidence ------------------------------------------------------------------------------
  if (card.evidence.length === 0) {
    push("evidence_missing", `Card ${card.id} has no evidence span from an expert turn.`, "evidence");
  }
  const valid: { ev: TraceEvidence; turn: TraceTurn }[] = [];
  card.evidence.forEach((ev, i) => {
    const where = `evidence[${i}]`;
    const turn = turnsById.get(ev.turnId);
    if (!turn) {
      push("evidence_not_expert", `Card ${card.id}: ${where} cites turn ${ev.turnId}, which is not a turn of this session.`, where);
      return;
    }
    if (turn.speaker !== "expert") {
      push(
        "evidence_not_expert",
        `Card ${card.id}: ${where} cites turn ${ev.turnId}, which is a ${turn.speaker} turn; evidence must come from the expert.`,
        where,
      );
      return;
    }
    if (ev.quote.trim() === "" || !turn.text.includes(ev.quote)) {
      push(
        "evidence_not_substring",
        `Card ${card.id}: ${where} is not an exact substring of turn ${ev.turnId} (check spelling, punctuation and spacing).`,
        where,
      );
      return;
    }
    valid.push({ ev, turn });
  });
  const quotes = valid.map((v) => v.ev.quote);
  const citedTurnTexts = [...new Set(valid.map((v) => v.turn.text))];
  const evidenceNumbers = quotes.flatMap((q) => numbersIn(q, ctx.protectedTerms));

  // 2. Thresholds ----------------------------------------------------------------------------
  card.thresholds.forEach((th, i) => {
    const where = `thresholds[${i}]`;
    if (th.verbatim.trim() === "" || !citedTurnTexts.some((t) => t.includes(th.verbatim))) {
      push(
        "threshold_verbatim_missing",
        `Card ${card.id}: ${where}.verbatim is not an exact substring of any turn cited by the card's evidence.`,
        where,
      );
    }
    if (th.value !== null) {
      const unit = parseUnit(th.unit);
      if (unit === undefined) {
        push("number_unsupported", `Card ${card.id}: ${where} uses unit "${th.unit}", which the number normalizer doesn't know.`, where);
      } else {
        const claim: NumberMention = { value: th.value, unit, raw: String(th.value), start: 0, end: 0 };
        if (!numberSupported(claim, numbersIn(th.verbatim, ctx.protectedTerms))) {
          push(
            "number_unsupported",
            `Card ${card.id}: ${where} value ${th.value}${unit ? ` ${unit}` : ""} doesn't match the number in its verbatim words.`,
            where,
          );
        }
      }
    }
  });

  // 3. Numeric claims ------------------------------------------------------------------------
  const fields: [string, string][] = [
    ["title", card.title],
    ["statement", card.statement],
    ...card.actions.map((s, i): [string, string] => [`actions[${i}]`, s]),
    ...card.appliesWhen.map((s, i): [string, string] => [`appliesWhen[${i}]`, s]),
    ...card.doesNotApplyWhen.map((s, i): [string, string] => [`doesNotApplyWhen[${i}]`, s]),
  ];
  for (const [field, text] of fields) {
    for (const n of numbersIn(text, ctx.protectedTerms)) {
      if (!numberSupported(n, evidenceNumbers)) {
        push(
          "number_unsupported",
          `Card ${card.id}: "${n.raw}" in ${field} doesn't match any number in the cited evidence quotes.`,
          field,
        );
      }
    }
  }

  // 4. Links ---------------------------------------------------------------------------------
  const validLinks: TraceLink[] = [];
  card.links.forEach((link, i) => {
    const where = `links[${i}]`;
    let ok = false;
    let why = "";
    if (link.basis === "seed") {
      ok = ctx.allowSeedBasis !== false;
      why = "seed-basis links are not accepted here";
    } else if (link.basis === "session_context") {
      const slot = SESSION_SLOT[link.kind];
      ok = slot !== undefined && ctx.sessionContext[slot] === link.id;
      why = `it is not the session's ${link.kind}`;
    } else {
      const cand = ctx.candidates.find((c) => c.kind === link.kind && c.id === link.id);
      if (!cand) {
        why = "it was not sent as a candidate record";
      } else if (!includedInExpertTurn(cand.mention)) {
        why = "its candidate mention is not an exact substring of an expert turn";
      } else if (link.mention !== undefined && !includedInExpertTurn(link.mention)) {
        why = "its mention is not an exact substring of an expert turn";
      } else {
        ok = true;
      }
    }
    if (ok) validLinks.push(link);
    else push("link_unsupported", `Card ${card.id}: ${where} (${link.kind} ${link.id}, ${link.basis}) is not allowed because ${why}.`, where);
  });

  // 5. Topics --------------------------------------------------------------------------------
  if (card.topics.length > MAX_TOPICS) {
    push("too_many_topics", `Card ${card.id} has ${card.topics.length} topics; at most ${MAX_TOPICS} are allowed.`, "topics");
  }
  const facts = ctx.recordFacts;
  const searchTexts = [card.title, card.statement, ...card.actions, ...card.appliesWhen, ...card.doesNotApplyWhen, ...quotes];
  card.topics.forEach((topic, i) => {
    const where = `topics[${i}]`;
    const materials = keysWithValue(facts.topicOfMaterial, topic);
    const machines = keysWithValue(facts.topicOfMachine, topic);
    const customers = keysWithValue(facts.topicOfCustomer, topic);
    const isProcess = Object.prototype.hasOwnProperty.call(facts.processTopicTags, topic);
    if (materials.length === 0 && machines.length === 0 && customers.length === 0 && !isProcess) {
      push("topic_unsupported", `Card ${card.id}: ${where} (${topic}) is not a known material, machine, customer or process topic.`, where);
      return;
    }
    const supported =
      materials.some(
        (m) =>
          anyContains(searchTexts, facts.materialAliases[m] ?? []) ||
          validLinks.some(
            (l) =>
              (l.kind === "material" && l.id === m) ||
              ((l.kind === "job" || l.kind === "part" || l.kind === "quote") && facts.materialOf[l.id] === m),
          ),
      ) ||
      validLinks.some((l) => l.kind === "machine" && machines.includes(l.id)) ||
      validLinks.some((l) => l.kind === "customer" && customers.includes(l.id)) ||
      (isProcess && (ctx.sessionContext.topicId === topic || anyContains(searchTexts, facts.processTopicTags[topic])));
    if (!supported) {
      push(
        "topic_unsupported",
        `Card ${card.id}: ${where} (${topic}) has no support — it needs a mention, a matching link or the session topic.`,
        where,
      );
    }
  });

  // 6. Confidence ----------------------------------------------------------------------------
  if (card.type !== "failure_story" && card.expertConfidence !== "not_stated") {
    const phrases = CONFIDENCE_PHRASES[card.expertConfidence];
    const stated = valid.some((v) => v.ev.confidence === true && phrases.some((ph) => statesPhrase(v.ev.quote, ph)));
    if (!stated) {
      push(
        "confidence_unsupported",
        `Card ${card.id}: confidence "${card.expertConfidence}" needs an evidence span marked as the confidence statement that says so.`,
        "expertConfidence",
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------------------------
// Link rules (PLAN.md §7.3)
// ---------------------------------------------------------------------------------------------

const NEEDS_JOB_OR_QUOTE: ReadonlySet<CardType> = new Set<CardType>([
  "quoting_rule",
  "setup_tip",
  "failure_story",
  "inspection_gotcha",
]);
const NEEDS_MACHINE: ReadonlySet<CardType> = new Set<CardType>(["setup_tip", "machine_quirk"]);

/**
 * Card link rules (PLAN.md §7.3), applied to seeded cards and the expected scripted cards:
 * quoting_rule, setup_tip, failure_story and inspection_gotcha link at least one job or quote;
 * setup_tip and machine_quirk link a machine; customer_quirk links a customer.
 * Returns one plain-English message per broken rule (empty when the card is fine).
 */
export function checkLinkRules(card: { id?: string; type: CardType; links: readonly { kind: LinkKind }[] }): string[] {
  const out: string[] = [];
  const has = (k: LinkKind) => card.links.some((l) => l.kind === k);
  const name = card.id ? `Card ${card.id}` : "Card";
  if (NEEDS_JOB_OR_QUOTE.has(card.type) && !has("job") && !has("quote")) {
    out.push(`${name} (${card.type}) must link at least one job or quote.`);
  }
  if (NEEDS_MACHINE.has(card.type) && !has("machine")) {
    out.push(`${name} (${card.type}) must link a machine.`);
  }
  if (card.type === "customer_quirk" && !has("customer")) {
    out.push(`${name} (customer_quirk) must link a customer.`);
  }
  return out;
}
