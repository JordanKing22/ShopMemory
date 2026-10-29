/**
 * Builds the redaction / entity-detection input from DB rows or seed-bundle tables (docs/AI-GATEWAY.md §5.1), so the
 * dictionary at run time is exactly the one the seed loader used: people + persona-only personas (the owner), customers
 * + aliases, contacts, part / job / quote numbers, and the number stoplist (materials, machines, certifications,
 * "AS9102") that keeps spec and material numbers from looking like record numbers.
 *
 * Pure apart from loadDictionaryInput() (one query per table) and cachedRedactionDictionary() (a per-process cache).
 */
import { inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { Classification } from "@/db/schema/enums";
import {
  appSettings,
  customerAccounts,
  customers,
  jobs,
  machines,
  materials,
  parts,
  people,
  personas,
  quotes,
  shopProfile,
} from "@/db/schema";
import { buildRedactionDictionary, type CompiledRedactionDictionary } from "@/lib/redaction/dictionary";
import type { RedactionDictionaryInput } from "@/lib/redaction/types";

/** app_settings key of the demo epoch (src/db/reset.ts EPOCH_KEY; repeated here so the data layer needn't import reset). */
const EPOCH_SETTING_KEY = "demo.epoch";
import { labelNamePart } from "./personas";

/** The subset of rows the dictionary needs. Seed bundle tables and DB select rows both satisfy it. */
export interface DictionarySourceTables {
  shopProfile: readonly { seed: number; certifications: readonly string[] }[];
  customers: readonly {
    id: string;
    name: string;
    redactionAliases: readonly string[];
    classification: Classification;
    partClassificationFloor: Classification;
    nearMissIgnore?: readonly string[] | null;
    partNumberPattern: string;
  }[];
  customerAccounts: readonly { customerId: string; contactName?: string | null; contactEmail?: string | null }[];
  people: readonly { id: string; fullName: string; redactionAliases: readonly string[] }[];
  personas: readonly { id: string; label: string; personId?: string | null; redactionAliases?: readonly string[] | null }[];
  parts: readonly { id: string; partNumber: string; classification: Classification }[];
  jobs: readonly { id: string; jobNumber: string; classification: Classification }[];
  quotes: readonly { id: string; quoteNumber: string; classification: Classification }[];
  materials: readonly { name: string; shortName: string; aliases: readonly string[] }[];
  machines: readonly { model: string; name: string }[];
}

export function dictionaryInputFromTables(t: DictionarySourceTables): RedactionDictionaryInput {
  const shop = t.shopProfile[0];
  const stoplistNumbers = [
    ...t.materials.flatMap((m) => [m.name, m.shortName, ...m.aliases]),
    ...t.machines.flatMap((m) => [m.model, m.name]),
    ...(shop?.certifications ?? []),
    "AS9102",
  ];
  const personaPeople = t.personas
    .filter((p) => !p.personId)
    .map((p) => {
      const aliases = p.redactionAliases ?? [];
      return { id: p.id, fullName: aliases[0] ?? labelNamePart(p.label), aliases };
    });
  return {
    entities: {
      customers: t.customers.map((c) => ({
        id: c.id,
        name: c.name,
        aliases: c.redactionAliases.filter((a) => a !== c.name),
        classification: c.classification,
        partClassificationFloor: c.partClassificationFloor,
      })),
      people: [...t.people.map((p) => ({ id: p.id, fullName: p.fullName, aliases: p.redactionAliases })), ...personaPeople],
      parts: t.parts.map((r) => ({ id: r.id, partNumber: r.partNumber, classification: r.classification })),
      jobs: t.jobs.map((r) => ({ id: r.id, jobNumber: r.jobNumber, classification: r.classification })),
      quotes: t.quotes.map((r) => ({ id: r.id, quoteNumber: r.quoteNumber, classification: r.classification })),
      stoplistNumbers,
      nearMissIgnore: t.customers.flatMap((c) => c.nearMissIgnore ?? []),
    },
    contacts: t.customerAccounts.map((a) => ({ customerId: a.customerId, name: a.contactName ?? null, email: a.contactEmail ?? null })),
    tokenSeed: shop?.seed ?? 0,
    partNumberPatterns: t.customers.map((c) => c.partNumberPattern),
  };
}

/** Reads the dictionary rows from the database (role-blind: the dictionary is server-side only, never sent anywhere). */
export function loadDictionaryInput(db: Db): RedactionDictionaryInput {
  return dictionaryInputFromTables({
    shopProfile: db.select({ seed: shopProfile.seed, certifications: shopProfile.certifications }).from(shopProfile).all(),
    customers: db
      .select({
        id: customers.id,
        name: customers.name,
        redactionAliases: customers.redactionAliases,
        classification: customers.classification,
        partClassificationFloor: customers.partClassificationFloor,
        nearMissIgnore: customers.nearMissIgnore,
        partNumberPattern: customers.partNumberPattern,
      })
      .from(customers)
      .orderBy(customers.sortOrder)
      .all(),
    customerAccounts: db
      .select({ customerId: customerAccounts.customerId, contactName: customerAccounts.contactName, contactEmail: customerAccounts.contactEmail })
      .from(customerAccounts)
      .orderBy(customerAccounts.customerId)
      .all(),
    people: db
      .select({ id: people.id, fullName: people.fullName, redactionAliases: people.redactionAliases })
      .from(people)
      .orderBy(people.sortOrder)
      .all(),
    personas: db
      .select({ id: personas.id, label: personas.label, personId: personas.personId, redactionAliases: personas.redactionAliases })
      .from(personas)
      .orderBy(personas.sortOrder)
      .all(),
    parts: db.select({ id: parts.id, partNumber: parts.partNumber, classification: parts.classification }).from(parts).orderBy(parts.id).all(),
    jobs: db.select({ id: jobs.id, jobNumber: jobs.jobNumber, classification: jobs.classification }).from(jobs).orderBy(jobs.id).all(),
    quotes: db
      .select({ id: quotes.id, quoteNumber: quotes.quoteNumber, classification: quotes.classification })
      .from(quotes)
      .orderBy(quotes.id)
      .all(),
    materials: db.select({ name: materials.name, shortName: materials.shortName, aliases: materials.aliases }).from(materials).orderBy(materials.sortOrder).all(),
    machines: db.select({ model: machines.model, name: machines.name }).from(machines).orderBy(machines.sortOrder).all(),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Cache (docs/AI-GATEWAY.md §10.3): one compiled dictionary per (seed bundle, demo epoch, dictionary version)
// ---------------------------------------------------------------------------------------------------------------

/** app_settings key bumped by writes that change dictionary surfaces (e.g. a future "Redact this" alias). */
export const DICTIONARY_VERSION_KEY = "redaction.dictionary_version";

const cacheSlot = globalThis as typeof globalThis & {
  __floorwiseDictionary?: { key: string; dict: CompiledRedactionDictionary };
};

function dictionaryCacheKey(db: Db): string {
  const shop = db.select({ hash: shopProfile.seedBundleHash }).from(shopProfile).get();
  const settings = db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(inArray(appSettings.key, [EPOCH_SETTING_KEY, DICTIONARY_VERSION_KEY]))
    .all();
  const get = (k: string) => JSON.stringify(settings.find((s) => s.key === k)?.value ?? null);
  return `${shop?.hash ?? ""}|${get(EPOCH_SETTING_KEY)}|${get(DICTIONARY_VERSION_KEY)}`;
}

/** The compiled redaction dictionary (its entityDict is the P3 entity detector), rebuilt after a reset or alias change. */
export function cachedRedactionDictionary(db: Db): CompiledRedactionDictionary {
  const key = dictionaryCacheKey(db);
  const hit = cacheSlot.__floorwiseDictionary;
  if (hit && hit.key === key) return hit.dict;
  const dict = buildRedactionDictionary(loadDictionaryInput(db));
  cacheSlot.__floorwiseDictionary = { key, dict };
  return dict;
}
