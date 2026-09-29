/**
 * Query-feature parsing for the similar-jobs scorer (PLAN.md §8.4).
 *
 * When a question has no pinned record, its features are parsed from the text: which customers, materials, part
 * features and part families it mentions. The vocabulary (customer names and aliases, material aliases, feature and
 * family phrases) is data passed in by the caller — this module holds matching *method* only.
 *
 * Matching rules:
 * - case-insensitive (NFKC + lower-case on both sides);
 * - whole words only: a phrase must not be preceded or followed by a letter or digit (`Ti` matches in `Ti-6Al-4V`
 *   and `Ti,` but not in `Tin`);
 * - inside a phrase, any run of whitespace or hyphens matches any run of whitespace or hyphens (`thin-wall` ≡
 *   `thin wall` ≡ `thin – wall`); other punctuation must match literally (`6-4` does not match `6.4`);
 * - family phrases are plural-tolerant on their last word (`bracket` matches `brackets`, `assembly` matches
 *   `assemblies`, `box` matches `boxes`);
 * - within one category the longest match wins: a span claimed by `Ti-6Al-4V` is not also counted for `Ti`.
 *   The exact same span may match several IDs (an ambiguous alias), and then all of them are returned.
 *
 * Results list each ID once, in order of first mention in the text (ties in declaration order).
 * Pure: no I/O, deterministic.
 */

/** One entity the question may mention, with every way people write it. */
export interface EntityVocab {
  id: string;
  names: readonly string[];
}

/** Everything {@link parseQueryFeatures} can recognize. Keys of `features`/`families` are `PartFeature`/`PartFamily`. */
export interface QueryVocabulary {
  customers: readonly EntityVocab[];
  materials: readonly EntityVocab[];
  /** PartFeature → phrases that mean it (e.g. `thin_wall` → `thin-wall`, `thin walls`, …). */
  features: Readonly<Record<string, readonly string[]>>;
  /** PartFamily → phrases that mean it; matched plural-tolerantly. */
  families: Readonly<Record<string, readonly string[]>>;
}

/** Features parsed from a question; each list holds distinct IDs/keys in order of first mention. */
export interface QueryFeatures {
  customerIds: string[];
  materialIds: string[];
  features: string[];
  families: string[];
}

/** Characters that separate words inside a phrase: whitespace, ASCII hyphen, Unicode hyphens and dashes. */
const SEP_CLASS = "[\\s\\-\\u2010-\\u2015]";
const SEP_SPLIT_RE = new RegExp(`${SEP_CLASS}+`, "u");
const SEP_RE_SOURCE = `${SEP_CLASS}+`;
const BEFORE = "(?<![\\p{L}\\p{N}])";
const AFTER = "(?![\\p{L}\\p{N}])";

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** Regex source for a word that also accepts its regular English plural. */
function pluralTolerant(word: string): string {
  if (/[^aeiou]y$/u.test(word)) return `${escapeRegExp(word.slice(0, -1))}(?:y|ies)`;
  if (/(?:s|x|z|ch|sh)$/u.test(word)) return `${escapeRegExp(word)}(?:es)?`;
  if (/\p{L}$/u.test(word)) return `${escapeRegExp(word)}s?`;
  return escapeRegExp(word);
}

/** Compiles one vocabulary phrase to a global, whole-word regex (null when the phrase is blank). */
export function phraseRegExp(phrase: string, opts: { plural?: boolean } = {}): RegExp | null {
  const words = normalize(phrase)
    .trim()
    .split(SEP_SPLIT_RE)
    .filter((w) => w !== "");
  if (words.length === 0) return null;
  const parts = words.map((w, i) => (opts.plural && i === words.length - 1 ? pluralTolerant(w) : escapeRegExp(w)));
  return new RegExp(`${BEFORE}${parts.join(SEP_RE_SOURCE)}${AFTER}`, "gu");
}

interface Hit {
  key: string;
  order: number;
  start: number;
  end: number;
}

/** Finds the IDs of one category mentioned in `text` (already normalized), applying longest-match-wins. */
function matchCategory(text: string, entries: readonly [string, readonly string[]][], plural: boolean): string[] {
  const hits: Hit[] = [];
  entries.forEach(([key, phrases], order) => {
    for (const phrase of phrases) {
      const re = phraseRegExp(phrase, { plural });
      if (!re) continue;
      for (const m of text.matchAll(re)) {
        if (m[0].length === 0) continue;
        hits.push({ key, order, start: m.index, end: m.index + m[0].length });
      }
    }
  });

  hits.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start || a.order - b.order);
  const accepted: Hit[] = [];
  for (const h of hits) {
    const blocked = accepted.some(
      (a) => h.start < a.end && a.start < h.end && !(h.start === a.start && h.end === a.end),
    );
    if (!blocked) accepted.push(h);
  }

  accepted.sort((a, b) => a.start - b.start || a.order - b.order);
  const out: string[] = [];
  for (const h of accepted) if (!out.includes(h.key)) out.push(h.key);
  return out;
}

/**
 * Detects the customers, materials, part features and part families a question mentions.
 *
 * @example
 * parseQueryFeatures("How do we quote thin-wall Ti brackets for Aerovance?", vocab)
 * // => { customerIds: ["CUS-01"], materialIds: ["mat-ti64"], features: ["thin_wall"], families: ["bracket"] }
 */
export function parseQueryFeatures(text: string, vocab: QueryVocabulary): QueryFeatures {
  const t = normalize(text);
  const fromEntities = (list: readonly EntityVocab[]): [string, readonly string[]][] =>
    list.map((e) => [e.id, e.names]);
  return {
    customerIds: matchCategory(t, fromEntities(vocab.customers), false),
    materialIds: matchCategory(t, fromEntities(vocab.materials), false),
    features: matchCategory(t, Object.entries(vocab.features), false),
    families: matchCategory(t, Object.entries(vocab.families), true),
  };
}
