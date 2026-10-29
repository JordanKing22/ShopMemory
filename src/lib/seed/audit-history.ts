/**
 * Seeded audit history (docs/AI-GATEWAY.md §12): seed-data/audit/history.yaml → ai_audit_log rows. Fictional examples
 * for the /audit page, labelled "Seeded example (fictional)" with "scripted (not model output)" answers: transport
 * `seeded` (or `none` when nothing was sent), request IDs SEED-0001…, explicit row IDs 1…N. Reset never archives them.
 *
 * seed:check (with file:line) rejects: names or record numbers in any text (dictionaryHits), tokens that aren't entity
 * tokens of this seed's dictionary (pattern tokens would be unresolvable after a reset), decisions that don't match the
 * routing matrix (a sent record not cleared for the target, a withheld one that was), inconsistent transport / notice /
 * outcome fields, unknown records or personas, dates on or after DEMO_TODAY, and a parent that isn't an earlier row.
 * Pure: the caller passes the parsed rows, the tables built so far and the issue list.
 */
import { z } from "zod";
import {
  AI_MODES,
  AUDIT_DECISIONS,
  AUDIT_OUTCOMES,
  CLASS_RANK,
  CLASSIFICATIONS,
  PROVIDER_KINDS,
  TARGET_CLASSES,
  type Classification,
} from "@/db/schema/enums";
import { FEATURES, TASK_NAMES, type ProviderRequest } from "@/lib/ai/types";
import { APP_VERSION, type AuditInsert } from "@/lib/audit/types";
import { dictionaryInputFromTables, type DictionarySourceTables } from "@/lib/data/dictionary";
import { NOTICE_KEYS, WITHHELD_REASONS, type Notice } from "@/lib/policy/types";
import { POLICY_VERSION, TARGET_IS_CLOUD, allowed, crossRegionOf, isLoopbackHost } from "@/lib/policy/matrix";
import { noticeParamsAreSafe } from "@/lib/policy/notices";
import { buildRedactionDictionary, dictionaryHits } from "@/lib/redaction/dictionary";
import { isToken, tokensIn } from "@/lib/redaction/patterns";
import type { BundleTables } from "./bundle";
import { canonicalJson, sha256Hex, type IssueList } from "./source";

const isoTs = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, "use an ISO timestamp like 2026-09-02T14:05:11Z");
const ref = z.string().regex(/^(card|job|quote|part|customer):[A-Za-z0-9-]+$/, 'use a record reference like "job:J-A06"');

const RequestYaml = z
  .object({
    system: z.string(),
    messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }).strict()).min(1),
    max_tokens: z.number().int().positive(),
    output: z.union([
      z.object({ kind: z.literal("text") }).strict(),
      z.object({ kind: z.literal("json"), schema_name: z.string(), json_schema: z.record(z.string(), z.unknown()) }).strict(),
    ]),
    effort: z.enum(["low", "medium", "high"]).optional(),
  })
  .strict();

export const AuditHistoryFile = z.array(
  z
    .object({
      id: z.string().regex(/^SEED-\d{4}$/, "ID must look like SEED-0001"),
      created_at: isoTs,
      completed_at: isoTs,
      actor_persona: z.string(),
      feature: z.enum(FEATURES),
      task: z.enum(TASK_NAMES),
      prompt_version: z.string().min(1),
      mode: z.enum(AI_MODES),
      decision: z.enum(AUDIT_DECISIONS),
      provider_kind: z.enum(PROVIDER_KINDS),
      target_class: z.enum(TARGET_CLASSES),
      model: z.string().min(1),
      endpoint_host: z.string().min(1),
      region: z.string().nullable(),
      cross_region: z.enum(["global", "geo", "none", "unknown"]).nullable(),
      max_classification: z.enum(CLASSIFICATIONS),
      classifications_included: z.array(z.enum(CLASSIFICATIONS)).min(1),
      records_sent: z.array(ref),
      records_withheld: z.array(z.object({ ref, classification: z.enum(CLASSIFICATIONS), reason: z.enum(WITHHELD_REASONS) }).strict()),
      notice: z.object({ key: z.enum(NOTICE_KEYS), params: z.record(z.string(), z.union([z.string(), z.number()])) }).strict().nullable(),
      user_input: z.string().nullable(),
      request: RequestYaml.nullable(),
      response: z.string().nullable(),
      usage: z.object({ input_tokens: z.number().int().nullable(), output_tokens: z.number().int().nullable() }).strict().nullable(),
      latency_ms: z.number().int().nonnegative(),
      ttft_ms: z.number().int().nonnegative().nullable(),
      stop_reason: z.string().nullable(),
      outcome: z.enum(AUDIT_OUTCOMES),
      error_code: z.string().nullable(),
      citations: z.object({ valid: z.number().int().nonnegative(), stripped: z.number().int().nonnegative() }).strict(),
      parent: z.string().nullable(),
    })
    .strict(),
);

