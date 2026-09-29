/**
 * The seed bundle: every seeded DB row, in insert order, as produced by `buildSeedBundle()` and replayed by
 * `resetDatabase()`. `seed:check` writes the last valid bundle to data/seed-bundle.json, so a half-edited YAML
 * file can never break Reset demo.
 */
import type { InferInsertModel } from "drizzle-orm";
import * as s from "@/db/schema";
import { canonicalJson, sha256Hex } from "./source";

/** Seeded tables, parent → child (the insert order). Runtime-only tables are not listed. */
export const SEEDED_TABLES = {
  shopProfile: s.shopProfile,
  people: s.people,
  personas: s.personas,
  machines: s.machines,
  materials: s.materials,
  customers: s.customers,
  customerAccounts: s.customerAccounts,
  topics: s.topics,
  tags: s.tags,
  searchSynonymGroups: s.searchSynonymGroups,
  personTopicExpertise: s.personTopicExpertise,
  parts: s.parts,
  quotes: s.quotes,
  quoteFinancials: s.quoteFinancials,
  jobs: s.jobs,
  machineEvents: s.machineEvents,
  interviews: s.interviews,
  interviewTurns: s.interviewTurns,
  consentRecords: s.consentRecords,
  quoteReasoningLogs: s.quoteReasoningLogs,
  knowledgeCards: s.knowledgeCards,
  cardLinks: s.cardLinks,
  cardTopics: s.cardTopics,
  cardTags: s.cardTags,
  cardEvidence: s.cardEvidence,
  documents: s.documents,
  documentCards: s.documentCards,
  coverageSnapshots: s.coverageSnapshots,
} as const;

export type SeededTableName = keyof typeof SEEDED_TABLES;

export type BundleTables = { [K in SeededTableName]: InferInsertModel<(typeof SEEDED_TABLES)[K]>[] };

export interface SeedBundle {
  format: 1;
  /** sha256 of the canonical JSON of `tables` (with shop_profile.seed_bundle_hash blanked). */
  hash: string;
  demoToday: string;
  seed: number;
  tables: BundleTables;
}

export const BUNDLE_FORMAT = 1 as const;

/** Computes the bundle hash and writes it into shop_profile.seed_bundle_hash. */
export function sealBundle(demoToday: string, seed: number, tables: BundleTables): SeedBundle {
  const blanked = { ...tables, shopProfile: tables.shopProfile.map((r) => ({ ...r, seedBundleHash: "" })) };
  const hash = sha256Hex(canonicalJson(blanked));
  const sealed: BundleTables = { ...tables, shopProfile: tables.shopProfile.map((r) => ({ ...r, seedBundleHash: hash })) };
  return { format: BUNDLE_FORMAT, hash, demoToday, seed, tables: sealed };
}

export function bundleRowCounts(bundle: SeedBundle): Record<SeededTableName, number> {
  const out = {} as Record<SeededTableName, number>;
  for (const k of Object.keys(SEEDED_TABLES) as SeededTableName[]) out[k] = bundle.tables[k].length;
  return out;
}

/** Structural check for a bundle read back from disk (it may be stale or hand-edited). */
export function isSeedBundle(value: unknown): value is SeedBundle {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<SeedBundle>;
  if (v.format !== BUNDLE_FORMAT || typeof v.hash !== "string" || !v.tables || typeof v.tables !== "object") return false;
  return (Object.keys(SEEDED_TABLES) as SeededTableName[]).every((k) => Array.isArray((v.tables as BundleTables)[k]));
}
