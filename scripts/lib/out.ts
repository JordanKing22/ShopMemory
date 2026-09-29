/* eslint-disable no-console */
/**
 * The only console writer for scripts (CLAUDE.md hard rule 2). Scripts print summaries, counts and
 * tokenized text only — never prompts, transcripts or secrets.
 */
export const out = {
  line: (s = "") => console.log(s),
  warn: (s: string) => console.warn(s),
  error: (s: string) => console.error(s),
};