export type AuditHistorySeed = z.infer<typeof AuditHistoryFile>[number];

export interface LocatedAuditRow {
  file: string;
  line?: number;
  value: AuditHistorySeed;
}

const SEND = new Set(["allow", "withheld_partial", "user_excluded_controlled"]);
const SENT_OUTCOMES = new Set(["ok", "refusal", "invalid_output", "provider_error", "timeout", "aborted"]);

function toProviderRequest(r: z.infer<typeof RequestYaml>): ProviderRequest {
  const out: ProviderRequest = {
    system: r.system,
    messages: r.messages,
    maxTokens: r.max_tokens,
    output: r.output.kind === "json" ? { kind: "json", schemaName: r.output.schema_name, jsonSchema: r.output.json_schema as never } : { kind: "text" },
  };
  if (r.effort) out.effort = r.effort;
  return out;
}

function stringsOf(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringsOf(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      stringsOf(x, out);
    }
  }
  return out;
}

export function buildAuditHistory(rows: readonly LocatedAuditRow[], tables: BundleTables, demoToday: string, issues: IssueList): AuditInsert[] {
  if (rows.length === 0) return [];
  const dict = buildRedactionDictionary(dictionaryInputFromTables(tables as unknown as DictionarySourceTables));
  const personas = new Map(tables.personas.map((p) => [p.id, p]));
  const classOf = new Map<string, Classification>();
  for (const c of tables.knowledgeCards) classOf.set(`card:${c.id}`, c.classification as Classification);
  for (const j of tables.jobs) classOf.set(`job:${j.id}`, j.classification as Classification);
  for (const q of tables.quotes) classOf.set(`quote:${q.id}`, q.classification as Classification);
  for (const p of tables.parts) classOf.set(`part:${p.id}`, p.classification as Classification);
  for (const c of tables.customers) classOf.set(`customer:${c.id}`, c.classification as Classification);
  const approved = new Set(tables.knowledgeCards.filter((c) => c.status === "approved").map((c) => `card:${c.id}`));
  const idsSeen = new Map<string, number>();
  const out: AuditInsert[] = [];

  rows.forEach(({ file, line, value: r }, i) => {
    const err = (msg: string) => issues.error(file, `${r.id}: ${msg}`, "audit_history", line);
    const expected = `SEED-${String(i + 1).padStart(4, "0")}`;
    if (r.id !== expected) err(`IDs must be sequential: expected ${expected}.`);
    if (idsSeen.has(r.id)) err("This ID is used twice.");
    idsSeen.set(r.id, i + 1);

    const persona = personas.get(r.actor_persona);
    if (!persona) err(`Persona ${r.actor_persona} doesn't exist (see personas.yaml).`);
    if (r.created_at.slice(0, 10) >= demoToday) err(`created_at must be before the demo date ${demoToday}.`);
    if (r.completed_at < r.created_at) err("completed_at is earlier than created_at.");

    // Text: tokens only, no names or numbers.
    const request = r.request ? toProviderRequest(r.request) : null;
    const texts = [r.user_input ?? "", r.response ?? "", ...stringsOf(request)];
    for (const t of texts) {
      if (dictionaryHits(t, dict).length > 0) err("Contains a name, customer, part, job or quote number. Write its [[…]] token instead.");
      for (const tok of tokensIn(t)) {
        if (!isToken(tok) || !dict.entityTokens.has(tok)) err(`${tok} isn't a token this seed produces (only customer, person, part, job and quote tokens can be used here).`);
      }
    }
    const brackets = texts.join(" ").match(/\[\[[^\]]*\]\]/g) ?? [];
    for (const b of brackets) if (!isToken(b)) err(`"${b.slice(0, 24)}" looks like a token but isn't one.`);

    // Target and decision consistency.
    const kindOk =
      (r.provider_kind === "anthropic" && r.target_class === "anthropic") ||
      (r.provider_kind === "bedrock" && (r.target_class === "bedrock_commercial" || r.target_class === "bedrock_govcloud")) ||
      (r.provider_kind === "ollama" && r.target_class === "ollama_local");
    if (!kindOk) err("provider_kind and target_class don't match.");
    if (r.target_class === "ollama_local" && !isLoopbackHost(r.endpoint_host)) err("Local rows must use a loopback endpoint_host (127.0.0.1).");
    if (r.provider_kind === "bedrock" && r.cross_region !== crossRegionOf(r.model)) err(`cross_region must be ${crossRegionOf(r.model)} for this model ID.`);
    const sending = SEND.has(r.decision);
    if (sending) {
      if (!request) err("A sent call needs its request.");
      if (!SENT_OUTCOMES.has(r.outcome)) err(`Outcome ${r.outcome} doesn't fit a sent call.`);
      if (r.outcome === "ok" && r.response === null) err("An ok call needs a response.");
    } else {
      if (request || r.response) err("Blocked and held calls send nothing: request and response must be null.");
      if (r.outcome !== r.decision) err(`Outcome must be ${r.decision}.`);
      if (r.records_sent.length > 0) err("Blocked and held calls send no records.");
      if (!r.notice) err("Blocked and held calls need their notice.");
    }
    if (r.notice && !noticeParamsAreSafe(r.notice.params)) err("Notice params may hold only IDs, enums, counts and hosts.");
    if (r.decision === "withheld_partial" && r.records_withheld.length === 0) err("withheld_partial needs at least one withheld record.");

    const opts = { coveredModel: false, crossRegion: r.cross_region ?? undefined };
    for (const s of r.records_sent) {
      const c = classOf.get(s);
      if (!c) err(`${s} doesn't exist.`);
      else {
        if (s.startsWith("card:") && !approved.has(s)) err(`${s} isn't approved (only approved cards feed answers).`);
        if (!allowed(c, r.target_class, opts)) err(`${s} is ${c}, which ${r.target_class} isn't cleared for.`);
        if (CLASS_RANK[c] > CLASS_RANK[r.max_classification]) err(`max_classification is lower than ${s} (${c}).`);
        if (!r.classifications_included.includes(c)) err(`classifications_included is missing ${c} (${s}).`);
      }
    }
    for (const w of r.records_withheld) {
      const c = classOf.get(w.ref);
      if (!c) err(`${w.ref} doesn't exist.`);
      else {
        if (c !== w.classification) err(`${w.ref} is ${c}, not ${w.classification}.`);
        if (allowed(c, r.target_class, opts)) err(`${w.ref} would be cleared for ${r.target_class}, so it wouldn't be withheld.`);
      }
    }
    let parentId: number | null = null;
    if (r.parent !== null) {
      parentId = idsSeen.get(r.parent) ?? null;
      if (parentId === null || parentId >= i + 1) err("parent must be an earlier row.");
    }

    const stored = request ? canonicalJson(request) : null;
    const tokensUsed = [...new Set(texts.flatMap((t) => tokensIn(t)))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    out.push({
      id: i + 1,
      createdAt: r.created_at,
      completedAt: r.completed_at,
      requestId: r.id,
      parentId,
      attempt: parentId ? 2 : 1,
      actorPersonId: persona?.personId ?? null,
      actorPersonaId: r.actor_persona,
      actorRole: persona?.role ?? "owner",
      feature: r.feature,
      task: r.task,
      mode: r.mode,
      decision: r.decision,
      providerKind: r.provider_kind,
      targetClass: r.target_class,
      model: r.model,
      servedModel: null,
      endpointHost: r.endpoint_host,
      region: r.region,
      crossRegion: r.cross_region,
      isCloud: TARGET_IS_CLOUD[r.target_class],
      transport: sending ? "seeded" : "none",
      cassetteProvenance: sending && r.response !== null ? "hand_authored" : null,
      maxClassification: r.max_classification,
      classificationsIncluded: r.classifications_included,
      recordsSent: r.records_sent,
      recordsWithheld: r.records_withheld,
      noticeKey: r.notice?.key ?? null,
      noticeParams: (r.notice?.params as Notice["params"] | undefined) ?? null,
      redactionTokenCount: tokensUsed.length,
      tokensUsed,
      userInputRedacted: r.user_input,
      requestPayloadRedacted: stored,
      payloadHash: stored ? sha256Hex(stored) : null,
      payloadStoredForm: sending ? (TARGET_IS_CLOUD[r.target_class] ? "as_sent_redacted" : "redacted_for_storage") : null,
      responseRedacted: r.response,
      promptVersion: r.prompt_version,
      inputTokens: r.usage?.input_tokens ?? null,
      outputTokens: r.usage?.output_tokens ?? null,
      latencyMs: r.latency_ms,
      ttftMs: r.ttft_ms,
      stopReason: r.stop_reason,
      outcome: r.outcome,
      errorCode: r.error_code,
      citationsValid: r.citations.valid,
      citationsStripped: r.citations.stripped,
      policyVersion: POLICY_VERSION,
      appVersion: APP_VERSION,
      demoEpoch: 0,
    });
  });
  return out;
}
