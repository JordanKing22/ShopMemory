/**
 * The seed pipeline (PLAN.md §7): parse seed-data/, generate the non-anchor commerce records, derive every
 * classification, run the cross-file checks and the demo invariants, and produce the DB rows (the bundle).
 *
 * Pure: `buildSeedBundle()` takes file texts and returns rows + issues. `seed:check` prints the issues and writes
 * data/seed-bundle.json on success; `npm run seed` and Reset demo replay that bundle.
 */
import type { Classification, JudgmentDriver } from "@/db/schema/enums";
import { CARD_TYPES, CLASS_RANK, DOC_SECTIONS, MOVES, maxClass } from "@/db/schema/enums";
import type { DocBody, DocSectionKey } from "@/db/schema/documents";
import type { Threshold } from "@/db/schema/cards";
import {
  deriveCardFloor,
  defaultCardClass,
  deriveDocumentFloor,
  deriveInterviewFloor,
  deriveJobFloor,
  derivePartFloor,
  deriveQuoteFloor,
  resolveClassification,
} from "@/db/classification";
import { buildDictionary, floorFromText, type EntityDictionary } from "@/lib/policy/entity-detect";
import {
  checkCard,
  checkLinkRules,
  type TraceCandidate,
  type TraceCard,
  type TraceContext,
  type TraceLink,
  type TraceRecordFacts,
  type TraceSessionContext,
  type TraceTurn,
} from "@/lib/interview/traceability";
import { consentTextSha256, isConsentVersion } from "@/lib/interview/consent";
import { generateCommerce, GeneratorError, judgmentDrivers } from "./generate";
import { sealBundle, type BundleTables, type SeedBundle } from "./bundle";
import { parseSeedSources, FILES, type CardSeedT, type Located, type PartSeedT, type QuoteSeedT, type ParsedSeed } from "./parse";
import { IssueList, pad3, type SeedIssue, type SeedSources } from "./source";
import { RAY_ID, runInvariants, type InvariantReport } from "./invariants";

/** Seeded card IDs run KC-001…KC-090; KC-091…094 are the scripted demo's, KC-101+ the app's. */
export const SEEDED_CARD_MAX = 90;

export const RESERVED = {
  cards: ["KC-091", "KC-092", "KC-093", "KC-094"],
  interviews: ["INT-LIVE-RAY"],
  documents: ["DOC-SS-LIVE"],
} as const;

/** The brief's record counts (PLAN.md §7.3). Drift is a warning, never an error. */
export const TARGETS = {
  generatedParts: 44,
  parts: 60,
  totalQuotes: 120,
  wonTotal: 70,
  lostTotal: 42,
  noBidTotal: 5,
  pendingTotal: 3,
  inProcessWon: 4,
  jobs: 74,
  cards: 90,
  cardTypes: { quoting_rule: 18, setup_tip: 20, machine_quirk: 16, customer_quirk: 14, inspection_gotcha: 12, failure_story: 10 },
  cardStatuses: { approved: 80, pending_review: 6, draft: 2, rejected: 2 },
  transcripts: 8,
  setupSheets: 25,
  quoteLogs: 3,
} as const;

export interface JobSeedFlat {
  id: string;
  quoteId: string | null;
  partId: string;
  job_number: string;
  status: "scheduled" | "in_process" | "complete";
  started_on: string | null;
  shipped_on: string | null;
  lead: string | null;
  actual_machine: string | null;
  actual_setup_hours: number | null;
  actual_run_hours: number | null;
  actual_hours: number | null;
  scrap_qty: number;
  ncr_count: number;
  on_time: boolean | null;
  debrief: string;
}

export interface BuildResult {
  bundle: SeedBundle | null;
  issues: SeedIssue[];
  report: SeedReport;
}

export interface SeedReport {
  counts: Record<string, number>;
  classificationMix: Record<string, Record<Classification, number>>;
  invariants: InvariantReport | null;
  /** Facts of every generated record that hand-written content links to (recorded in seed.lock.json). */
  generatedRefs: GeneratedRefs;
}

/** Generated record id → the facts hand-written stories may lean on (plus who references it). */
export type GeneratedRefs = Record<string, { facts: Record<string, string | number | boolean | null>; referencedBy: string[] }>;

export interface BuildOptions {
  /** `generated_refs` from seed-data/seed.lock.json: a referenced generated record whose facts changed is an error. */
  lockedGeneratedRefs?: GeneratedRefs;
}

const GENERATED_FILE = "parts/families.yaml (generated)";
const noon = (date: string) => `${date}T12:00:00Z`;
const emptyMix = (): Record<Classification, number> => ({ general: 0, internal: 0, customer_confidential: 0, export_controlled: 0 });

