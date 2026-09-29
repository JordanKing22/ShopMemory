/**
 * Step 1 of the seed pipeline: parse and schema-check every file in seed-data/ (PLAN.md §7.1).
 * Array files are validated item by item, so one bad card doesn't hide the rest of its file.
 */
import type { z } from "zod";
import {
  AnchorsFile,
  CardSeed,
  CardsFile,
  CustomersFile,
  FamiliesFile,
  InterviewFrontmatter,
  InternalWorkOrdersFile,
  MachinesFile,
  MaterialsFile,
  NamesFile,
  PartsFile,
  PeopleFile,
  PersonasFile,
  QuoteLogsFile,
  QuoteModelFile,
  QuotesFile,
  RayLiveFile,
  SetupSheetFrontmatter,
  ShopFile,
  SynonymsFile,
  TagsFile,
  TopicsFile,
} from "./schemas";
import {
  IssueList,
  parseDocSections,
  parseFrontmatter,
  parseMatrixCsv,
  parseTranscript,
  parseYaml,
  validate,
  type MatrixCsv,
  type ParsedDocSection,
  type ParsedTurn,
  type SeedSources,
  type YamlDoc,
} from "./source";

type Inf<S extends z.ZodType> = z.infer<S>;
type Item<S> = S extends z.ZodArray<infer E> ? z.infer<E> : never;

export type ShopSeed = Inf<typeof ShopFile>;
export type PersonSeed = Item<typeof PeopleFile>;
export type PersonaSeed = Item<typeof PersonasFile>;
export type MachineSeed = Item<typeof MachinesFile>;
export type MaterialSeed = Item<typeof MaterialsFile>;
export type CustomerSeed = Item<typeof CustomersFile>;
export type NameSeed = Item<typeof NamesFile>;
export type TopicSeed = Item<typeof TopicsFile>;
export type TagSeed = Item<typeof TagsFile>;
export type PartSeedT = Item<typeof PartsFile>;
export type QuoteSeedT = Item<typeof QuotesFile>;
export type InternalWorkOrderSeed = Item<typeof InternalWorkOrdersFile>;
export type CardSeedT = Inf<typeof CardSeed>;
export type InterviewFm = Inf<typeof InterviewFrontmatter>;
export type QuoteLogSeed = Item<typeof QuoteLogsFile>;
export type SetupSheetFm = Inf<typeof SetupSheetFrontmatter>;
export type RayLiveSeed = Inf<typeof RayLiveFile>;
export type AnchorsSeed = Inf<typeof AnchorsFile>;

/** A value with the file and line it came from (for cross-file error messages). */
export interface Located<T> {
  file: string;
  line?: number;
  value: T;
}

export interface CardFileSeed {
  file: string;
  personId: string;
  cards: Located<CardSeedT>[];
}

export interface TranscriptSeed {
  file: string;
  fm: InterviewFm;
  turns: ParsedTurn[];
}

export interface SetupSheetSeed {
  file: string;
  fm: SetupSheetFm;
  sections: ParsedDocSection[];
  body: string;
  bodyStartLine: number;
}

export interface ParsedSeed {
  shop: ShopSeed | null;
  people: Located<PersonSeed>[];
  personas: Located<PersonaSeed>[];
  machines: Located<MachineSeed>[];
  materials: Located<MaterialSeed>[];
  customers: Located<CustomerSeed>[];
  names: Located<NameSeed>[];
  topics: Located<TopicSeed>[];
  tags: Located<TagSeed>[];
  synonyms: string[][];
  matrix: MatrixCsv | null;
  anchorParts: Located<PartSeedT>[];
  internalParts: Located<PartSeedT>[];
  families: Inf<typeof FamiliesFile> | null;
  anchorQuotes: Located<QuoteSeedT>[];
  internalWorkOrders: Located<InternalWorkOrderSeed>[];
  quoteModel: Inf<typeof QuoteModelFile> | null;
  cardFiles: CardFileSeed[];
  transcripts: TranscriptSeed[];
  quoteLogs: Located<QuoteLogSeed>[];
  setupSheets: SetupSheetSeed[];
  rayLive: RayLiveSeed | null;
  rayLiveDoc: YamlDoc | null;
  anchors: AnchorsSeed | null;
}

export const FILES = {
  shop: "shop.yaml",
  names: "NAMES.yaml",
  people: "people.yaml",
  personas: "personas.yaml",
  machines: "machines.yaml",
  materials: "materials.yaml",
  customers: "customers.yaml",
  matrix: "expertise-matrix.csv",
  topics: "taxonomy/topics.yaml",
  tags: "taxonomy/tags.yaml",
  synonyms: "taxonomy/search-synonyms.yaml",
  anchorParts: "parts/anchors.yaml",
  internalParts: "parts/internal.yaml",
  families: "parts/families.yaml",
  anchorQuotes: "quotes/anchors.yaml",
  internalWorkOrders: "quotes/internal-work-orders.yaml",
  quoteModel: "quotes/quote-model.yaml",
  rayLive: "demo/ray-live-interview.yaml",
  anchors: "demo/anchors.yaml",
} as const;

const OPTIONAL_DIRS = { cards: "cards/", interviews: "interviews/", quoteLogs: "quote-logs/", setupSheets: "documents/setup-sheets/" };

