/**
 * FTS5 query sanitizer (PLAN.md §5.3).
 *
 * User text must never reach `MATCH` raw: FTS5 query syntax treats `-`, `:`, `*`, `^`, `+`, parentheses and the
 * bare words AND / OR / NOT / NEAR as operators, so the demo question itself (`thin-wall`) or `Ti-6Al-4V` throws
 * (`no such column`). `toFtsQuery()` rebuilds the query from scratch instead of escaping it:
 *
 *   1. tokenize to Unicode letter/number runs (NFKC, lower-case);
 *   2. drop 1-character tokens and stopwords;
 *   3. expand synonyms — single tokens and multi-token phrases (n-grams of the raw token stream, longest first);
 *   4. wrap every term in double quotes (embedded quotes doubled) — multi-token synonyms become quoted phrases;
 *   5. join with ` OR `.
 *
 * Inside an FTS5 string only `"` is special, and every term is built from letter/number tokens, so the result can
 * never be parsed as an operator, column filter or prefix query. When nothing survives, the function returns `null`
 * and callers must skip the `MATCH` entirely (an empty query is itself an FTS5 syntax error).
 *
 * Pure: no I/O, deterministic output order.
 */

import { searchTokens, type SynonymIndex } from "./synonyms";

/**
 * Common English function words dropped from search queries. Deliberately excludes words that can carry meaning in
 * a shop (`down`, `off`, `out`, `over`, `under`, `first`, `won`, …) and every short domain token (`ti` is kept —
 * the 1-character rule counts code points, and `ti` has two).
 */
export const DEFAULT_STOPWORDS: ReadonlySet<string> = new Set([
  "a", "about", "after", "again", "all", "also", "am", "an", "and", "any", "are", "aren", "as", "at",
  "be", "because", "been", "before", "being", "both", "but", "by",
  "can", "could", "couldn",
  "did", "didn", "do", "does", "doesn", "doing", "don",
  "each", "else", "ever", "every",
  "for", "from",
  "get", "gets", "getting", "got",
  "had", "hadn", "has", "hasn", "have", "haven", "having", "he", "her", "here", "hers", "him", "his", "how",
  "i", "if", "in", "into", "is", "isn", "it", "its", "itself",
  "just",
  "know", "let", "lets", "ll",
  "may", "me", "might", "must", "my", "myself",
  "no", "nor", "not", "now",
  "of", "ok", "okay", "on", "once", "or", "our", "ours", "ourselves",
  "please",
  "re",
  "shall", "she", "should", "shouldn", "so", "some", "such",
  "tell", "than", "thanks", "that", "the", "their", "theirs", "them", "then", "there", "these", "they", "this",
  "those", "to", "too",
  "us",
  "ve", "very",
  "was", "wasn", "we", "were", "weren", "what", "when", "where", "which", "while", "who", "whom", "why", "will",
  "with", "would", "wouldn",
  "you", "your", "yours", "yourself",
]);

/** Default cap on the number of distinct OR terms, so a pasted wall of text can't produce a huge query. */
export const DEFAULT_MAX_TERMS = 64;

/** Options for {@link toFtsQuery}. */
export interface FtsQueryOptions {
  /** Synonym groups to expand (search-synonyms.yaml + material aliases + tag synonyms). No expansion when omitted. */
  synonyms?: SynonymIndex;
  /** Tokens to drop. Defaults to {@link DEFAULT_STOPWORDS}; pass an empty set to keep every token. */
  stopwords?: ReadonlySet<string>;
  /** Maximum number of distinct OR terms kept, in order of first appearance. Defaults to {@link DEFAULT_MAX_TERMS}. */
  maxTerms?: number;
}

/** Wraps a term in FTS5 double quotes, doubling any embedded quote (the only special character inside a string). */
export function quoteFtsTerm(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/** Length in code points (so an astral-plane letter counts as one character, like a BMP letter). */
function codePointLength(s: string): number {
  return Array.from(s).length;
}

/**
 * Builds a safe FTS5 `MATCH` expression from free user text, or `null` when no searchable term remains.
 *
 * @example
 * toFtsQuery("How do we quote thin-wall Ti brackets?")
 * // => '"quote" OR "thin" OR "wall" OR "ti" OR "brackets"'
 */
export function toFtsQuery(userText: string, opts: FtsQueryOptions = {}): string | null {
  const stopwords = opts.stopwords ?? DEFAULT_STOPWORDS;
  const synonyms = opts.synonyms;
  const maxTerms = Math.max(1, Math.floor(opts.maxTerms ?? DEFAULT_MAX_TERMS));

  const isKept = (token: string): boolean => codePointLength(token) > 1 && !stopwords.has(token);
  /** A single-token term obeys the same rules as user tokens; a multi-token phrase is kept whole. */
  const isKeptTerm = (term: string): boolean => term !== "" && (term.includes(" ") || isKept(term));

  const tokens = searchTokens(userText);
  const terms = new Set<string>();
  const add = (term: string): void => {
    if (terms.size < maxTerms && isKeptTerm(term)) terms.add(term);
  };

  const maxN = synonyms ? Math.max(1, synonyms.maxPhraseTokens) : 1;
  for (let i = 0; i < tokens.length && terms.size < maxTerms; i += 1) {
    const token = tokens[i];
    if (isKept(token)) add(token);
    if (!synonyms) continue;

    // Longest phrase first. Phrases may span stopwords/1-char tokens ("6-4", "grade 5"); a single token is only
    // expanded when it would have been kept on its own.
    for (let n = Math.min(maxN, tokens.length - i); n >= 1; n -= 1) {
      if (n === 1 && !isKept(token)) continue;
      const key = tokens.slice(i, i + n).join(" ");
      const expansions = synonyms.entries.get(key);
      if (expansions) for (const term of expansions) add(term);
    }
  }

  if (terms.size === 0) return null;
  return [...terms].map(quoteFtsTerm).join(" OR ");
}
