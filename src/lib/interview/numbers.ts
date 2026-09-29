/**
 * Spoken-number normalizer (PLAN.md §8.2 "Traceability gate", §7.5 seed:check).
 *
 * Turns the numbers people say or write into comparable values so the traceability gate can
 * check that every numeric claim on a knowledge card also appears in the expert's own words:
 *
 *   "forty thou"          → 0.040 in        "0.040 in", ".040\"", "40 thou" → 0.040 in
 *   "thirty-five percent" → 35 %            "35%", "35 %"                   → 35 %
 *   "four of the twelve"  → ratio 4/12      "4 of 12", "4 out of 12"        → ratio 4/12
 *   "about ten times"     → 10 x            "10×", "10x"                    → 10 x
 *   "three more hours"    → 3 h             "3 h", "3 hrs", "3-hour"        → 3 h
 *   "1,800", "a hundred and ten", "twelve"  → bare numbers (unit null)
 *
 * The module is pure: no I/O, no clock, no randomness, no domain facts. Everything that is
 * domain-specific (which words are entity names whose digits must be ignored) is passed in by
 * the caller as `skipSpans` (see `findTermSpans`).
 *
 * Deliberate limits (conservative, documented so the gate stays predictable):
 * - Signs are not parsed ("−3.4 %" yields 3.4 %); direction words ("under", "over") carry sign in speech.
 * - Ordinals ("first article", "2nd op"), "half", "twice", "single", "dozen" and fractions like
 *   "1/2" are not numbers here.
 * - Digits glued to letters are identifiers, not numbers ("6Al", "4V", "316L", "A03", "dmu50"),
 *   and so are digit groups that follow "<letter>-" and the rest of that hyphen chain
 *   ("AV-2231-07", "RJ-26-0310"). "N-word" compounds such as "5-axis" or "2-op" ARE numbers;
 *   callers skip taxonomy terms like "5-axis" or "17-4 PH" through `skipSpans`.
 * - A standalone "one" used as a pronoun ("that one's always", "the one") is ignored.
 * - An integer followed by "in" is only inches when punctuation or the end of the text follows
 *   ("3 in titanium" is a preposition); a decimal followed by "in" is always inches.
 */

/** Units the normalizer understands. `ratio` is "N of M". */
export type NumberUnit = "in" | "%" | "x" | "h" | "ratio";

/** One number found in a text, with its normalized value and where it sits. */
export interface NumberMention {
  /** Normalized value: inches for `in` (so "forty thou" is 0.04), N/M for `ratio`. */
  value: number;
  /** Normalized unit, or null for a bare number. */
  unit: NumberUnit | null;
  /** The exact source text of the number and its unit (`text.slice(start, end)`). */
  raw: string;
  /** Offset of the first character (UTF-16 index, like `String.prototype.slice`). */
  start: number;
  /** Offset one past the last character. */
  end: number;
  /** For `ratio` mentions: N in "N of M". */
  numerator?: number;
  /** For `ratio` mentions: M in "N of M". */
  denominator?: number;
}

/** A half-open character range `[start, end)` in a text. */
export interface TextSpan {
  start: number;
  end: number;
}

export interface ExtractNumbersOptions {
  /** Ranges whose digits and number words are ignored (entity names, material names, record IDs). */
  skipSpans?: readonly TextSpan[];
}

// ---------------------------------------------------------------------------------------------
// Base numbers (a value without its unit)
// ---------------------------------------------------------------------------------------------

interface BaseNumber {
  value: number;
  start: number;
  end: number;
  kind: "digits" | "words";
  /** Written with a decimal point ("0.040", ".040"). */
  decimal: boolean;
}

const UNITS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
/** Words before a standalone "one" that make it a pronoun ("that one", "the one"). */
const PRONOUN_DETERMINERS = new Set([
  "that",
  "this",
  "the",
  "which",
  "each",
  "every",
  "no",
  "any",
  "some",
  "another",
  "other",
  "last",
  "next",
]);

