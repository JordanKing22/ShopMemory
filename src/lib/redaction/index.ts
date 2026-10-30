/** Public surface of the redaction core (PLAN.md §4.5). The token grammar itself lives in patterns.ts. */
export {
  buildRedactionDictionary,
  contactDisplayName,
  dictionaryHits,
  type CompiledRedactionDictionary,
  type DictionaryHit,
} from "./dictionary";
export { redactAroundTokens, redactRequest, redactText, tokensInValue, hasTokens } from "./redact";
export { StreamRestorer, restoreText, restoreJsonStrings, detokenizeEntities, UNKNOWN_TOKEN_TEXT } from "./restore";
export { createMemoryPatternResolver, NO_PATTERN_TOKENS, type MemoryPatternResolver } from "./memory-resolver";
export * from "./patterns";
export type * from "./types";
