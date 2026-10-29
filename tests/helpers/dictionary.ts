/**
 * Test helper: the redaction dictionary built from the real seed bundle (the same input the app loads from the DB).
 * Cached per worker. Tests assert on token SHAPES and positions, never print names.
 */
import { dictionaryInputFromTables, type DictionarySourceTables } from "@/lib/data/dictionary";
import { buildRedactionDictionary, type CompiledRedactionDictionary } from "@/lib/redaction";
import type { RedactionDictionaryInput } from "@/lib/redaction/types";
import { seedBundle } from "./seeded-db";

const g = globalThis as typeof globalThis & { __floorwiseTestDict?: CompiledRedactionDictionary; __floorwiseTestDictInput?: RedactionDictionaryInput };

export function seedDictionaryInput(): RedactionDictionaryInput {
  if (!g.__floorwiseTestDictInput) g.__floorwiseTestDictInput = dictionaryInputFromTables(seedBundle().tables as unknown as DictionarySourceTables);
  return g.__floorwiseTestDictInput;
}

export function seedRedactionDictionary(): CompiledRedactionDictionary {
  if (!g.__floorwiseTestDict) g.__floorwiseTestDict = buildRedactionDictionary(seedDictionaryInput());
  return g.__floorwiseTestDict;
}

/** The token a name or number gets (found by redacting it alone). */
export function tokenOf(dict: CompiledRedactionDictionary, text: string): string {
  for (const m of text.normalize("NFC").matchAll(dict.entityDict.matcher)) {
    let group = 1;
    while (group < m.length && m[group] === undefined) group++;
    const idx = dict.entityDict.groupToSurface[group] ?? -1;
    if (idx >= 0 && m[0] === text) return dict.surfaceTokens[idx].token;
  }
  throw new Error("not a dictionary surface");
}