export function parseSeedSources(sources: SeedSources, issues: IssueList): ParsedSeed {
  const yamlOf = (file: string): YamlDoc | null => {
    const text = sources[file];
    if (text === undefined) {
      issues.error(file, "This required file is missing.", "missing_file");
      return null;
    }
    return parseYaml(file, text, issues);
  };
  const single = <S extends z.ZodType>(file: string, schema: S): Inf<S> | null => {
    const doc = yamlOf(file);
    return doc ? validate(file, doc, schema, issues) : null;
  };
  const list = <E extends z.ZodType>(file: string, arraySchema: z.ZodArray<E>, doc = yamlOf(file)): Located<Inf<E>>[] => {
    if (!doc) return [];
    if (!Array.isArray(doc.value)) {
      issues.error(file, "This file must be a list (each item starts with '- ').", "schema", 1);
      return [];
    }
    const out: Located<Inf<E>>[] = [];
    (doc.value as unknown[]).forEach((item, i) => {
      const v = validate(file, doc, arraySchema.element, issues, item, [i]);
      if (v !== null) out.push({ file, line: doc.lineOf([i]), value: v as Inf<E> });
    });
    return out;
  };

  const synonymsDoc = yamlOf(FILES.synonyms);
  const matrixText = sources[FILES.matrix];
  if (matrixText === undefined) issues.error(FILES.matrix, "This required file is missing.", "missing_file");
  const rayLiveDoc = yamlOf(FILES.rayLive);

  const parsed: ParsedSeed = {
    shop: single(FILES.shop, ShopFile),
    people: list(FILES.people, PeopleFile),
    personas: list(FILES.personas, PersonasFile),
    machines: list(FILES.machines, MachinesFile),
    materials: list(FILES.materials, MaterialsFile),
    customers: list(FILES.customers, CustomersFile),
    names: list(FILES.names, NamesFile),
    topics: list(FILES.topics, TopicsFile),
    tags: list(FILES.tags, TagsFile),
    synonyms: synonymsDoc ? (validate(FILES.synonyms, synonymsDoc, SynonymsFile, issues) ?? []) : [],
    matrix: matrixText === undefined ? null : parseMatrixCsv(FILES.matrix, matrixText, issues),
    anchorParts: list(FILES.anchorParts, PartsFile),
    internalParts: list(FILES.internalParts, PartsFile),
    families: single(FILES.families, FamiliesFile),
    anchorQuotes: list(FILES.anchorQuotes, QuotesFile),
    internalWorkOrders: list(FILES.internalWorkOrders, InternalWorkOrdersFile),
    quoteModel: single(FILES.quoteModel, QuoteModelFile),
    cardFiles: [],
    transcripts: [],
    quoteLogs: [],
    setupSheets: [],
    rayLive: rayLiveDoc ? validate(FILES.rayLive, rayLiveDoc, RayLiveFile, issues) : null,
    rayLiveDoc,
    anchors: single(FILES.anchors, AnchorsFile),
  };

  const filesIn = (dir: string, ext: string) =>
    Object.keys(sources)
      .filter((f) => f.startsWith(dir) && f.endsWith(ext) && !f.slice(dir.length).includes("/"))
      .sort();

  for (const file of filesIn(OPTIONAL_DIRS.cards, ".yaml")) {
    const m = /^cards\/(PER-\d{2})-[a-z0-9-]+\.yaml$/.exec(file);
    if (!m) {
      issues.error(file, 'Card files are named after their contributor, like "PER-01-ray-delgado.yaml".', "file_name");
      continue;
    }
    const doc = yamlOf(file);
    if (!doc) continue;
    if (doc.value === null) {
      parsed.cardFiles.push({ file, personId: m[1], cards: [] });
      continue;
    }
    const cards = list(file, CardsFile, doc);
    parsed.cardFiles.push({ file, personId: m[1], cards });
  }

  for (const file of filesIn(OPTIONAL_DIRS.interviews, ".md")) {
    const fmDoc = parseFrontmatter(file, sources[file], issues);
    if (!fmDoc) continue;
    const fm = validate(file, fmDoc.frontmatter, InterviewFrontmatter, issues);
    const turns = parseTranscript(file, fmDoc.body, fmDoc.bodyStartLine, issues);
    if (!fm) continue;
    if (!file.slice(OPTIONAL_DIRS.interviews.length).startsWith(`${fm.id}-`)) {
      issues.error(file, `The file name must start with the interview ID "${fm.id}-".`, "file_name", 2);
    }
    parsed.transcripts.push({ file, fm, turns });
  }

  for (const file of filesIn(OPTIONAL_DIRS.quoteLogs, ".yaml")) {
    parsed.quoteLogs.push(...list(file, QuoteLogsFile));
  }

  for (const file of filesIn(OPTIONAL_DIRS.setupSheets, ".md")) {
    const fmDoc = parseFrontmatter(file, sources[file], issues);
    if (!fmDoc) continue;
    const fm = validate(file, fmDoc.frontmatter, SetupSheetFrontmatter, issues);
    if (!fm) continue;
    if (!file.slice(OPTIONAL_DIRS.setupSheets.length).startsWith(`${fm.id}-`)) {
      issues.error(file, `The file name must start with the document ID "${fm.id}-".`, "file_name", 2);
    }
    parsed.setupSheets.push({
      file,
      fm,
      sections: parseDocSections(fmDoc.body, fmDoc.bodyStartLine),
      body: fmDoc.body.trim(),
      bodyStartLine: fmDoc.bodyStartLine,
    });
  }

  return parsed;
}