export function buildSeedBundle(sources: SeedSources, opts: BuildOptions = {}): BuildResult {
  const issues = new IssueList();
  const p = parseSeedSources(sources, issues);
  const report: SeedReport = { counts: {}, classificationMix: {}, invariants: null, generatedRefs: {} };
  if (!p.shop || !p.families || !p.quoteModel || !p.matrix || !p.anchors || !p.rayLive) {
    return { bundle: null, issues: issues.items, report };
  }
  const shop = p.shop;
  const demoToday = shop.demo_today;

  // ---------------------------------------------------------------------------------------------
  // Reference entities
  // ---------------------------------------------------------------------------------------------
  const people = uniqueMap(p.people, "person", issues);
  const personas = uniqueMap(p.personas, "persona", issues);
  const machines = uniqueMap(p.machines, "machine", issues);
  const materials = uniqueMap(p.materials, "material", issues);
  const customers = uniqueMap(p.customers, "customer", issues);
  const topics = uniqueMap(p.topics, "topic", issues);
  const tags = uniqueMap(p.tags, "tag", issues);

  for (const { file, line, value: pe } of p.personas) {
    if (pe.person && !people.has(pe.person)) issues.error(file, `${pe.id}: person ${pe.person} doesn't exist in people.yaml.`, "fk", line);
    if (pe.role === "owner" && pe.person) issues.error(file, `${pe.id}: the owner persona is not a knowledge holder and has no person.`, "persona", line);
  }
  const defaultRoles = p.personas.filter((x) => x.value.default_for_role).map((x) => x.value.role);
  for (const role of new Set(defaultRoles)) {
    if (defaultRoles.filter((r) => r === role).length > 1) issues.error(FILES.personas, `More than one persona is the default for role "${role}".`, "persona");
  }

  const assetTags = new Map<string, string>();
  for (const { file, line, value: m } of p.machines) {
    const other = assetTags.get(m.asset_tag);
    if (other) issues.error(file, `${m.id}: asset tag ${m.asset_tag} is already used by ${other}.`, "unique", line);
    assetTags.set(m.asset_tag, m.id);
  }

  const partPatterns = new Map<string, RegExp>();
  for (const { file, line, value: c } of p.customers) {
    if (CLASS_RANK[c.classification] < CLASS_RANK.customer_confidential) {
      issues.error(file, `${c.id}: a customer is at least customer_confidential (every mention of it takes this level).`, "classification", line);
    }
    try {
      partPatterns.set(c.id, new RegExp(c.part_number_pattern));
    } catch {
      issues.error(file, `${c.id}: part_number_pattern is not a valid regular expression.`, "pattern", line);
    }
  }

  for (const { file, line, value: t } of p.topics) {
    const refs = { machine: t.machine, material: t.material, customer: t.customer };
    const set = Object.entries(refs).filter(([, v]) => v !== null);
    const expected = t.category === "process" ? [] : [t.category];
    if (set.length !== expected.length || (expected[0] && set[0]?.[0] !== expected[0])) {
      issues.error(file, `${t.id}: a ${t.category} topic must ${t.category === "process" ? "not point at any record" : `point at exactly one ${t.category}`}.`, "topic", line);
    }
    if (t.machine && !machines.has(t.machine)) issues.error(file, `${t.id}: machine ${t.machine} doesn't exist.`, "fk", line);
    if (t.material && !materials.has(t.material)) issues.error(file, `${t.id}: material ${t.material} doesn't exist.`, "fk", line);
    if (t.customer && !customers.has(t.customer)) issues.error(file, `${t.id}: customer ${t.customer} doesn't exist.`, "fk", line);
  }
  for (const { file, line, value: t } of p.tags) {
    if (t.topic && !topics.has(t.topic)) issues.error(file, `Tag ${t.id}: topic ${t.topic} doesn't exist.`, "fk", line);
  }

  // Expertise matrix: every topic once, every person once.
  const expertise = new Map<string, number>();
  {
    const m = p.matrix;
    const personSet = new Set(m.personIds);
    for (const id of people.keys()) if (!personSet.has(id)) issues.error(FILES.matrix, `Person ${id} has no column.`, "matrix", 1);
    for (const id of m.personIds) if (!people.has(id)) issues.error(FILES.matrix, `Column ${id} is not a person in people.yaml.`, "matrix", 1);
    const seen = new Set<string>();
    for (const row of m.rows) {
      if (!topics.has(row.topicId)) issues.error(FILES.matrix, `Topic ${row.topicId} doesn't exist in taxonomy/topics.yaml.`, "matrix", row.line);
      if (seen.has(row.topicId)) issues.error(FILES.matrix, `Topic ${row.topicId} appears twice.`, "matrix", row.line);
      seen.add(row.topicId);
      row.levels.forEach((lv, j) => expertise.set(`${m.personIds[j]}|${row.topicId}`, lv));
    }
    for (const id of topics.keys()) if (!seen.has(id)) issues.error(FILES.matrix, `Topic ${id} has no row.`, "matrix");
  }

  // Material, machine and spec numbers ("718", "DMU 50", "AS9102") are never record-number digits.
  const detectorStoplist = [
    ...p.materials.flatMap(({ value: m }) => [m.name, m.short_name, ...m.aliases]),
    ...p.machines.flatMap(({ value: m }) => [m.model, m.name]),
    ...shop.certifications,
    "AS9102",
  ];
  const stoplistDigits = [...new Set(detectorStoplist.flatMap((s) => {
    const g = s.match(/\d+/g) ?? [];
    return g.length > 1 ? [...g, g.join("")] : g;
  }))].sort();

  // ---------------------------------------------------------------------------------------------
  // Commerce: anchors + generated + internal
  // ---------------------------------------------------------------------------------------------
  const generated = tryGenerate(issues, {
    seed: shop.seed,
    demoToday,
    customers: p.customers.map(({ value: c }) => ({
      id: c.id,
      customer_since: c.customer_since,
      is_new_customer: c.is_new_customer,
      part_classification_floor: c.part_classification_floor,
      part_number_pattern: c.part_number_pattern,
    })),
    machines: p.machines.map(({ value: m }) => ({ id: m.id, kind: m.kind })),
    materials: p.materials.map(({ value: m }) => ({ id: m.id, family: m.family })),
    rayPersonId: RAY_ID,
    stoplistNumbers: stoplistDigits,
    families: p.families,
    model: p.quoteModel,
    anchorParts: p.anchorParts.map((x) => x.value),
    anchorQuotes: p.anchorQuotes.map((x) => x.value),
    people: p.people.map(({ value: pe }) => ({ id: pe.id, hire_date: pe.hire_date })),
    targets: {
      generatedParts: TARGETS.generatedParts,
      totalQuotes: TARGETS.totalQuotes,
      wonTotal: TARGETS.wonTotal,
      lostTotal: TARGETS.lostTotal,
      noBidTotal: TARGETS.noBidTotal,
      pendingTotal: TARGETS.pendingTotal,
      inProcessWon: TARGETS.inProcessWon,
    },
  });
  if (!generated) return { bundle: null, issues: issues.items, report };

  const allPartsL: Located<PartSeedT>[] = [
    ...p.anchorParts,
    ...generated.parts.map((value) => ({ file: GENERATED_FILE, value })),
    ...p.internalParts,
  ];
  const allQuotesL: Located<QuoteSeedT>[] = [...p.anchorQuotes, ...generated.quotes.map((value) => ({ file: GENERATED_FILE, value }))];
  const parts = uniqueMap(allPartsL, "part", issues);
  const quotes = uniqueMap(allQuotesL, "quote", issues);

  const jobsL: Located<JobSeedFlat>[] = [];
  for (const { file, line, value: q } of allQuotesL) {
    if (q.job) jobsL.push({ file, line, value: { ...q.job, quoteId: q.id, partId: q.part } });
    if (q.outcome === "won" && !q.job) issues.error(file, `${q.id}: a won quote needs a job.`, "commerce", line);
    if (q.outcome !== "won" && q.job) issues.error(file, `${q.id}: only won quotes have a job.`, "commerce", line);
    if (q.outcome === "lost" && !q.lost_reason) issues.error(file, `${q.id}: a lost quote needs lost_reason.`, "commerce", line);
  }
  for (const { file, line, value: w } of p.internalWorkOrders) {
    const { part, ...rest } = w;
    jobsL.push({ file, line, value: { ...rest, quoteId: null, partId: part } });
  }
  const jobs = uniqueMap(jobsL, "job", issues);

  checkUnique(allPartsL.map((x) => ({ ...x, key: `${x.value.customer ?? "internal"}|${x.value.part_number}|${x.value.revision}`, label: `part number ${x.value.part_number} rev ${x.value.revision}` })), issues);
  checkUnique(allQuotesL.map((x) => ({ ...x, key: x.value.quote_number, label: `quote number ${x.value.quote_number}` })), issues);
  checkUnique(jobsL.map((x) => ({ ...x, key: x.value.job_number, label: `job number ${x.value.job_number}` })), issues);

  for (const { file, line, value: pt } of allPartsL) {
    if (!materials.has(pt.material)) issues.error(file, `${pt.id}: material ${pt.material} doesn't exist.`, "fk", line);
    if (pt.customer === null) continue;
    if (!customers.has(pt.customer)) {
      issues.error(file, `${pt.id}: customer ${pt.customer} doesn't exist.`, "fk", line);
      continue;
    }
    const re = partPatterns.get(pt.customer);
    if (re && !re.test(pt.part_number)) {
      issues.error(file, `${pt.id}: part number ${pt.part_number} doesn't match ${pt.customer}'s pattern ${re.source}.`, "pattern", line);
    }
  }
  for (const { file, line, value: q } of allQuotesL) {
    if (!parts.has(q.part)) issues.error(file, `${q.id}: part ${q.part} doesn't exist.`, "fk", line);
    else if (parts.get(q.part)!.value.customer === null) issues.error(file, `${q.id}: internal parts are never quoted.`, "commerce", line);
    if (!people.has(q.quoted_by)) issues.error(file, `${q.id}: quoted_by ${q.quoted_by} doesn't exist.`, "fk", line);
    for (const m of [q.primary_machine, q.secondary_machine]) if (m && !machines.has(m)) issues.error(file, `${q.id}: machine ${m} doesn't exist.`, "fk", line);
    if (q.quoted_on > demoToday) issues.error(file, `${q.id}: quoted_on ${q.quoted_on} is after DEMO_TODAY ${demoToday}.`, "date", line);
    const hire = people.get(q.quoted_by)?.value.hire_date;
    if (hire && q.quoted_on < hire) issues.error(file, `${q.id}: quoted before ${q.quoted_by} was hired.`, "date", line);
    const expectedHours = q.quoted_setup_hours + (q.quoted_cycle_minutes * q.qty) / 60;
    if (Math.abs(expectedHours - q.quoted_hours) > 0.51) {
      issues.warn(file, `${q.id}: quoted_hours ${q.quoted_hours} ≠ setup + cycle × qty / 60 (${expectedHours.toFixed(2)}).`, "commerce", line);
    }
    if (/\$\s?\d|\bUSD\b/.test(q.notes)) issues.error(file, `${q.id}: quote notes must not contain prices (they feed search).`, "pricing", line);
  }
  for (const { file, line, value: j } of jobsL) {
    if (!parts.has(j.partId)) issues.error(file, `${j.id}: part ${j.partId} doesn't exist.`, "fk", line);
    if (j.lead && !people.has(j.lead)) issues.error(file, `${j.id}: lead ${j.lead} doesn't exist.`, "fk", line);
    if (j.actual_machine && !machines.has(j.actual_machine)) issues.error(file, `${j.id}: machine ${j.actual_machine} doesn't exist.`, "fk", line);
    if (j.status === "complete" && j.actual_hours === null) issues.error(file, `${j.id}: a complete job needs actual_hours.`, "commerce", line);
    if (j.status !== "complete" && j.actual_hours !== null) issues.error(file, `${j.id}: only complete jobs have actual_hours.`, "commerce", line);
    if (j.actual_hours !== null && j.actual_setup_hours !== null && j.actual_run_hours !== null && Math.abs(j.actual_setup_hours + j.actual_run_hours - j.actual_hours) > 0.01) {
      issues.warn(file, `${j.id}: actual setup + run hours don't add up to actual_hours.`, "commerce", line);
    }
    if (j.shipped_on && j.shipped_on > demoToday) issues.error(file, `${j.id}: shipped after DEMO_TODAY.`, "date", line);
    const q = j.quoteId ? quotes.get(j.quoteId)?.value : null;
    if (q && j.started_on && j.started_on < q.quoted_on) issues.error(file, `${j.id}: started before its quote.`, "date", line);
  }

  // Classification: parts → quotes → jobs, then raised by the entities their own text mentions (part description and
  // notes, quote notes, job debrief). Raising can change the dictionary, so repeat until nothing moves.
  type ClassMeta = { cls: Classification; source: "derived" | "override_up" | "override_down"; reason: string | null };
  const partMeta = new Map<string, ClassMeta>();
  for (const { file, line, value: pt } of allPartsL) {
    const cust = pt.customer ? customers.get(pt.customer)?.value : null;
    const floor = derivePartFloor({ exportControl: pt.export_control }, cust ? { partClassificationFloor: cust.part_classification_floor } : null);
    const res = resolveClassification({ floor, defaultClass: floor, declared: pt.classification, override: pt.classification_override, subject: "part" });
    if (res.error) issues.error(file, `${pt.id}: ${res.error}`, "classification", line);
    if (res.warning) issues.warn(file, `${pt.id}: ${res.warning}`, "classification", line);
    partMeta.set(pt.id, { cls: res.classification, source: res.source, reason: res.reason });
  }
  const quoteMeta = new Map<string, ClassMeta>();
  const jobMeta = new Map<string, ClassMeta>();
  const follow = (parentId: string, parent: ClassMeta | undefined, derive: (c: Classification) => Classification): ClassMeta => {
    const cls = derive(parent?.cls ?? "export_controlled");
    return parent?.source === "override_down" && cls === parent.cls
      ? { cls, source: "override_down", reason: `Follows ${parentId}: ${parent.reason}` }
      : { cls, source: "derived", reason: null };
  };
  const raise = (m: ClassMeta, floor: Classification, mentions: { id: string }[]): ClassMeta =>
    CLASS_RANK[floor] > CLASS_RANK[m.cls]
      ? { cls: floor, source: "derived", reason: `Raised because its text mentions ${[...new Set(mentions.map((x) => x.id))].join(", ")}` }
      : m;
  const partClass = new Map<string, Classification>();
  const quoteClass = new Map<string, Classification>();
  const jobClass = new Map<string, Classification>();
  const basePartMeta = new Map(partMeta);
  const owner = p.personas.find((x) => x.value.role === "owner")?.value;
  const makeDictionary = () =>
    buildDictionary({
      customers: p.customers.map(({ value: c }) => ({
        id: c.id,
        name: c.name,
        aliases: c.aliases,
        classification: c.classification,
        partClassificationFloor: c.part_classification_floor,
      })),
      people: [
        ...p.people.map(({ value: pe }) => ({ id: pe.id, fullName: pe.full_name, aliases: pe.aliases })),
        ...(owner ? [{ id: owner.id, fullName: owner.aliases[0] ?? owner.label, aliases: owner.aliases }] : []),
      ],
      parts: allPartsL.map(({ value: pt }) => ({ id: pt.id, partNumber: pt.part_number, classification: partClass.get(pt.id) ?? "export_controlled" })),
      jobs: jobsL.map(({ value: j }) => ({ id: j.id, jobNumber: j.job_number, classification: jobClass.get(j.id) ?? "export_controlled" })),
      quotes: allQuotesL.map(({ value: q }) => ({ id: q.id, quoteNumber: q.quote_number, classification: quoteClass.get(q.id) ?? "export_controlled" })),
      stoplistNumbers: detectorStoplist,
      nearMissIgnore: p.customers.flatMap(({ value: c }) => c.near_miss_ignore),
    });
  let dict: EntityDictionary | null = null;
  const scan = (...texts: (string | null | undefined)[]) =>
    dict ? floorFromText(texts.filter((t): t is string => !!t).join("\n"), dict) : { floor: "general" as Classification, mentions: [] };
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    const set = (map: Map<string, ClassMeta>, cls: Map<string, Classification>, id: string, m: ClassMeta) => {
      if (cls.get(id) !== m.cls) changed = true;
      map.set(id, m);
      cls.set(id, m.cls);
    };
    for (const { value: pt } of allPartsL) {
      const t = scan(pt.description, pt.notes);
      set(partMeta, partClass, pt.id, raise(basePartMeta.get(pt.id)!, t.floor, t.mentions));
    }
    for (const { value: q } of allQuotesL) {
      const t = scan(q.notes);
      set(quoteMeta, quoteClass, q.id, raise(follow(q.part, partMeta.get(q.part), deriveQuoteFloor), t.floor, t.mentions));
    }
    for (const { value: j } of jobsL) {
      const parentId = j.quoteId ?? j.partId;
      const parent = j.quoteId ? quoteMeta.get(j.quoteId) : partMeta.get(j.partId);
      const t = scan(j.debrief);
      set(jobMeta, jobClass, j.id, raise(follow(parentId, parent, deriveJobFloor), t.floor, t.mentions));
    }
    dict = makeDictionary();
    if (!changed && pass > 0) break;
  }
  if (!dict) throw new Error("unreachable");
  const finalDict: EntityDictionary = dict;
  const textFloor = (...texts: (string | null | undefined)[]) =>
    floorFromText(texts.filter((t): t is string => !!t).join("\n"), finalDict);

  // The suspicion check must be able to recognize every export-controlled part and job from its digits alone.
  const coreHolders = new Set([...finalDict.numericCores.values()].map((c) => c.recordId));
  for (const { file, line, value: pt } of allPartsL) {
    if (partClass.get(pt.id) === "export_controlled" && !coreHolders.has(pt.id)) {
      issues.error(file, `${pt.id}: part number ${pt.part_number} has no digits unique enough to flag "the ${pt.part_number.replace(/\D+/g, " ").trim()} part" as export-controlled.`, "demo_invariant", line);
    }
  }
  for (const { file, line, value: j } of jobsL) {
    if (jobClass.get(j.id) === "export_controlled" && !coreHolders.has(j.id)) {
      issues.error(file, `${j.id}: job number ${j.job_number} has no digits unique enough for the suspicion check.`, "demo_invariant", line);
    }
  }

  const materialOfRecord: Record<string, string> = {};
  for (const { value: pt } of allPartsL) materialOfRecord[pt.id] = pt.material;
  for (const { value: q } of allQuotesL) if (parts.has(q.part)) materialOfRecord[q.id] = parts.get(q.part)!.value.material;
  for (const { value: j } of jobsL) if (parts.has(j.partId)) materialOfRecord[j.id] = parts.get(j.partId)!.value.material;
  const recordFacts: TraceRecordFacts = {
    materialOf: materialOfRecord,
    topicOfMaterial: Object.fromEntries(p.topics.filter((t) => t.value.material).map((t) => [t.value.material!, t.value.id])),
    topicOfMachine: Object.fromEntries(p.topics.filter((t) => t.value.machine).map((t) => [t.value.machine!, t.value.id])),
    topicOfCustomer: Object.fromEntries(p.topics.filter((t) => t.value.customer).map((t) => [t.value.customer!, t.value.id])),
    materialAliases: Object.fromEntries(p.materials.map(({ value: m }) => [m.id, [m.name, m.short_name, ...m.aliases]])),
    processTopicTags: processTopicWords(p),
  };
  // Pure-digit aliases ("718", "6061") are NOT protected: otherwise an invented "718 hours" would slip past the gate.
  const protectedTerms = [
    ...p.customers.flatMap(({ value: c }) => [c.name, ...c.aliases]),
    ...p.people.flatMap(({ value: pe }) => [pe.full_name, ...pe.aliases]),
    ...p.materials.flatMap(({ value: m }) => [m.name, m.short_name, ...m.aliases]),
    ...p.machines.flatMap(({ value: m }) => [m.name, m.make, m.model, m.asset_tag, `${m.make} ${m.model}`]),
    ...p.tags.flatMap(({ value: t }) => [t.label, ...t.synonyms]),
    ...p.topics.map(({ value: t }) => t.label),
    ...allPartsL.map(({ value: pt }) => pt.part_number),
    ...jobsL.map(({ value: j }) => j.job_number),
    ...allQuotesL.map(({ value: q }) => q.quote_number),
    ...shop.certifications,
    "AS9102",
  ].filter((t) => !/^\d+$/.test(t.trim()));
  const idPattern = /\b(?:PER|CUS|PRT|KC|INT|DOC|QRL|ME|J|Q)-[A-Z0-9-]+\b|\b(?:m|mat|t)-[a-z0-9-]+\b/g;
  const traceContext = (turns: TraceTurn[], sessionContext: TraceSessionContext, candidates: TraceCandidate[], allowSeedBasis: boolean, extraTexts: string[]): TraceContext => {
    const ids = new Set<string>();
    for (const t of [...turns.map((x) => x.text), ...extraTexts]) for (const m of t.match(idPattern) ?? []) ids.add(m);
    return { turns, sessionContext, candidates, protectedTerms: [...protectedTerms, ...ids], recordFacts, allowSeedBasis };
  };

  // ---------------------------------------------------------------------------------------------
  // Interviews (seeded transcripts)
  // ---------------------------------------------------------------------------------------------
  interface InterviewInfo {
    id: string;
    file: string;
    expert: string;
    classification: Classification;
    turns: (TraceTurn & { seq: number; phase: string | null; move: string | null; line: number })[];
    session: TraceSessionContext;
  }
  const interviews = new Map<string, InterviewInfo>();
  const interviewRows: BundleTables["interviews"] = [];
  const turnRows: BundleTables["interviewTurns"] = [];
  const consentRows: BundleTables["consentRecords"] = [];
  for (const tr of p.transcripts) {
    const { fm, file } = tr;
    if (interviews.has(fm.id)) issues.error(file, `Interview ${fm.id} is defined twice.`, "unique", 2);
    if ((RESERVED.interviews as readonly string[]).includes(fm.id) || !/^INT-\d{2}$/.test(fm.id)) {
      issues.error(file, `${fm.id}: seeded transcripts use IDs INT-01, INT-02, … (INT-LIVE-RAY is reserved for the demo).`, "reserved", 2);
    }
    if (!people.has(fm.expert)) issues.error(file, `${fm.id}: expert ${fm.expert} doesn't exist.`, "fk", 2);
    if (fm.run_by && !personas.has(fm.run_by)) issues.error(file, `${fm.id}: run_by ${fm.run_by} is not a persona.`, "fk", 2);
    if (fm.topic && !topics.has(fm.topic)) issues.error(file, `${fm.id}: topic ${fm.topic} doesn't exist.`, "fk", 2);
    const ctx = fm.context;
    const ctxClasses: Classification[] = [];
    const contextRefs: [string, string | null, Classification | undefined][] = [
      ["quote", ctx.quote, ctx.quote ? quoteClass.get(ctx.quote) : undefined],
      ["job", ctx.job, ctx.job ? jobClass.get(ctx.job) : undefined],
      ["part", ctx.part, ctx.part ? partClass.get(ctx.part) : undefined],
      ["customer", ctx.customer, ctx.customer ? customers.get(ctx.customer)?.value.classification : undefined],
    ];
    for (const [kind, id, cls] of contextRefs) {
      if (!id) continue;
      if (cls) ctxClasses.push(cls);
      else issues.error(file, `${fm.id}: context ${kind} ${id} doesn't exist.`, "fk", 2);
    }
    if (ctx.job && ctx.part && jobs.get(ctx.job)?.value.partId !== ctx.part) issues.error(file, `${fm.id}: context job ${ctx.job} is not for part ${ctx.part}.`, "context", 2);
    if (ctx.part && ctx.customer && parts.get(ctx.part)?.value.customer !== ctx.customer) issues.error(file, `${fm.id}: context part ${ctx.part} doesn't belong to ${ctx.customer}.`, "context", 2);
    if (tr.turns.length === 0) issues.error(file, `${fm.id}: the transcript has no turns.`, "transcript");
    for (const t of tr.turns) {
      if (t.move && !(MOVES as readonly string[]).includes(t.move)) issues.error(file, `Turn T${pad3(t.n)}: unknown move [${t.move}].`, "transcript", t.line);
      if (t.speaker === "expert" && t.move) issues.error(file, `Turn T${pad3(t.n)}: only interviewer turns have a [MOVE].`, "transcript", t.line);
      if (/\$\s?\d/.test(t.text)) issues.warn(file, `Turn T${pad3(t.n)} contains a $ amount; transcripts shouldn't carry prices.`, "pricing", t.line);
    }
    const mentions = textFloor(...tr.turns.map((t) => t.text));
    const floor = deriveInterviewFloor({ contextClasses: ctxClasses, consentLevel: null, textMentions: mentions.mentions });
    const res = resolveClassification({ floor, defaultClass: floor, declared: fm.classification, subject: "interview" });
    if (res.error) issues.error(file, `${fm.id}: ${res.error}`, "classification", 2);
    if (res.warning) issues.warn(file, `${fm.id}: ${res.warning}`, "classification", 2);
    if (!isConsentVersion(fm.consent.version)) issues.error(file, `${fm.id}: unknown consent version ${fm.consent.version}.`, "consent", 2);
    if (fm.consent.granted_at > fm.started_at) issues.error(file, `${fm.id}: consent must be granted before the interview starts.`, "consent", 2);
    if (fm.started_at.slice(0, 10) > demoToday) issues.error(file, `${fm.id}: started after DEMO_TODAY.`, "date", 2);

    const cls = res.classification;
    const session: TraceSessionContext = {
      ...(ctx.quote ? { quoteId: ctx.quote } : {}),
      ...(ctx.job ? { jobId: ctx.job } : {}),
      ...(ctx.part ? { partId: ctx.part } : {}),
      ...(ctx.customer ? { customerId: ctx.customer } : {}),
      ...(fm.topic ? { topicId: fm.topic } : {}),
    };
    const machineId = ctx.quote ? quotes.get(ctx.quote)?.value.primary_machine : ctx.job ? jobs.get(ctx.job)?.value.actual_machine : null;
    if (machineId) session.machineId = machineId;
    const info: InterviewInfo = {
      id: fm.id,
      file,
      expert: fm.expert,
      classification: cls,
      session,
      turns: tr.turns.map((t) => ({ id: `${fm.id}-T${pad3(t.n)}`, speaker: t.speaker, text: t.text, seq: t.n, phase: t.phase, move: t.move, line: t.line })),
    };
    interviews.set(fm.id, info);
    interviewRows.push({
      id: fm.id,
      title: fm.title,
      mode: fm.mode,
      plan: fm.plan,
      expertPersonId: fm.expert,
      runByPersonaId: fm.run_by,
      topicId: fm.topic,
      contextQuoteId: ctx.quote,
      contextJobId: ctx.job,
      contextPartId: ctx.part,
      contextCustomerId: ctx.customer,
      status: "complete",
      phase: null,
      trackerState: null,
      speechEngine: fm.speech_engine,
      audioRetained: false,
      scriptKey: null,
      offScript: false,
      isHidden: false,
      startedAt: fm.started_at,
      endedAt: fm.ended_at,
      summaryMd: fm.summary || null,
      classification: cls,
      classificationSource: res.source,
      classificationReason: res.reason,
    });
    const startMs = Date.parse(fm.started_at);
    for (const t of info.turns) {
      turnRows.push({
        id: t.id,
        interviewId: fm.id,
        seq: t.seq,
        speaker: t.speaker,
        phase: t.phase,
        move: t.move as (typeof MOVES)[number] | null,
        text: t.text,
        textSource: "seed",
        createdAt: new Date(startMs + (t.seq - 1) * 60_000).toISOString().replace(".000Z", "Z"),
        classification: cls,
      });
    }
    const local = cls === "export_controlled";
    if (isConsentVersion(fm.consent.version)) {
      consentRows.push({
        id: `CON-${fm.id}`,
        interviewId: fm.id,
        personId: fm.expert,
        consentTextVersion: fm.consent.version,
        consentTextSha256: consentTextSha256(fm.consent.version, local ? "ollama_local" : "anthropic"),
        speechEngineDisclosed: fm.speech_engine,
        aiMode: local ? "local" : "cloud",
        targetClass: local ? "ollama_local" : "anthropic",
        endpointHost: local ? "127.0.0.1" : "api.anthropic.com",
        granted: true,
        grantedAt: fm.consent.granted_at,
        recordedByPersonaId: fm.run_by,
        mode: "self",
        revokedAt: null,
      });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Knowledge cards (+ hidden manual-entry sessions for binder/manual cards)
  // ---------------------------------------------------------------------------------------------
  interface CardInfo {
    file: string;
    line?: number;
    personId: string;
    card: CardSeedT;
    classification: Classification;
    classSource: "derived" | "override_up" | "override_down";
    classReason: string | null;
    interviewId: string;
    evidence: { turnId: string; start: number; end: number; quote: string; confidence: boolean }[];
  }
  const cards = new Map<string, CardInfo>();
  const manualTurns = new Map<string, { cardId: string; text: string; createdOn: string }[]>();

  const linkList = (c: CardSeedT): { kind: TraceLink["kind"]; id: string }[] => {
    const L = c.links;
    const out: { kind: TraceLink["kind"]; id: string }[] = [];
    for (const id of [...(L.customer ? [L.customer] : []), ...L.customers]) out.push({ kind: "customer", id });
    for (const id of [...(L.material ? [L.material] : []), ...L.materials]) out.push({ kind: "material", id });
    for (const id of [...(L.machine ? [L.machine] : []), ...L.machines]) out.push({ kind: "machine", id });
    for (const id of L.jobs) out.push({ kind: "job", id });
    for (const id of L.quotes) out.push({ kind: "quote", id });
    for (const id of L.parts) out.push({ kind: "part", id });
    for (const id of L.people) out.push({ kind: "person", id });
    return out;
  };
  const linkExists = (kind: TraceLink["kind"], id: string): boolean =>
    ({ customer: customers, material: materials, machine: machines, job: jobs, quote: quotes, part: parts, person: people })[kind].has(id);
  const linkClass = (kind: TraceLink["kind"], id: string): Classification | null =>
    kind === "customer" ? (customers.get(id)?.value.classification ?? null)
    : kind === "job" ? (jobClass.get(id) ?? null)
    : kind === "quote" ? (quoteClass.get(id) ?? null)
    : kind === "part" ? (partClass.get(id) ?? null)
    : null;
  const cardText = (c: CardSeedT) => [c.title, c.statement, c.rationale, c.common_mistake, ...c.cues, ...c.actions, ...c.applies_when, ...c.does_not_apply_when];
  const toTraceCard = (c: CardSeedT, links: TraceLink[], evidence: TraceCard["evidence"]): TraceCard => ({
    id: c.id,
    type: c.type,
    title: c.title,
    statement: c.statement,
    actions: c.actions,
    appliesWhen: c.applies_when,
    doesNotApplyWhen: c.does_not_apply_when,
    thresholds: c.thresholds.map((t) => ({ verbatim: t.verbatim, value: t.value, unit: t.unit })),
    expertConfidence: c.expert_confidence,
    topics: c.topics,
    links,
    evidence,
  });
  const checkCardCommon = (file: string, line: number | undefined, c: CardSeedT, personId: string) => {
    for (const t of c.topics) if (!topics.has(t)) issues.error(file, `${c.id}: topic ${t} doesn't exist.`, "fk", line);
    if (new Set(c.topics).size !== c.topics.length) issues.error(file, `${c.id}: a topic is listed twice.`, "card", line);
    for (const t of c.tags) if (!tags.has(t)) issues.error(file, `${c.id}: tag "${t}" isn't in taxonomy/tags.yaml.`, "fk", line);
    for (const l of linkList(c)) if (!linkExists(l.kind, l.id)) issues.error(file, `${c.id}: linked ${l.kind} ${l.id} doesn't exist.`, "fk", line);
    for (const msg of checkLinkRules({ id: c.id, type: c.type, links: linkList(c) })) issues.error(file, msg, "link_rule", line);
    if (c.status === "approved" && !c.approved) issues.error(file, `${c.id}: an approved card needs "approved: { by, on }".`, "card", line);
    if (c.status !== "approved" && c.approved) issues.error(file, `${c.id}: only approved cards have an "approved" block.`, "card", line);
    if (c.approved) {
      if (!people.has(c.approved.by)) issues.error(file, `${c.id}: approver ${c.approved.by} doesn't exist.`, "fk", line);
      if (c.approved.mode === "self" && c.approved.by !== personId) issues.error(file, `${c.id}: a self-approval must be by the card's expert (${personId}).`, "card", line);
      if (c.approved.on < c.created_on) issues.error(file, `${c.id}: approved before it was created.`, "date", line);
      if (c.approved.on > demoToday) issues.error(file, `${c.id}: approved after DEMO_TODAY.`, "date", line);
    }
    if (c.created_on > demoToday) issues.error(file, `${c.id}: created after DEMO_TODAY.`, "date", line);
    // A card can't cite a job or quote from its own future.
    for (const l of linkList(c)) {
      const started = l.kind === "job" ? jobs.get(l.id)?.value.started_on : l.kind === "quote" ? quotes.get(l.id)?.value.quoted_on : null;
      if (started && c.created_on < started) {
        issues.error(file, `${c.id}: created ${c.created_on}, before its linked ${l.kind} ${l.id} (${started}).`, "date", line);
      }
    }
    const hire = people.get(personId)?.value.hire_date;
    if (hire && c.created_on < hire) issues.error(file, `${c.id}: created before ${personId} was hired.`, "date", line);
    for (const t of c.thresholds) {
      if (t.comparator === "between" && t.value_max === null) issues.error(file, `${c.id}: a "between" threshold needs value_max.`, "card", line);
    }
    if (cardText(c).some((t) => t && /\$\s?\d/.test(t))) issues.warn(file, `${c.id} contains a $ amount; cards shouldn't carry prices.`, "pricing", line);
    if (c.type === "machine_quirk" && cardText(c).some((t) => t && /\b(recall|defect(ive)?|known issue|model-wide|all units|every unit)\b/i.test(t))) {
      issues.warn(file, `${c.id}: machine quirks describe this unit's history, not a manufacturer or model-wide defect.`, "wording", line);
    }
  };

  for (const cf of p.cardFiles) {
    if (!people.has(cf.personId)) issues.error(cf.file, `The file name names ${cf.personId}, who isn't in people.yaml.`, "fk");
    for (const { line, value: c } of cf.cards) {
      const file = cf.file;
      if ((RESERVED.cards as readonly string[]).includes(c.id)) {
        issues.error(file, `${c.id} is reserved for the scripted demo interview; use another ID.`, "reserved", line);
        continue;
      }
      if (Number(c.id.slice(3)) > SEEDED_CARD_MAX) {
        issues.error(file, `${c.id}: seeded cards use KC-001 to KC-0${SEEDED_CARD_MAX} (KC-091 and up are created by the app).`, "reserved", line);
        continue;
      }
      if (cards.has(c.id)) {
        issues.error(file, `${c.id} is already defined in ${cards.get(c.id)!.file}.`, "unique", line);
        continue;
      }
      checkCardCommon(file, line, c, cf.personId);
      const links: TraceLink[] = linkList(c).map((l) => ({ ...l, basis: "seed" }));
      let interviewId: string;
      let evidence: CardInfo["evidence"] = [];
      let traceResult;
      let sourceInterviewClass: Classification | null = null;
      if (c.source.kind === "interview") {
        const iv = interviews.get(c.source.interview);
        interviewId = c.source.interview;
        if (!iv) {
          issues.error(file, `${c.id}: interview ${c.source.interview} doesn't exist in interviews/.`, "fk", line);
          continue;
        }
        if (iv.expert !== cf.personId) issues.error(file, `${c.id}: interview ${iv.id} is with ${iv.expert}, not ${cf.personId}.`, "card", line);
        sourceInterviewClass = iv.classification;
        for (const e of c.evidence) {
          if (!e.turn.startsWith(`${iv.id}-T`)) issues.error(file, `${c.id}: evidence turn ${e.turn} is not in ${iv.id}.`, "traceability", line);
        }
        const tc = toTraceCard(c, links, c.evidence.map((e) => ({ turnId: e.turn, quote: e.quote, confidence: e.confidence })));
        traceResult = checkCard(tc, traceContext(iv.turns, iv.session, [], true, cardText(c).filter((t): t is string => !!t)));
        for (const e of c.evidence) {
          const turn = iv.turns.find((t) => t.id === e.turn);
          const start = turn ? turn.text.indexOf(e.quote) : -1;
          if (turn && start >= 0) evidence.push({ turnId: e.turn, start, end: start + e.quote.length, quote: e.quote, confidence: e.confidence });
        }
      } else {
        if (c.evidence.length > 0) {
          issues.error(file, `${c.id}: ${c.source.kind} cards take their evidence from source.text; remove the evidence list.`, "traceability", line);
        }
        interviewId = manualInterviewId(cf.personId);
        const turnList = manualTurns.get(interviewId) ?? [];
        const text = c.source.text.trim();
        turnList.push({ cardId: c.id, text, createdOn: c.created_on });
        manualTurns.set(interviewId, turnList);
        const turnId = manualTurnId(interviewId, c.id); // keyed by the card number: adding cards never renumbers others
        const confidence = c.expert_confidence !== "not_stated" && c.type !== "failure_story";
        evidence = [{ turnId, start: 0, end: text.length, quote: text, confidence }];
        const tc = toTraceCard(c, links, [{ turnId, quote: text, confidence }]);
        traceResult = checkCard(tc, traceContext([{ id: turnId, speaker: "expert", text }], {}, [], true, cardText(c).filter((t): t is string => !!t)));
      }
      for (const e of traceResult.errors) issues.error(file, e.message, `traceability:${e.code}`, line);

      const linkClasses = linkList(c)
        .map((l) => ({ kind: l.kind, classification: linkClass(l.kind, l.id) }))
        .filter((l): l is { kind: TraceLink["kind"]; classification: Classification } => l.classification !== null);
      const scanned = textFloor(...cardText(c), c.source.kind === "interview" ? null : c.source.text, ...c.open_questions, c.review_notes);
      const floor = deriveCardFloor({
        sourceInterviewClass,
        isManualEntrySource: c.source.kind !== "interview",
        linkedRecordClasses: linkClasses,
        textMentions: scanned.mentions,
      });
      const res = resolveClassification({ floor, defaultClass: defaultCardClass(floor), declared: c.classification, subject: "card" });
      if (res.error) issues.error(file, `${c.id}: ${res.error}`, "classification", line);
      if (res.warning) issues.warn(file, `${c.id}: ${res.warning}`, "classification", line);
      cards.set(c.id, {
        file,
        line,
        personId: cf.personId,
        card: c,
        classification: res.classification,
        classSource: res.source,
        classReason: res.reason,
        interviewId,
        evidence,
      });
    }
  }

  // Hidden manual-entry sessions: one per person, one expert turn per binder/manual card.
  for (const [interviewId, turnList] of manualTurns) {
    const personId = interviewId.replace(/^INT-M-/, "");
    const person = people.get(personId)?.value;
    const turnClasses = turnList.map((t) => cards.get(t.cardId)!.classification);
    const cls = maxClass("internal", ...turnClasses);
    const first = turnList.map((t) => t.createdOn).sort()[0];
    interviewRows.push({
      id: interviewId,
      title: `Manual entries: ${person?.full_name ?? personId}`,
      mode: "manual_entry",
      plan: "generic",
      expertPersonId: personId,
      runByPersonaId: null,
      topicId: null,
      contextQuoteId: null,
      contextJobId: null,
      contextPartId: null,
      contextCustomerId: null,
      status: "complete",
      phase: null,
      trackerState: null,
      speechEngine: "typed",
      audioRetained: false,
      scriptKey: null,
      offScript: false,
      isHidden: true,
      startedAt: noon(first),
      endedAt: null,
      summaryMd: "Provenance for hand-entered and binder cards (one turn per card).",
      classification: cls,
      classificationSource: "derived",
      classificationReason: null,
    });
    for (const t of [...turnList].sort((a, b) => (a.cardId < b.cardId ? -1 : 1))) {
      turnRows.push({
        id: manualTurnId(interviewId, t.cardId),
        interviewId,
        seq: Number(t.cardId.slice(3)),
        speaker: "expert",
        phase: null,
        move: null,
        text: t.text,
        textSource: "seed",
        createdAt: noon(t.createdOn),
        classification: cards.get(t.cardId)!.classification,
      });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Setup sheets, quote logs, machine events
  // ---------------------------------------------------------------------------------------------
  const docRows: BundleTables["documents"] = [];
  const docCardRows: BundleTables["documentCards"] = [];
  const docIds = new Set<string>();
  const sectionKeys = new Set<string>(DOC_SECTIONS.filter((k) => k !== "header"));
  for (const sh of p.setupSheets) {
    const { fm, file } = sh;
    if (docIds.has(fm.id)) issues.error(file, `${fm.id} is defined twice.`, "unique", 2);
    docIds.add(fm.id);
    if ((RESERVED.documents as readonly string[]).includes(fm.id)) issues.error(file, `${fm.id} is reserved for the scripted demo.`, "reserved", 2);
    else if (!/^DOC-SS-\d{2}$/.test(fm.id)) issues.error(file, `${fm.id}: seeded setup sheets use IDs DOC-SS-01, DOC-SS-02, … (DOC-101 and up are created by the app).`, "reserved", 2);
    if (!machines.has(fm.machine)) issues.error(file, `${fm.id}: machine ${fm.machine} doesn't exist.`, "fk", 2);
    if (fm.part && !parts.has(fm.part)) issues.error(file, `${fm.id}: part ${fm.part} doesn't exist.`, "fk", 2);
    if (fm.job && !jobs.has(fm.job)) issues.error(file, `${fm.id}: job ${fm.job} doesn't exist.`, "fk", 2);
    if (!people.has(fm.reviewer)) issues.error(file, `${fm.id}: reviewer ${fm.reviewer} doesn't exist.`, "fk", 2);
    if (fm.status === "approved" && (!fm.approved_by || !fm.approved_on)) issues.error(file, `${fm.id}: an approved sheet needs approved_by and approved_on.`, "document", 2);
    if (fm.status !== "approved" && (fm.approved_by || fm.approved_on)) issues.error(file, `${fm.id}: only approved sheets have approved_by / approved_on.`, "document", 2);
    const cited = new Set<string>();
    const sections: DocBody["sections"] = [];
    for (const sec of sh.sections) {
      if (!sectionKeys.has(sec.key)) {
        issues.error(file, `Section "## ${sec.title}" must be one of: ${[...sectionKeys].map((k) => k[0].toUpperCase() + k.slice(1)).join(", ")}.`, "document", sec.line);
        continue;
      }
      for (const it of sec.items) {
        for (const id of it.cardIds) {
          cited.add(id);
          if (!fm.source_cards.includes(id)) issues.error(file, `${id} is cited but not listed in source_cards.`, "document", it.line);
        }
        if (/\b\d+(\.\d+)?\s?(sfm|rpm|ipm|ipr|ipt|mm\/min|m\/min)\b/i.test(it.text)) {
          issues.warn(file, "Setup sheets cite CAM program numbers, not speeds and feeds.", "speeds_feeds", it.line);
        }
      }
      sections.push({ key: sec.key as DocSectionKey, title: sec.title, items: sec.items.map((i) => ({ text: i.text, cardIds: i.cardIds })), ...(sec.table ? { table: sec.table } : {}) });
    }
    for (const id of fm.source_cards) {
      const ci = cards.get(id);
      if (!ci) issues.error(file, `${fm.id}: source card ${id} doesn't exist.`, "fk", 2);
      else if (ci.card.status !== "approved" && fm.status === "approved") issues.error(file, `${fm.id}: an approved sheet can only cite approved cards (${id} is ${ci.card.status}).`, "document", 2);
      if (!cited.has(id)) issues.warn(file, `${fm.id}: source card ${id} is never cited in the body.`, "document", 2);
    }
    const srcClasses = fm.source_cards.map((id) => cards.get(id)?.classification).filter((c): c is Classification => !!c);
    const linked: Classification[] = [];
    if (fm.part && partClass.has(fm.part)) linked.push(partClass.get(fm.part)!);
    if (fm.job && jobClass.has(fm.job)) linked.push(jobClass.get(fm.job)!);
    const floor = deriveDocumentFloor(srcClasses, { linkedRecordClasses: linked, textMentions: textFloor(fm.title, sh.body).mentions });
    const res = resolveClassification({ floor, defaultClass: maxClass(floor, "internal"), declared: fm.classification, subject: "document" });
    if (res.error) issues.error(file, `${fm.id}: ${res.error}`, "classification", 2);
    if (res.warning) issues.warn(file, `${fm.id}: ${res.warning}`, "classification", 2);
    const body: DocBody = { header: { partId: fm.part ?? undefined, machineId: fm.machine, programRefs: fm.program_refs }, sections };
    docRows.push({
      id: fm.id,
      kind: fm.kind,
      title: fm.title,
      status: fm.status,
      version: 1,
      supersedesId: null,
      machineId: fm.machine,
      partId: fm.part,
      jobId: fm.job,
      forPersonId: null,
      reviewerPersonId: fm.reviewer,
      authorPersonaId: null,
      generatedBy: "seed",
      body,
      bodyMd: sh.body,
      programRefs: fm.program_refs,
      submittedAt: fm.status === "draft" ? null : noon(fm.created_on),
      approvedAt: fm.approved_on ? noon(fm.approved_on) : null,
      approvedOn: fm.approved_on,
      approvedByPersonId: fm.approved_by,
      reviewNotes: null,
      scriptKey: null,
      searchText: [fm.title, ...sections.flatMap((s) => s.items.map((i) => i.text))].join("\n"),
      createdOn: fm.created_on,
      createdAt: noon(fm.created_on),
      updatedAt: noon(fm.approved_on ?? fm.created_on),
      classification: res.classification,
      classificationSource: res.source,
      classificationReason: res.reason,
    });
    let sort = 0;
    const firstSection = new Map<string, DocSectionKey>();
    for (const s of sections) for (const it of s.items) for (const id of it.cardIds) if (!firstSection.has(id)) firstSection.set(id, s.key);
    for (const id of fm.source_cards) {
      const approvedOn = cards.get(id)?.card.approved?.on;
      if (approvedOn && fm.created_on < approvedOn) {
        issues.error(file, `${fm.id}: created ${fm.created_on}, before its source card ${id} was approved (${approvedOn}).`, "date", 2);
      }
    }
    const docJobStart = fm.job ? jobs.get(fm.job)?.value.started_on : null;
    if (docJobStart && fm.created_on < docJobStart) issues.error(file, `${fm.id}: created before job ${fm.job} started.`, "date", 2);
    if (fm.approved_on && fm.approved_on < fm.created_on) issues.error(file, `${fm.id}: approved before it was created.`, "date", 2);
    if ((fm.approved_on ?? fm.created_on) > demoToday) issues.error(file, `${fm.id}: dated after DEMO_TODAY.`, "date", 2);
    for (const id of fm.source_cards) {
      if (!cards.has(id)) continue;
      docCardRows.push({ documentId: fm.id, cardId: id, cardVersion: 1, section: firstSection.get(id) ?? "cautions", sort: sort++ });
    }
  }

  const qrlRows: BundleTables["quoteReasoningLogs"] = [];
  for (const { file, line, value: l } of p.quoteLogs) {
    if (!quotes.has(l.quote)) issues.error(file, `${l.id}: quote ${l.quote} doesn't exist.`, "fk", line);
    if (!people.has(l.person)) issues.error(file, `${l.id}: person ${l.person} doesn't exist.`, "fk", line);
    const texts = [l.main_driver, l.machine_rationale, l.hours_rationale, l.risk_priced_in, l.what_would_change, l.junior_would_miss, l.variance_review];
    if (texts.some((t) => /\$\s?\d/.test(t))) issues.warn(file, `${l.id} contains a $ amount.`, "pricing", line);
    const floor = maxClass("internal", quoteClass.get(l.quote) ?? "export_controlled", textFloor(...texts).floor);
    qrlRows.push({
      id: l.id,
      quoteId: l.quote,
      interviewId: null,
      personId: l.person,
      mainDriver: l.main_driver,
      machineRationale: l.machine_rationale,
      hoursRationale: l.hours_rationale,
      riskPricedIn: l.risk_priced_in,
      riskBucket: l.risk_bucket,
      whatWouldChange: l.what_would_change,
      juniorWouldMiss: l.junior_would_miss,
      confidence1to5: l.confidence_1to5,
      varianceReviewMd: l.variance_review || null,
      createdAt: l.created_at,
      classification: floor,
      classificationSource: "derived",
      classificationReason: null,
    });
  }

  const eventRows: BundleTables["machineEvents"] = [];
  const eventIds = new Set<string>();
  for (const { file, line, value: m } of p.machines) {
    for (const ev of m.events) {
      if (eventIds.has(ev.id)) issues.error(file, `Machine event ${ev.id} is defined twice.`, "unique", line);
      eventIds.add(ev.id);
      if (ev.job && !jobs.has(ev.job)) issues.error(file, `${ev.id}: job ${ev.job} doesn't exist.`, "fk", line);
      if (ev.person && !people.has(ev.person)) issues.error(file, `${ev.id}: person ${ev.person} doesn't exist.`, "fk", line);
      if (ev.on > demoToday) issues.error(file, `${ev.id}: dated after DEMO_TODAY.`, "date", line);
      const evJob = ev.job ? jobs.get(ev.job)?.value : undefined;
      if (evJob?.started_on && ev.on < evJob.started_on) issues.error(file, `${ev.id}: dated before job ${ev.job} started.`, "date", line);
      if (evJob && evJob.actual_machine && evJob.actual_machine !== m.id) issues.error(file, `${ev.id}: job ${ev.job} ran on ${evJob.actual_machine}, not ${m.id}.`, "fk", line);
      const floor = maxClass("internal", ev.job ? (jobClass.get(ev.job) ?? "export_controlled") : "internal", textFloor(ev.summary).floor);
      const res = resolveClassification({ floor, defaultClass: floor, declared: ev.classification, subject: "machine event" });
      if (res.error) issues.error(file, `${ev.id}: ${res.error}`, "classification", line);
      eventRows.push({
        id: ev.id,
        machineId: m.id,
        occurredOn: ev.on,
        kind: ev.kind,
        summary: ev.summary,
        jobId: ev.job,
        personId: ev.person,
        classification: res.classification,
        classificationSource: res.source,
        classificationReason: res.reason,
      });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // The scripted live interview: expected cards must pass the same gate against R1–R4
  // ---------------------------------------------------------------------------------------------
  const rl = p.rayLive;
  const rlTurns: TraceTurn[] = rl.turns.map((t, i) => ({ id: `${rl.interview.id}-T${pad3(i + 1)}`, speaker: t.speaker, text: t.text }));
  const turnIdByKey = new Map(rl.turns.map((t, i) => [t.key, rlTurns[i].id]));
  if (turnIdByKey.size !== rl.turns.length) issues.error(FILES.rayLive, "Two turns share the same key.", "ray_live");
  const rlQuote = quotes.get(rl.interview.context_quote)?.value;
  if (!rlQuote) issues.error(FILES.rayLive, `context_quote ${rl.interview.context_quote} doesn't exist.`, "fk", p.rayLiveDoc?.lineOf(["interview", "context_quote"]));
  const rlPart = rlQuote ? parts.get(rlQuote.part)?.value : undefined;
  const rlSession: TraceSessionContext = {
    ...(rlQuote ? { quoteId: rlQuote.id, machineId: rlQuote.primary_machine, partId: rlQuote.part } : {}),
    ...(rlPart?.customer ? { customerId: rlPart.customer } : {}),
    topicId: rl.interview.topic,
  };
  const rlCandidates: TraceCandidate[] = rl.interview.candidates.map((c) => ({ kind: c.kind, id: c.id, mention: c.mention }));
  for (const c of rl.interview.candidates) {
    if (!linkExists(c.kind, c.id)) issues.error(FILES.rayLive, `Candidate ${c.kind} ${c.id} doesn't exist.`, "fk", p.rayLiveDoc?.lineOf(["interview", "candidates"]));
  }
  const expectedIds = rl.expected_cards.map((c) => c.id).sort();
  if (expectedIds.join() !== [...RESERVED.cards].join()) {
    issues.error(FILES.rayLive, `expected_cards must be exactly ${RESERVED.cards.join(", ")}.`, "ray_live", p.rayLiveDoc?.lineOf(["expected_cards"]));
  }
  rl.expected_cards.forEach((c, i) => {
    const line = p.rayLiveDoc?.lineOf(["expected_cards", i]);
    const asSeed = { ...c, source: { kind: "interview" as const, interview: rl.interview.id }, evidence: [] } as CardSeedT;
    checkCardCommon(FILES.rayLive, line, asSeed, "PER-01");
    const links: TraceLink[] = linkList(asSeed).map((l) => {
      const basis = c.link_basis[`${l.kind}:${l.id}`];
      if (!basis) issues.error(FILES.rayLive, `${c.id}: link ${l.kind}:${l.id} needs a link_basis (session_context or mentioned_candidate).`, "ray_live", line);
      const mention = rlCandidates.find((k) => k.kind === l.kind && k.id === l.id)?.mention;
      return { kind: l.kind, id: l.id, basis: basis ?? "session_context", ...(mention ? { mention } : {}) };
    });
    const evidence = c.evidence.map((e) => {
      const turnId = turnIdByKey.get(e.turn_key);
      if (!turnId) issues.error(FILES.rayLive, `${c.id}: evidence turn_key ${e.turn_key} doesn't exist.`, "ray_live", line);
      return { turnId: turnId ?? e.turn_key, quote: e.quote, confidence: e.confidence };
    });
    const res = checkCard(toTraceCard(asSeed, links, evidence), traceContext(rlTurns, rlSession, rlCandidates, false, cardText(asSeed).filter((t): t is string => !!t)));
    for (const e of res.errors) issues.error(FILES.rayLive, e.message, `traceability:${e.code}`, line);
  });

  // ---------------------------------------------------------------------------------------------
  // Names, anchors, pinned values
  // ---------------------------------------------------------------------------------------------
  const names = new Set(p.names.map((n) => n.value.name));
  if (!names.has(shop.name)) issues.error(FILES.names, `The shop name "${shop.name}" needs a collision-check entry.`, "names");
  for (const { value: c } of p.customers) if (!names.has(c.name)) issues.error(FILES.names, `Customer "${c.name}" needs a collision-check entry.`, "names");
  for (const { value: pe } of p.people) if (!names.has(pe.full_name)) issues.warn(FILES.names, `Person "${pe.full_name}" has no collision-check entry.`, "names");
  for (const { value: c } of p.customers) {
    const prefix = /^\^?([A-Z]+-)/.exec(c.part_number_pattern)?.[1];
    if (prefix && !names.has(prefix) && !names.has(prefix.replace(/-$/, ""))) issues.warn(FILES.names, `Part-number prefix "${prefix}" has no collision-check entry.`, "names");
  }

  const idSets: Record<string, Set<string>> = {
    people: new Set(people.keys()),
    personas: new Set(personas.keys()),
    customers: new Set(customers.keys()),
    parts: new Set(parts.keys()),
    quotes: new Set(quotes.keys()),
    jobs: new Set(jobs.keys()),
    cards: new Set(cards.keys()),
    documents: docIds,
  };
  for (const [kind, ids] of Object.entries(p.anchors.required_ids)) {
    const have = idSets[kind];
    if (!have) {
      issues.error(FILES.anchors, `required_ids: unknown record kind "${kind}".`, "demo_invariant");
      continue;
    }
    for (const id of ids) if (!have.has(id)) issues.error(FILES.anchors, `Demo invariant: required ${kind} ${id} is missing.`, "demo_invariant");
  }
  const seedRecord = (id: string): Record<string, unknown> | undefined =>
    (people.get(id) ?? customers.get(id) ?? parts.get(id) ?? quotes.get(id) ?? jobs.get(id) ?? machines.get(id) ?? materials.get(id))?.value as
      | Record<string, unknown>
      | undefined;
  for (const [key, expected] of Object.entries(p.anchors.pinned)) {
    const [id, field] = [key.slice(0, key.lastIndexOf(".")), key.slice(key.lastIndexOf(".") + 1)];
    const rec = seedRecord(id);
    if (!rec) {
      issues.error(FILES.anchors, `Demo invariant: pinned record ${id} doesn't exist.`, "demo_invariant");
      continue;
    }
    if (!(field in rec)) {
      issues.error(FILES.anchors, `Demo invariant: ${id} has no field "${field}".`, "demo_invariant");
      continue;
    }
    if (rec[field] !== expected) {
      issues.error(FILES.anchors, `Demo invariant: ${key} must be ${JSON.stringify(expected)} (found ${JSON.stringify(rec[field])}). The demo script and cached responses depend on it.`, "demo_invariant");
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Rows
  // ---------------------------------------------------------------------------------------------
  const judgmentDriversOf = (pt: PartSeedT): JudgmentDriver[] =>
    judgmentDrivers(pt.features, materials.get(pt.material)?.value.family, !!(pt.customer && customers.get(pt.customer)?.value.is_new_customer));
  const humanize = (s: string) => s.replace(/_/g, " ");

  const tables: BundleTables = {
    shopProfile: [
      {
        id: "shop",
        name: shop.name,
        employeeCount: shop.employee_count,
        certifications: shop.certifications,
        demoToday,
        seed: shop.seed,
        seedBundleHash: "",
        fictionalNotice: shop.fictional_notice,
      },
    ],
    people: p.people.map(({ value: pe }, i) => ({
      id: pe.id,
      fullName: pe.full_name,
      displayName: pe.display_name,
      jobTitle: pe.job_title,
      department: pe.department,
      appRole: pe.app_role,
      cohort: pe.cohort,
      hireDate: pe.hire_date,
      priorExperienceYears: pe.prior_experience_years,
      plannedDepartureDate: pe.planned_departure_date,
      departureKind: pe.departure_kind,
      isKnowledgeHolder: true,
      bioMd: pe.bio || null,
      redactionAliases: pe.aliases,
      sortOrder: i + 1,
    })),
    personas: p.personas.map(({ value: pe }, i) => ({
      id: pe.id,
      label: pe.label,
      role: pe.role,
      personId: pe.person,
      redactionAliases: pe.aliases,
      isDefaultForRole: pe.default_for_role,
      showInSwitcher: pe.show_in_switcher,
      sortOrder: i + 1,
    })),
    machines: p.machines.map(({ value: m }, i) => ({
      id: m.id,
      assetTag: m.asset_tag,
      name: m.name,
      make: m.make,
      model: m.model,
      kind: m.kind,
      yearInstalled: m.year_installed,
      acquired: m.acquired,
      locationCell: m.location_cell,
      status: m.status,
      capabilities: m.capabilities,
      unitHistoryMd: m.unit_history || null,
      sortOrder: i + 1,
    })),
    materials: p.materials.map(({ value: m }, i) => ({
      id: m.id,
      name: m.name,
      shortName: m.short_name,
      family: m.family,
      aliases: m.aliases,
      notesMd: m.notes || null,
      sortOrder: i + 1,
    })),
    customers: p.customers.map(({ value: c }, i) => ({
      id: c.id,
      name: c.name,
      industry: c.industry,
      segment: c.segment || null,
      customerSince: c.customer_since,
      isNewCustomer: c.is_new_customer,
      partClassificationFloor: c.part_classification_floor,
      qualityRequirementsMd: c.quality_requirements || null,
      redactionAliases: [c.name, ...c.aliases],
      partNumberPattern: c.part_number_pattern,
      sortOrder: i + 1,
      classification: c.classification,
      classificationSource: "derived",
      classificationReason: null,
    })),
    customerAccounts: p.customers.map(({ value: c }) => ({
      customerId: c.id,
      contactName: c.account.contact_name,
      contactEmail: c.account.contact_email,
      paymentTerms: c.account.payment_terms,
      annualSpendUsd: c.account.annual_spend_usd,
      pricingNotesMd: c.account.pricing_notes || null,
      classification: c.classification,
    })),
    topics: p.topics.map(({ value: t }, i) => ({
      id: t.id,
      category: t.category,
      label: t.label,
      description: t.description || null,
      machineId: t.machine,
      materialId: t.material,
      customerId: t.customer,
      sortOrder: i + 1,
    })),
    tags: p.tags.map(({ value: t }) => ({ id: t.id, label: t.label, topicId: t.topic, synonyms: t.synonyms })),
    personTopicExpertise: p.matrix.rows.flatMap((row) =>
      p.matrix!.personIds.map((pid, j) => ({
        personId: pid,
        topicId: row.topicId,
        tacitLevel: row.levels[j],
        assessedBy: "sme_seed" as const,
        assessedOn: demoToday,
        note: null,
      })),
    ),
    parts: allPartsL.map(({ value: pt }) => ({
      id: pt.id,
      customerId: pt.customer,
      partNumber: pt.part_number,
      revision: pt.revision,
      description: pt.description,
      family: pt.family,
      materialId: pt.material,
      features: pt.features,
      minWallIn: pt.min_wall_in,
      maxWallHeightIn: pt.max_wall_height_in,
      tightestTolIn: pt.tightest_tol_in,
      envelopeIn: pt.envelope_in,
      complexity: pt.complexity,
      exportControl: pt.export_control,
      isAnchor: pt.id.startsWith("PRT-A"),
      notesMd: pt.notes || null,
      classification: partMeta.get(pt.id)!.cls,
      classificationSource: partMeta.get(pt.id)!.source,
      classificationReason: partMeta.get(pt.id)!.reason,
    })),
    quotes: allQuotesL.map(({ value: q }) => {
      const pt = parts.get(q.part)!.value;
      const cust = pt.customer ? customers.get(pt.customer)?.value : undefined;
      const mat = materials.get(pt.material)?.value;
      const drivers = judgmentDriversOf(pt);
      return {
        id: q.id,
        quoteNumber: q.quote_number,
        partId: q.part,
        customerId: pt.customer!,
        quotedOn: q.quoted_on,
        quotedByPersonId: q.quoted_by,
        qty: q.qty,
        primaryMachineId: q.primary_machine,
        secondaryMachineId: q.secondary_machine,
        quotedSetupHours: q.quoted_setup_hours,
        quotedCycleMinutes: q.quoted_cycle_minutes,
        quotedHours: q.quoted_hours,
        leadTimeDays: q.lead_time_days,
        outcome: q.outcome,
        lostReason: q.lost_reason,
        judgmentDrivers: drivers,
        quoterNotesMd: q.notes || null,
        isAnchor: q.id.startsWith("Q-A"),
        searchTitle: `${pt.part_number} ${pt.description}`,
        searchText: [pt.description, cust?.name, mat?.name, mat?.short_name, ...pt.features.map(humanize), q.notes].filter(Boolean).join(" · "),
        searchTags: [pt.family, ...pt.features, ...drivers, pt.material].join(" "),
        classification: quoteMeta.get(q.id)!.cls,
        classificationSource: quoteMeta.get(q.id)!.source,
        classificationReason: quoteMeta.get(q.id)!.reason,
      };
    }),
    quoteFinancials: allQuotesL.map(({ value: q }) => ({
      quoteId: q.id,
      shopRateUsdPerHr: q.financials.shop_rate_usd_per_hr,
      materialCostUsd: q.financials.material_cost_usd,
      outsideProcessingUsd: q.financials.outside_processing_usd,
      riskAdderHours: q.financials.risk_adder_hours,
      scrapAllowancePct: q.financials.scrap_allowance_pct,
      unitPriceUsd: q.financials.unit_price_usd,
      totalPriceUsd: q.financials.total_price_usd,
      targetMarginPct: q.financials.target_margin_pct,
      classification: quoteClass.get(q.id)!,
    })),
    jobs: jobsL.map(({ value: j }) => {
      const q = j.quoteId ? quotes.get(j.quoteId)?.value : undefined;
      const variancePct = q && j.actual_hours !== null ? Math.round(((j.actual_hours - q.quoted_hours) / q.quoted_hours) * 1000) / 10 : null;
      return {
        id: j.id,
        jobNumber: j.job_number,
        quoteId: j.quoteId,
        partId: j.partId,
        status: j.status,
        startedOn: j.started_on,
        shippedOn: j.shipped_on,
        leadPersonId: j.lead,
        actualMachineId: j.actual_machine,
        actualSetupHours: j.actual_setup_hours,
        actualRunHours: j.actual_run_hours,
        actualHours: j.actual_hours,
        variancePct,
        scrapQty: j.scrap_qty,
        ncrCount: j.ncr_count,
        onTime: j.on_time,
        debriefMd: j.debrief || null,
        isAnchor: j.id.startsWith("J-A"),
        classification: jobMeta.get(j.id)!.cls,
        classificationSource: jobMeta.get(j.id)!.source,
        classificationReason: jobMeta.get(j.id)!.reason,
      };
    }),
    machineEvents: eventRows,
    interviews: interviewRows,
    interviewTurns: turnRows,
    consentRecords: consentRows,
    quoteReasoningLogs: qrlRows,
    knowledgeCards: [],
    cardLinks: [],
    cardTopics: [],
    cardTags: [],
    cardEvidence: [],
    documents: docRows,
    documentCards: docCardRows,
    coverageSnapshots: [],
  };

  const cardList = [...cards.values()].sort((a, b) => (a.card.id < b.card.id ? -1 : a.card.id > b.card.id ? 1 : 0));
  for (const ci of cardList) {
    const c = ci.card;
    const nameOf = (kind: TraceLink["kind"], id: string): string | undefined =>
      kind === "customer" ? customers.get(id)?.value.name
      : kind === "material" ? materials.get(id)?.value.name
      : kind === "machine" ? machines.get(id)?.value.name
      : undefined;
    const links = linkList(c);
    tables.knowledgeCards.push({
      id: c.id,
      version: 1,
      supersedesId: null,
      type: c.type,
      status: c.status,
      title: c.title,
      statement: c.statement,
      rationale: c.rationale,
      commonMistake: c.common_mistake,
      appliesWhen: c.applies_when,
      doesNotApplyWhen: c.does_not_apply_when,
      cues: c.cues,
      actions: c.actions,
      thresholds: c.thresholds as Threshold[],
      openQuestions: c.open_questions,
      expertConfidence: c.expert_confidence,
      sourcePersonId: ci.personId,
      recordedByPersonaId: null,
      sourceKind: c.source.kind,
      sourceInterviewId: ci.interviewId,
      createdBy: "seed",
      approvedByPersonId: c.approved?.by ?? null,
      approvedAt: c.approved ? noon(c.approved.on) : null,
      approvedOn: c.approved?.on ?? null,
      approvalMode: c.approved?.mode ?? null,
      reviewNotes: c.review_notes,
      scriptKey: null,
      searchText: [
        c.statement,
        c.rationale,
        ...c.applies_when,
        ...c.does_not_apply_when,
        ...c.cues,
        ...c.actions,
        c.common_mistake,
        ...links.map((l) => nameOf(l.kind, l.id)),
      ]
        .filter(Boolean)
        .join("\n"),
      searchTags: [
        ...c.tags.flatMap((t) => [t.replace(/-/g, " "), tags.get(t)?.value.label]),
        ...c.topics.map((t) => topics.get(t)?.value.label),
      ]
        .filter(Boolean)
        .join(" "),
      createdOn: c.created_on,
      createdAt: noon(c.created_on),
      updatedAt: noon(c.approved?.on ?? c.created_on),
      classification: ci.classification,
      classificationSource: ci.classSource,
      classificationReason: ci.classReason,
    });
    for (const l of links) {
      tables.cardLinks.push({
        cardId: c.id,
        kind: l.kind,
        jobId: l.kind === "job" ? l.id : null,
        quoteId: l.kind === "quote" ? l.id : null,
        partId: l.kind === "part" ? l.id : null,
        machineId: l.kind === "machine" ? l.id : null,
        materialId: l.kind === "material" ? l.id : null,
        customerId: l.kind === "customer" ? l.id : null,
        personId: l.kind === "person" ? l.id : null,
        mention: null,
        linkBasis: "seed",
      });
    }
    for (const t of new Set(c.topics)) tables.cardTopics.push({ cardId: c.id, topicId: t });
    for (const t of new Set(c.tags)) tables.cardTags.push({ cardId: c.id, tagId: t });
    for (const e of ci.evidence) {
      tables.cardEvidence.push({ cardId: c.id, turnId: e.turnId, startChar: e.start, endChar: e.end, quote: e.quote, confidenceEvidence: e.confidence });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Demo invariants (golden coverage, similar jobs, variance) and counts
  // ---------------------------------------------------------------------------------------------
  const inv = runInvariants({
    demoToday,
    anchors: p.anchors,
    people: p.people.map(({ value: pe }) => ({ id: pe.id, hireDate: pe.hire_date, plannedDepartureDate: pe.planned_departure_date })),
    topics: p.topics.map(({ value: t }) => ({ id: t.id })),
    expertise: [...expertise.entries()].map(([k, level]) => ({ personId: k.split("|")[0], topicId: k.split("|")[1], level })),
    cards: cardList.map((ci) => ({ id: ci.card.id, sourcePersonId: ci.personId, type: ci.card.type, confidence: ci.card.expert_confidence, status: ci.card.status, topicIds: ci.card.topics })),
    scriptedCards: rl.expected_cards.map((c) => ({ id: c.id, sourcePersonId: "PER-01", type: c.type, confidence: c.expert_confidence, status: "approved" as const, topicIds: c.topics })),
    customers: p.customers.map(({ value: c }) => ({ id: c.id, names: [c.name, ...c.aliases] })),
    materials: p.materials.map(({ value: m }) => ({ id: m.id, names: [m.name, m.short_name, ...m.aliases] })),
    synonyms: p.synonyms,
    jobs: tables.jobs.map((j) => {
      const pt = parts.get(j.partId)!.value;
      return {
        id: j.id,
        status: j.status,
        customerId: pt.customer,
        materialId: pt.material,
        features: pt.features,
        family: pt.family,
        minWallIn: pt.min_wall_in,
        complexity: pt.complexity,
        classification: j.classification,
        quotedHours: j.quoteId ? (quotes.get(j.quoteId)?.value.quoted_hours ?? null) : null,
        actualHours: j.actualHours ?? null,
        quotedBy: j.quoteId ? (quotes.get(j.quoteId)?.value.quoted_by ?? null) : null,
        drivers: j.quoteId ? judgmentDriversOf(pt) : [],
      };
    }),
    issues,
  });
  report.invariants = inv.report;

  // Hand-written cards, sheets, events, logs and interviews may tell stories about generated records ("ran an
  // hour over"). Record those records' facts; if the generator ever changes them, say which content to re-read.
  const refs: GeneratedRefs = {};
  const refer = (id: string | null | undefined, by: string) => {
    if (!id || !/^(PRT-G|Q-G|J-G)/.test(id)) return;
    const facts = generatedFacts(id);
    if (!facts) return;
    (refs[id] ??= { facts, referencedBy: [] }).referencedBy.push(by);
  };
  const generatedFacts = (id: string): GeneratedRefs[string]["facts"] | null => {
    const j = jobs.get(id)?.value;
    if (j) {
      const q = j.quoteId ? quotes.get(j.quoteId)?.value : undefined;
      return {
        job_number: j.job_number, part: j.partId, status: j.status, started_on: j.started_on, shipped_on: j.shipped_on,
        machine: j.actual_machine, lead: j.lead, quoted_hours: q?.quoted_hours ?? null, actual_hours: j.actual_hours,
        quoted_by: q?.quoted_by ?? null, scrap_qty: j.scrap_qty, ncr_count: j.ncr_count, on_time: j.on_time, debrief: j.debrief,
      };
    }
    const q = quotes.get(id)?.value;
    if (q) return { quote_number: q.quote_number, part: q.part, quoted_on: q.quoted_on, quoted_by: q.quoted_by, qty: q.qty, quoted_hours: q.quoted_hours, machine: q.primary_machine, outcome: q.outcome };
    const pt = parts.get(id)?.value;
    if (pt) return { part_number: pt.part_number, description: pt.description, material: pt.material, family: pt.family, features: pt.features.join("+"), customer: pt.customer };
    return null;
  };
  for (const ci of cardList) for (const l of linkList(ci.card)) refer(l.id, ci.card.id);
  for (const d of docRows) {
    refer(d.partId, d.id);
    refer(d.jobId, d.id);
  }
  for (const e of eventRows) refer(e.jobId, e.id);
  for (const l of qrlRows) refer(l.quoteId, l.id);
  for (const i of interviewRows) for (const id of [i.contextQuoteId, i.contextJobId, i.contextPartId]) refer(id, i.id);
  for (const r of Object.values(refs)) r.referencedBy = [...new Set(r.referencedBy)].sort();
  report.generatedRefs = refs;
  for (const [id, locked] of Object.entries(opts.lockedGeneratedRefs ?? {})) {
    const now = refs[id];
    if (!now) continue; // no longer referenced
    const changed = Object.keys(locked.facts).filter((k) => JSON.stringify(locked.facts[k]) !== JSON.stringify(now.facts[k]));
    if (changed.length > 0) {
      issues.error(
        FILES.families,
        `Generated record ${id} changed (${changed.map((k) => `${k}: ${JSON.stringify(locked.facts[k])} → ${JSON.stringify(now.facts[k])}`).join("; ")}). ` +
          `Re-read ${now.referencedBy.join(", ")} (they may describe the old values), then run npm run seed:lock.`,
        "generated_ref",
      );
    }
  }

  tables.coverageSnapshots = inv.baseline.map((b) => ({ ...b, takenAt: noon(demoToday), reason: "seed_baseline" as const }));

  // Counts (warnings only) and the classification mix.
  const count = (name: string, actual: number, target: number) => {
    report.counts[name] = actual;
    if (actual !== target) issues.warn("(counts)", `${name}: ${actual} (the brief's target is ${target}).`, "count_drift");
  };
  count("parts", tables.parts.length, TARGETS.parts);
  count("quotes", tables.quotes.length, TARGETS.totalQuotes);
  count("jobs", tables.jobs.length, TARGETS.jobs);
  count("cards", tables.knowledgeCards.length, TARGETS.cards);
  for (const t of CARD_TYPES) count(`cards.${t}`, tables.knowledgeCards.filter((c) => c.type === t).length, TARGETS.cardTypes[t]);
  for (const [st, n] of Object.entries(TARGETS.cardStatuses)) count(`cards.${st}`, tables.knowledgeCards.filter((c) => c.status === st).length, n);
  count("transcripts", p.transcripts.length, TARGETS.transcripts);
  count("setup sheets", docRows.length, TARGETS.setupSheets);
  count("quote reasoning logs", qrlRows.length, TARGETS.quoteLogs);
  for (const [name, rows] of Object.entries({ parts: tables.parts, quotes: tables.quotes, jobs: tables.jobs, cards: tables.knowledgeCards, documents: tables.documents, interviews: tables.interviews.filter((i) => !i.isHidden) })) {
    const mix = emptyMix();
    for (const r of rows as { classification: Classification }[]) mix[r.classification]++;
    report.classificationMix[name] = mix;
  }

  if (issues.errorCount > 0) return { bundle: null, issues: issues.items, report };
  return { bundle: sealBundle(demoToday, shop.seed, tables), issues: issues.items, report };
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function tryGenerate(issues: IssueList, input: Parameters<typeof generateCommerce>[0]): ReturnType<typeof generateCommerce> | null {
  try {
    return generateCommerce(input);
  } catch (e) {
    if (!(e instanceof GeneratorError)) throw e;
    issues.error(FILES.families, `The generator couldn't build the parts and quotes: ${e.message}`, "generator");
    return null;
  }
}

export function manualInterviewId(personId: string): string {
  return `INT-M-${personId}`;
}

/**
 * A binder/manual card's provenance turn: its seq is the card number (KC-026 → INT-M-PER-02-T026), so turn IDs are
 * as permanent as card IDs.
 */
function manualTurnId(interviewId: string, cardId: string): string {
  return `${interviewId}-T${cardId.slice(3)}`;
}

function uniqueMap<T extends { id: string }>(items: Located<T>[], label: string, issues: IssueList): Map<string, Located<T>> {
  const map = new Map<string, Located<T>>();
  for (const it of items) {
    const prev = map.get(it.value.id);
    if (prev) {
      issues.error(it.file, `The ${label} ID ${it.value.id} is used twice (also in ${prev.file}${prev.line ? `:${prev.line}` : ""}).`, "unique", it.line);
      continue;
    }
    map.set(it.value.id, it);
  }
  return map;
}

function checkUnique(items: { file: string; line?: number; key: string; label: string }[], issues: IssueList): void {
  const seen = new Map<string, string>();
  for (const it of items) {
    const prev = seen.get(it.key);
    if (prev) issues.error(it.file, `The ${it.label} is used twice (also in ${prev}).`, "unique", it.line);
    else seen.set(it.key, it.file);
  }
}

/**
 * Process topic → the words that support filing a card under it: each mapped tag's `evidence_words`, or just its
 * label and ID when none are given. Search synonyms are deliberately not used ("hours" must not make a card a
 * quoting card).
 */
function processTopicWords(p: ParsedSeed): Record<string, string[]> {
  const process = new Set(p.topics.filter((t) => t.value.category === "process").map((t) => t.value.id));
  const out: Record<string, string[]> = {};
  for (const { value: t } of p.tags) {
    if (!t.topic || !process.has(t.topic)) continue;
    (out[t.topic] ??= []).push(...(t.evidence_words ?? [t.label, t.id.replace(/-/g, " "), t.id]));
  }
  return out;
}