const own = (o: Record<string, number>, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Digit literals: "1,800", "0.040", ".040", "35". Not preceded by a letter, digit, "_" or ".". */
const DIGIT_RE = /(?<![\p{L}\p{N}_.])(?:\d{1,3}(?:,\d{3})+(?!\d)(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)/gu;
/** Unit suffixes that may be glued to digits ("10x", "3h", "0.040in") without making an identifier. */
const ATTACHED_UNIT_RE = /^(?:x|h|hrs?|hours?|in|inch(?:es)?|thou)(?![\p{L}\p{N}])/iu;
const LETTER_RE = /\p{L}/u;
const ALNUM_RE = /[\p{L}\p{N}]/u;

function scanDigits(text: string): BaseNumber[] {
  const out: BaseNumber[] = [];
  let prevCode: { end: number } | null = null;
  for (const m of text.matchAll(DIGIT_RE)) {
    const start = m.index ?? 0;
    const lit = m[0];
    const end = start + lit.length;
    let code = false;

    const before = text[start - 1];
    if (before === "-") {
      const beforeHyphen = text[start - 2];
      if (beforeHyphen !== undefined && LETTER_RE.test(beforeHyphen)) code = true; // "AV-2231", "Ti-6"
      if (prevCode && prevCode.end === start - 1) code = true; // "…-2231-07": rest of an identifier chain
    }
    const after = text[end];
    if (after !== undefined && (LETTER_RE.test(after) || after === "_")) {
      if (!ATTACHED_UNIT_RE.test(text.slice(end, end + 8))) code = true; // "6Al", "4V", "316L", "2nd"
    }

    if (code) {
      prevCode = { end };
      continue;
    }
    prevCode = null;
    const value = Number(lit.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    out.push({ value, start, end, kind: "digits", decimal: lit.includes(".") });
  }
  return out;
}

interface WordToken {
  w: string; // lowercase
  start: number;
  end: number;
}

function wordTokens(text: string): WordToken[] {
  const out: WordToken[] = [];
  for (const m of text.matchAll(/\p{L}+/gu)) {
    const start = m.index ?? 0;
    out.push({ w: m[0].toLowerCase(), start, end: start + m[0].length });
  }
  return out;
}

/** Words inside one spoken number may be separated by whitespace or a single hyphen. */
function joinable(text: string, a: WordToken, b: WordToken): boolean {
  const sep = text.slice(a.end, b.start);
  return /^\s+$/.test(sep) || sep === "-" || sep === "‐";
}

interface WordParse {
  value: number;
  /** Index of the last word consumed. */
  last: number;
}

/** Parses "twelve", "thirty-five", "thirty five", "seven" starting at word i. */
function parseBelowHundred(text: string, words: WordToken[], i: number): WordParse | null {
  const t = words[i];
  if (!t) return null;
  if (own(TEENS, t.w)) return { value: TEENS[t.w], last: i };
  if (own(TENS, t.w)) {
    const n = words[i + 1];
    if (n && own(UNITS, n.w) && UNITS[n.w] > 0 && joinable(text, t, n)) {
      return { value: TENS[t.w] + UNITS[n.w], last: i + 1 };
    }
    return { value: TENS[t.w], last: i };
  }
  if (own(UNITS, t.w)) return { value: UNITS[t.w], last: i };
  return null;
}

/** Parses up to 9,999 said with "hundred": "a hundred and ten", "two hundred fifty", "twelve hundred", "forty". */
function parseBelowThousand(text: string, words: WordToken[], i: number): WordParse | null {
  const t = words[i];
  if (!t) return null;
  const n = words[i + 1];
  // "a hundred": the article only counts in front of "hundred".
  const head: WordParse | null =
    t.w === "a" ? (n && n.w === "hundred" && joinable(text, t, n) ? { value: 1, last: i } : null) : parseBelowHundred(text, words, i);

  let hundreds: WordParse | null = null;
  if (head) {
    const h = words[head.last + 1];
    if (h && h.w === "hundred" && head.value > 0 && joinable(text, words[head.last], h)) {
      hundreds = { value: head.value * 100, last: head.last + 1 };
    }
  } else if (t.w === "hundred") {
    hundreds = { value: 100, last: i };
  }
  if (!hundreds) return head;

  // Optional "[and] <below hundred>" after "hundred".
  const j = hundreds.last + 1;
  const nx = words[j];
  if (!nx || !joinable(text, words[hundreds.last], nx)) return hundreds;
  if (nx.w === "and") {
    const after = words[j + 1];
    if (!after || !joinable(text, nx, after)) return hundreds;
    const rest = parseBelowHundred(text, words, j + 1);
    return rest ? { value: hundreds.value + rest.value, last: rest.last } : hundreds;
  }
  const rest = parseBelowHundred(text, words, j);
  return rest ? { value: hundreds.value + rest.value, last: rest.last } : hundreds;
}

/** Parses a full spoken number (up to the thousands) starting at word i. */
function parseWordNumber(text: string, words: WordToken[], i: number): WordParse | null {
  const t = words[i];
  const n = words[i + 1];
  // "a thousand"
  if (t && t.w === "a" && n && n.w === "thousand" && joinable(text, t, n)) {
    return extendThousands(text, words, { value: 1, last: i });
  }
  const head = parseBelowThousand(text, words, i);
  if (!head) return null;
  return extendThousands(text, words, head);
}

function extendThousands(text: string, words: WordToken[], head: WordParse): WordParse {
  const t = words[head.last + 1];
  if (!t || t.w !== "thousand" || !joinable(text, words[head.last], t)) return head;
  const base: WordParse = { value: head.value * 1000, last: head.last + 1 };
  let j = base.last + 1;
  let nx = words[j];
  if (nx && joinable(text, t, nx) && nx.w === "and") {
    const after = words[j + 1];
    if (!after || !joinable(text, nx, after)) return base;
    j += 1;
    nx = after;
  }
  if (nx && joinable(text, words[j - 1], nx)) {
    const rest = parseBelowThousand(text, words, j);
    if (rest) return { value: base.value + rest.value, last: rest.last };
  }
  return base;
}

function isPronounOne(text: string, words: WordToken[], i: number): boolean {
  const t = words[i];
  const afterChar = text[t.end];
  if (afterChar === "'" || afterChar === "’") return true; // "one's", "one'll"
  if (/^\s+(?:out\s+)?of(?![\p{L}])/iu.test(text.slice(t.end, t.end + 12))) return false; // "one of the twelve"
  const prev = words[i - 1];
  return !!prev && /^\s+$/.test(text.slice(prev.end, t.start)) && PRONOUN_DETERMINERS.has(prev.w);
}

function scanWords(text: string): BaseNumber[] {
  const words = wordTokens(text);
  const out: BaseNumber[] = [];
  let i = 0;
  while (i < words.length) {
    const p = parseWordNumber(text, words, i);
    if (!p) {
      i += 1;
      continue;
    }
    const single = p.last === i;
    if (single && words[i].w === "one" && isPronounOne(text, words, i)) {
      i += 1;
      continue;
    }
    out.push({ value: p.value, start: words[i].start, end: words[p.last].end, kind: "words", decimal: false });
    i = p.last + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Units and ratios
// ---------------------------------------------------------------------------------------------

const FILLER = "(?:(?:more|extra|additional|full)\\s+)?";
const RATIO_RE = /^\s+(?:out\s+)?of\s+(?:the\s+)?/iu;
const THOU_RE = new RegExp(
  `^(?:\\s*|-)${FILLER}(?:thou|thousandths)(?![\\p{L}\\p{N}])(?:\\s+of\\s+an\\s+inch(?![\\p{L}]))?`,
  "iu",
);
const PERCENT_RE = new RegExp(`^(?:\\s*|-)${FILLER}(?:%|percent(?![\\p{L}])|per\\s+cent(?![\\p{L}])|pct(?![\\p{L}]))`, "iu");
const TIMES_ATTACHED_RE = /^[x×](?![\p{L}\p{N}])/iu;
const TIMES_SIGN_RE = /^\s*×(?![\p{L}\p{N}])/u;
const TIMES_WORD_RE = new RegExp(`^(?:\\s+|-)${FILLER}times(?![\\p{L}])`, "iu");
const HOURS_WORD_RE = new RegExp(`^(?:\\s+|-)${FILLER}hours?(?![\\p{L}\\p{N}])`, "iu");
const HOURS_ABBR_RE = new RegExp(`^(?:\\s*|-)${FILLER}(?:hours?|hrs?|h)(?![\\p{L}\\p{N}])`, "iu");
const INCH_WORD_RE = /^(?:\s*|-)inch(?:es)?(?![\p{L}])/iu;
const INCH_ABBR_RE = /^(?:\s*|-)in(?![\p{L}\p{N}])/iu;
const INCH_MARK_RE = /^["″]/u;
/** After an integer + "in": only punctuation or the end makes "in" a unit. */
const INCH_INTEGER_TAIL_RE = /^(?:\.|\s*$|\s*[,;:)\]"])/u;

interface UnitMatch {
  unit: NumberUnit;
  length: number;
  /** Multiplier applied to the base value (thou → 1/1000 in). */
  scale: number;
}

function matchUnit(text: string, b: BaseNumber): UnitMatch | null {
  const rest = text.slice(b.end, b.end + 48);
  let m: RegExpExecArray | null;

  if ((m = THOU_RE.exec(rest))) return { unit: "in", length: m[0].length, scale: 1 / 1000 };
  if ((m = PERCENT_RE.exec(rest))) return { unit: "%", length: m[0].length, scale: 1 };
  if (b.kind === "digits" && (m = TIMES_ATTACHED_RE.exec(rest))) return { unit: "x", length: m[0].length, scale: 1 };
  if ((m = TIMES_SIGN_RE.exec(rest)) || (m = TIMES_WORD_RE.exec(rest))) return { unit: "x", length: m[0].length, scale: 1 };
  const hours = b.kind === "digits" ? HOURS_ABBR_RE : HOURS_WORD_RE;
  if ((m = hours.exec(rest))) return { unit: "h", length: m[0].length, scale: 1 };
  if ((m = INCH_WORD_RE.exec(rest))) return { unit: "in", length: m[0].length, scale: 1 };
  if (b.kind === "digits") {
    if ((m = INCH_MARK_RE.exec(rest))) return { unit: "in", length: m[0].length, scale: 1 };
    if ((m = INCH_ABBR_RE.exec(rest))) {
      const tail = rest.slice(m[0].length);
      if (b.decimal || INCH_INTEGER_TAIL_RE.test(tail)) return { unit: "in", length: m[0].length, scale: 1 };
    }
  }
  return null;
}

function overlaps(a: TextSpan, spans: readonly TextSpan[]): boolean {
  return spans.some((s) => a.start < s.end && s.start < a.end);
}

/** Rounds away binary noise from scaling (40 / 1000 → 0.04, not 0.04000000000000001). */
function clean(v: number): number {
  return Number.parseFloat(v.toPrecision(12));
}

/**
 * Finds every number in `text` and normalizes it (see the module comment for the grammar).
 * Mentions are returned in text order; numbers overlapping `opts.skipSpans` are ignored.
 */
export function extractNumbers(text: string, opts: ExtractNumbersOptions = {}): NumberMention[] {
  const skip = opts.skipSpans ?? [];
  const bases = [...scanDigits(text), ...scanWords(text)]
    .filter((b) => !overlaps(b, skip))
    .sort((a, b) => a.start - b.start);
  const byStart = new Map<number, number>();
  bases.forEach((b, idx) => byStart.set(b.start, idx));

  const out: NumberMention[] = [];
  const consumed = new Set<number>();
  for (let idx = 0; idx < bases.length; idx++) {
    if (consumed.has(idx)) continue;
    const b = bases[idx];

    // "N of the M" / "N of M" / "N out of M" → ratio.
    const rm = RATIO_RE.exec(text.slice(b.end, b.end + 24));
    if (rm) {
      const denIdx = byStart.get(b.end + rm[0].length);
      if (denIdx !== undefined && denIdx > idx) {
        const den = bases[denIdx];
        if (den.value !== 0) {
          consumed.add(denIdx);
          out.push({
            value: b.value / den.value,
            unit: "ratio",
            raw: text.slice(b.start, den.end),
            start: b.start,
            end: den.end,
            numerator: b.value,
            denominator: den.value,
          });
          continue;
        }
      }
    }

    const u = matchUnit(text, b);
    const end = u ? b.end + u.length : b.end;
    out.push({
      value: u ? clean(b.value * u.scale) : b.value,
      unit: u ? u.unit : null,
      raw: text.slice(b.start, end),
      start: b.start,
      end,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------------------------

/** Absolute tolerance for inch values (0.040 vs 0.0400001 are the same claim). */
export const INCH_TOLERANCE = 1e-6;
/** Relative tolerance for every other unit (guards float noise only, not rounding). */
export const RELATIVE_TOLERANCE = 1e-9;

function sameValue(x: number, y: number, unit: NumberUnit | null): boolean {
  if (unit === "in") return Math.abs(x - y) <= INCH_TOLERANCE;
  return Math.abs(x - y) <= RELATIVE_TOLERANCE * Math.max(1, Math.abs(x), Math.abs(y));
}

/**
 * True when two mentions state the same number.
 *
 * Unit rule (conservative, so invented numbers are rejected):
 * - both sides carry a unit → the units must be identical and the values equal
 *   (inches within 1e-6 absolute, everything else within a 1e-9 relative tolerance);
 * - exactly one side is bare (unit null) → the values must be equal (a bare "35" matches "35 %",
 *   but a bare "40" does NOT match "forty thou", which is 0.040 in);
 * - ratios compare numerator and denominator ("4 of 12" equals "four of the twelve" but not
 *   "1 of 3"); a ratio never equals a bare number here — see `numberSupported` for the one place a
 *   bare number may lean on a ratio's parts.
 */
export function numbersEqual(a: NumberMention, b: NumberMention): boolean {
  if (a.unit === "ratio" || b.unit === "ratio") {
    if (a.unit !== b.unit) return false;
    if (a.numerator !== undefined && a.denominator !== undefined && b.numerator !== undefined && b.denominator !== undefined) {
      return sameValue(a.numerator, b.numerator, null) && sameValue(a.denominator, b.denominator, null);
    }
    return sameValue(a.value, b.value, null);
  }
  if (a.unit !== null && b.unit !== null && a.unit !== b.unit) return false;
  return sameValue(a.value, b.value, a.unit ?? b.unit);
}

/**
 * True when `claim` is backed by at least one of `evidence`: `numbersEqual`, or — for a bare claim
 * only — equality with the numerator or denominator of an evidence ratio ("4 scrapped" is backed by
 * "four of the twelve failed").
 */
export function numberSupported(claim: NumberMention, evidence: readonly NumberMention[]): boolean {
  return evidence.some(
    (e) =>
      numbersEqual(claim, e) ||
      (claim.unit === null &&
        e.unit === "ratio" &&
        ((e.numerator !== undefined && sameValue(claim.value, e.numerator, null)) ||
          (e.denominator !== undefined && sameValue(claim.value, e.denominator, null)))),
  );
}

// ---------------------------------------------------------------------------------------------
// Helpers for callers
// ---------------------------------------------------------------------------------------------

const UNIT_ALIASES: Record<string, NumberUnit> = {
  in: "in",
  "in.": "in",
  inch: "in",
  inches: "in",
  '"': "in",
  "″": "in",
  "%": "%",
  percent: "%",
  pct: "%",
  x: "x",
  "×": "x",
  times: "x",
  h: "h",
  hr: "h",
  hrs: "h",
  hour: "h",
  hours: "h",
  ratio: "ratio",
};

/**
 * Maps a free-form unit string (as stored on card thresholds) to a `NumberUnit`.
 * Returns null for a missing/empty unit and `undefined` for a unit this module doesn't know.
 */
export function parseUnit(unit: string | null | undefined): NumberUnit | null | undefined {
  if (unit === null || unit === undefined) return null;
  const k = unit.trim().toLowerCase();
  if (k === "") return null;
  return Object.prototype.hasOwnProperty.call(UNIT_ALIASES, k) ? UNIT_ALIASES[k] : undefined;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Finds every occurrence of each term in `text` (case-insensitive) and returns the spans, for use
 * as `skipSpans`. A term edge that is a letter or digit must not continue into another letter or
 * digit, so "6061" protects "6061-T6" but not "60610". Internal whitespace matches any whitespace.
 */
export function findTermSpans(text: string, terms: readonly string[]): TextSpan[] {
  const spans: TextSpan[] = [];
  for (const term of terms) {
    const t = term.trim();
    if (t === "") continue;
    const body = t.split(/\s+/).map(escapeRegExp).join("\\s+");
    const lead = ALNUM_RE.test(t[0]) ? "(?<![\\p{L}\\p{N}])" : "";
    const trail = ALNUM_RE.test(t[t.length - 1]) ? "(?![\\p{L}\\p{N}])" : "";
    const re = new RegExp(`${lead}${body}${trail}`, "giu");
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      spans.push({ start, end: start + m[0].length });
    }
  }
  return spans.sort((a, b) => a.start - b.start || a.end - b.end);
}
