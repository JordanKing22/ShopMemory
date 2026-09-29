/**
 * Search synonyms (PLAN.md §5.3).
 *
 * Groups of equivalent terms come from data — `seed-data/taxonomy/search-synonyms.yaml`, material aliases and
 * tag synonyms — never from code. This module only indexes them and expands a term to its group members.
 *
 * Every term is normalized the same way the FTS sanitizer tokenizes user text: NFKC, lower-case, and split into
 * Unicode letter/number runs joined by single spaces. So `Ti-6Al-4V`, `ti 6al 4v` and `TI/6AL/4V` are the same
 * key (`ti 6al 4v`), and a multi-token key is later emitted as a quoted FTS5 phrase.
 *
 * Pure: no I/O, no globals, deterministic output order.
 */

/** Unicode letter/number runs — the one token grammar shared by synonyms, the FTS sanitizer and feature parsing. */
const TOKEN_RE = /[\p{L}\p{N}]+/gu;

/**
 * Splits text into normalized search tokens (NFKC, lower-case, letter/number runs).
 * Punctuation, whitespace, symbols and emoji are separators.
 */
export function searchTokens(text: string): string[] {
  return text.normalize("NFKC").toLowerCase().match(TOKEN_RE) ?? [];
}

/** Normalizes a term to its canonical key: its search tokens joined by single spaces (`""` when none). */
export function normalizeTerm(term: string): string {
  return searchTokens(term).join(" ");
}

/** An immutable lookup from a normalized term to every normalized member of the groups that contain it. */
export interface SynonymIndex {
  /**
   * Normalized term → deduplicated expansions, starting with the term itself, then the other members in the order
   * the groups (and members within them) were given. A term in several groups gets the union of those groups
   * (one hop only — groups are not merged transitively).
   */
  readonly entries: ReadonlyMap<string, readonly string[]>;
  /** Length, in tokens, of the longest key — lets callers bound phrase (n-gram) scans. 0 for an empty index. */
  readonly maxPhraseTokens: number;
}

/**
 * Builds a synonym index from groups of equivalent terms (e.g. the parsed `search-synonyms.yaml`).
 * Members that normalize to nothing (pure punctuation or emoji) are ignored; groups left with fewer than two distinct
 * members add nothing.
 */
export function buildSynonymIndex(groups: readonly (readonly string[])[]): SynonymIndex {
  const acc = new Map<string, string[]>();
  let maxPhraseTokens = 0;

  for (const group of groups) {
    const members: string[] = [];
    for (const raw of group) {
      const key = normalizeTerm(raw);
      if (key !== "" && !members.includes(key)) members.push(key);
    }
    if (members.length < 2) continue;

    for (const key of members) {
      maxPhraseTokens = Math.max(maxPhraseTokens, key.split(" ").length);
      let list = acc.get(key);
      if (!list) {
        list = [key];
        acc.set(key, list);
      }
      for (const m of members) if (!list.includes(m)) list.push(m);
    }
  }

  const entries = new Map<string, readonly string[]>();
  for (const [key, list] of acc) entries.set(key, Object.freeze([...list]));
  return { entries, maxPhraseTokens };
}

/**
 * Expands a term to itself plus its synonym-group members, all normalized (lower-case letter/number tokens joined
 * by spaces). Case- and punctuation-insensitive: `expandTerm("Ti", idx)` and `expandTerm("ti", idx)` agree.
 * Returns `[normalized term]` when the term has no synonyms, and `[]` when it normalizes to nothing.
 */
export function expandTerm(term: string, idx: SynonymIndex): string[] {
  const key = normalizeTerm(term);
  if (key === "") return [];
  const hit = idx.entries.get(key);
  return hit ? [...hit] : [key];
}
