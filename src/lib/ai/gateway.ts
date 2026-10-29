/**
 * runAI() — the ONLY path to a model (CLAUDE.md hard rule 1; PLAN.md §4.2; docs/AI-GATEWAY.md §2, §10).
 *
 *   P0 context · P1 role projection · P2 budget · P3 classify · P4 decide · P5 notice · P6 assemble · P7 redact · P8 freeze
 *   ── a dry run (the "What will be sent" preview) returns here, byte-identical to what a real call would send ──
 *   R1 audit write-ahead · R2 transport (live adapter OR ReplayTransport: the only step that differs in DEMO_MODE)
 *   R3 restore tokens · R4 post-process (citations, JSON + one repair retry, refusal) · R5 audit finalize · R6 emit
 *
 * Callers pass record REFERENCES and user text; the gateway loads, projects and classifies records itself. Errors
 * before R1 produce no audit row (the route answers with the error's status); every run that reaches R1 has exactly one
 * audit row (plus a child row per repair retry), and its stream ends with `done`.
 *
 * Imports no server-only module, so scripts and tests construct it directly with injected dependencies.
 */
import { eq } from "drizzle-orm";
import { askThreads, interviews, CLASSIFICATIONS, maxClass, type Classification, type PayloadStoredForm } from "@/db/schema";
import { finalize as finalizeAudit, writeAhead, writeComplete } from "@/lib/audit/ai-audit";
import { writeEvent } from "@/lib/audit/events";
import { createPatternTokenResolver, persistPatternTokens } from "@/lib/audit/token-store";
import { APP_VERSION, type AuditTargetFields, type AuditWithheld } from "@/lib/audit/types";
import { can, canSee, hiddenLabel } from "@/lib/auth/roles";
import { labelForId } from "@/lib/data/audit";
import { cachedRedactionDictionary } from "@/lib/data/dictionary";
import { getPersonaWithRole } from "@/lib/data/personas";
import { sdkEnvOverridesPresent } from "@/lib/env";
import { formatProviderLine } from "@/lib/format";
import { classifyRequest } from "@/lib/policy/classify-request";
import { decide } from "@/lib/policy/decide";
import { POLICY_VERSION } from "@/lib/policy/matrix";
import { renderNotice } from "@/lib/policy/notices";
import { PROVIDER_LABEL, getRoutingSummary, resolveEffectiveRouting, type RoutingSummary } from "@/lib/policy/summary";
import type { BudgetedRecord, Decision, EffectiveRouting, PolicyTarget, RequestClassification } from "@/lib/policy/types";
import type { CompiledRedactionDictionary } from "@/lib/redaction/dictionary";
import { redactRequest, redactText } from "@/lib/redaction/redact";
import { StreamRestorer, detokenizeEntities, restoreJsonStrings } from "@/lib/redaction/restore";
import { parseToken } from "@/lib/redaction/patterns";
import type { PatternTokenRecord, RedactionResult, TokenMap } from "@/lib/redaction/types";
import { capsFor } from "./caps";
import { AIError, toAIError, type AIErrorCode } from "./errors";
import { createHealthSource } from "./health";
import { payloadHashOf, previewTokenOf, promptJsonInstruction, sourceFingerprint, sourceKey } from "./pipeline/assemble";
import { loadRecordsForLlm, type LoadedRecord } from "./projection";
import { kindsForMode, liveCapable, readAiRoutingSetting, readDemoEpoch, resolveTargets, transportPolicyOf, usesLiveProbe } from "./routing";
import { TASKS } from "./tasks";
import type { TaskDefinition, TaskRegistry } from "./tasks/types";
import { canonicalJson } from "@/lib/seed/source";
import {
  refKey,
  type AIPreview,
  type AIRequest,
  type AIRun,
  type AIRunResult,
  type AIStreamEvent,
  type AuditOutcome,
  type GatewayDeps,
  type HealthReport,
  type ProviderDescriptor,
  type ProviderHealth,
  type ProviderKind,
  type ProviderRequest,
  type ProviderResponse,
  type PublicDecision,
  type PublicTarget,
  type ResolvedTransport,
  type RoutedBadge,
  type RunOptions,
  type SourceChip,
  type TokenLegendEntry,
  type TransportContext,
  type TransportPolicy,
} from "./types";

export const MAX_TEXT = 4000;
export const MAX_TURNS = 40;
export const REPAIR_INSTRUCTION =
  "That output was not valid JSON for the required schema. Reply again with only the JSON object, matching the schema exactly.";

export interface Gateway {
  runAI(req: AIRequest, opts: { dryRun: true }): Promise<AIPreview>;
  runAI(req: AIRequest, opts?: RunOptions): AIRun;
  healthReport(deep: boolean): Promise<HealthReport>;
  /** Pre-loads Ollama with the identical options; null when the effective mode doesn't use a live Ollama. */
  warm(): Promise<ProviderHealth | null>;
  routing(): { effective: EffectiveRouting; summary: RoutingSummary };
}

interface SentSource {
  key: string;
  ref: LoadedRecord["ref"];
  record: LoadedRecord;
  fingerprint: string;
}

interface Prepared {
  requestId: string;
  req: AIRequest;
  task: TaskDefinition;
  taskInput: unknown;
  effective: EffectiveRouting;
  policy: TransportPolicy;
  dict: CompiledRedactionDictionary;
  epoch: number;
  classification: RequestClassification;
  decision: Decision;
  budget: BudgetedRecord[];
  loaded: Map<string, LoadedRecord>;
  sources: SentSource[];
  userText: string;
  userInput: RedactionResult<string> | null;
  /** Send decisions only. */
  send: {
    target: PolicyTarget;
    providerRequest: ProviderRequest;
    sentRequest: ProviderRequest;
    storedRequest: ProviderRequest;
    redaction: RedactionResult<ProviderRequest>;
    storedForm: PayloadStoredForm;
    payloadHash: string;
    previewToken: string;
  } | null;
  minted: PatternTokenRecord[];
  tokensUsed: string[];
  publicDecision: PublicDecision;
  sourceChips: SourceChip[];
  badgeText: string;
}

const sortTokens = (xs: Iterable<string>) => [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

function mergeMinted(...lists: PatternTokenRecord[][]): PatternTokenRecord[] {
  const seen = new Set<string>();
  const out: PatternTokenRecord[] = [];
  for (const l of lists) {
    for (const m of l) {
      if (seen.has(m.token)) continue;
      seen.add(m.token);
      out.push(m);
    }
  }
  return out;
}

function badgeTextFor(d: ProviderDescriptor): string {
  return formatProviderLine({
    targetClass: d.targetClass,
    providerLabel: PROVIDER_LABEL[d.kind],
    model: d.model,
    host: d.host,
    region: d.region,
    isLoopback: d.isLoopback,
    locality: d.locality,
    crossRegion: d.crossRegion,
    fips: d.fips,
  });
}

function publicTarget(d: ProviderDescriptor): PublicTarget {
  const t: PublicTarget = {
    kind: d.kind,
    targetClass: d.targetClass,
    providerLabel: PROVIDER_LABEL[d.kind],
    model: d.model,
    host: d.host,
    isCloud: d.isCloud,
    isLoopback: d.isLoopback,
    redacted: d.isCloud,
    coveredModel: d.coveredModel,
    verified: d.verified,
  };
  if (d.region) t.region = d.region;
  if (d.crossRegion) t.crossRegion = d.crossRegion;
  if (d.fips !== undefined) t.fips = d.fips;
  return t;
}

function auditTarget(d: ProviderDescriptor | undefined | null): AuditTargetFields | null {
  if (!d) return null;
  return {
    providerKind: d.kind,
    targetClass: d.targetClass,
    model: d.model,
    endpointHost: d.host,
    region: d.region ?? null,
    crossRegion: d.crossRegion ?? null,
    isCloud: d.isCloud,
  };
}

function outcomeFor(code: AIErrorCode): Exclude<AuditOutcome, "pending" | "blocked" | "held" | "ok"> {
  if (code === "aborted") return "aborted";
  if (code === "provider_timeout") return "timeout";
  if (code === "refusal") return "refusal";
  if (code === "invalid_output") return "invalid_output";
  return "provider_error";
}

function rankOrdered(cs: Iterable<Classification>): Classification[] {
  const set = new Set(cs);
  return CLASSIFICATIONS.filter((c) => set.has(c));
}

export function createGateway(deps: GatewayDeps): Gateway {
  const { db, env } = deps;
  const tasks: TaskRegistry = { ...TASKS, ...(deps.tasks as TaskRegistry | undefined) };
  const healthStore = deps.healthStore ?? new Map();
  const policyNow = () => transportPolicyOf(env, deps.transportPolicyOverride);

  function effectiveRouting(): EffectiveRouting {
    if (deps.routingOverride) return { ...deps.routingOverride, source: "setting", locked: false };
    return resolveEffectiveRouting(env, readAiRoutingSetting(db));
  }

  const health = createHealthSource(
    (d) => deps.providers(d),
    (kind) => resolveTargets(env, { mode: kind === "ollama" ? "local" : "cloud", cloudProvider: kind === "bedrock" ? "bedrock" : "anthropic", source: "env", locked: false }, policyNow(), () => null).descriptors[kind] ?? null,
    () => deps.now().getTime(),
    healthStore,
  );

  async function refreshLiveHealth(effective: EffectiveRouting, policy: TransportPolicy): Promise<void> {
    for (const kind of kindsForMode(env, effective)) {
      if (usesLiveProbe(kind, policy) && !health.fresh(kind)) await health.refresh(kind, false);
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // P0–P8
  // -------------------------------------------------------------------------------------------------------------
  async function prepare(req: AIRequest, requestId: string): Promise<Prepared> {
    // P0 — context
    const task = tasks[req.task];
    if (!task) throw new AIError("task_unknown");
    if (!task.features.includes(req.feature)) throw new AIError("invalid_request");
    if (!can(req.actor.role, task.capability, { demoOpenControls: env.DEMO_OPEN_CONTROLS })) throw new AIError("forbidden");
    const text = req.input?.text ?? "";
    const turns = req.input?.turns ?? [];
    if (text.length > MAX_TEXT || turns.length > MAX_TURNS || turns.some((t) => t.text.length > MAX_TEXT)) throw new AIError("invalid_request");
    const pinnedRefs = req.pinned ?? [];
    if (pinnedRefs.length > task.maxPinned) throw new AIError("invalid_request");
    if (task.consent === "required" && !req.consentId) throw new AIError("consent_required");
    const persona = getPersonaWithRole(db, req.actor.personaId);
    if (!persona || persona.role !== req.actor.role || persona.personId !== req.actor.personId) throw new AIError("forbidden");

    const effective = effectiveRouting();
    const policy = policyNow();
    await refreshLiveHealth(effective, policy);
    const { targets } = resolveTargets(env, effective, policy, (k) => health.get(k));
    const dict = cachedRedactionDictionary(db);
    const epoch = readDemoEpoch(db);

    let session: Classification | null = null;
    if (req.threadId) {
      const t = db.select({ c: askThreads.classification }).from(askThreads).where(eq(askThreads.id, req.threadId)).get();
      if (!t) throw new AIError("invalid_request");
      session = t.c;
    }
    if (req.sessionId) {
      const s = db.select({ c: interviews.classification }).from(interviews).where(eq(interviews.id, req.sessionId)).get();
      if (!s) throw new AIError("invalid_request");
      session = session ? maxClass(session, s.c) : s.c;
    }

    // P1 — role projection (records the role can't see are dropped silently) · P2 — budget (pinned first, in order)
    const pinnedLoaded = loadRecordsForLlm(db, req.actor.role, pinnedRefs);
    const loaded = new Map(pinnedLoaded.map((r) => [refKey(r.ref), r]));
    const retrievedRefs = deps.retrieve?.(req.task, { text: req.retrievalQuery ?? text, pinned: pinnedLoaded.map((r) => r.ref), role: req.actor.role }) ?? [];
    const retrieved = loadRecordsForLlm(db, req.actor.role, retrievedRefs).filter((r) => !loaded.has(refKey(r.ref)));
    for (const r of retrieved) loaded.set(refKey(r.ref), r);
    const budget: BudgetedRecord[] = [...pinnedLoaded, ...retrieved].map((r, i) => ({ ref: r.ref, classification: r.classification, rank: i + 1 }));
    const ctx = { actorName: persona.fullName, input: { text, turns }, pinned: pinnedLoaded.map((r) => r.ref) };

    // P3 — classify (user text only)
    const userText = [text, ...turns.filter((t) => t.role === "user").map((t) => t.text)].filter(Boolean).join("\n");
    const classification = classifyRequest(
      { text: userText, taskFloor: task.classificationFloor, session, pinned: pinnedLoaded.map((r) => ({ ref: r.ref, classification: r.classification })) },
      dict.entityDict,
    );

    // P4 — decide · P5 — notice
    const decision = decide({
      mode: effective.mode,
      request: classification,
      budget,
      targets,
      excludeAboveClearance: req.excludeAboveClearance === true,
      confirmNotControlled: req.confirmNotControlled === true,
      pinned: pinnedLoaded.map((r) => ({ ref: r.ref, classification: r.classification })),
    });
    const noticeText = decision.notice ? renderNotice(decision.notice, { role: req.actor.role, recordLabel: (id) => labelForId(db, id) }) : null;

    const patterns = createPatternTokenResolver(db); // read-only here; minted tokens are persisted at R1
    const userInput = userText ? redactText(userText, dict, patterns, { field: "user_input" }) : null;

    const isSend = decision.kind !== "blocked" && decision.kind !== "held";
    const sentRecords = isSend ? decision.sent : [];
    const sources: SentSource[] = sentRecords.map((b, i) => {
      const record = loaded.get(refKey(b.ref))!;
      return { key: sourceKey(i), ref: b.ref, record, fingerprint: sourceFingerprint(b.ref, record.projection) };
    });

    let send: Prepared["send"] = null;
    let minted = userInput?.minted ?? [];
    let tokensUsed = userInput?.tokensUsed ?? [];
    let taskInput: unknown = task.prepare(ctx);

    if (isSend) {
      const target = decision.target;
      const d = target.descriptor;
      // P6 — assemble (projections only; S# keys)
      const caps = capsFor(d.kind, env);
      const built = task.buildPrompt(taskInput, sources.map((s) => ({ key: s.key, projection: s.record.projection })));
      let system = built.system;
      const output: ProviderRequest["output"] =
        task.output.kind === "json" ? { kind: "json", schemaName: task.output.schemaName, jsonSchema: task.output.jsonSchema } : { kind: "text" };
      if (output.kind === "json" && !caps.nativeJsonSchema) system += promptJsonInstruction(output.jsonSchema);
      const providerRequest: ProviderRequest = { system, messages: built.messages, maxTokens: task.maxTokens, output };
      if (caps.supportsEffort) providerRequest.effort = task.effort;
      if (d.kind === "ollama" && Math.ceil(canonicalJson(providerRequest).length / 4) + task.maxTokens > caps.maxContextTokens) {
        throw new AIError("invalid_request"); // Ollama token budget (P6)
      }
      // P7 — redact (cloud, GovCloud included: what is sent; local: the storage copy only)
      const redaction = redactRequest(providerRequest, dict, patterns);
      const sentRequest = d.isCloud ? redaction.value : providerRequest;
      // P8 — freeze
      const payloadHash = payloadHashOf(redaction.value);
      const previewToken = previewTokenOf(payloadHash, d.targetClass, d.host, d.model);
      send = {
        target,
        providerRequest,
        sentRequest,
        storedRequest: redaction.value,
        redaction,
        storedForm: d.isCloud ? "as_sent_redacted" : "redacted_for_storage",
        payloadHash,
        previewToken,
      };
      minted = mergeMinted(redaction.minted, minted);
      tokensUsed = sortTokens([...redaction.tokensUsed, ...tokensUsed]);
    } else {
      taskInput = null;
    }

    if (req.previewToken !== undefined && req.previewToken !== (send?.previewToken ?? null)) throw new AIError("preview_stale");

    const target = decision.target;
    const maxClassification = maxClass(classification.floor, ...sentRecords.map((s) => s.classification));
    const publicDecision: PublicDecision = {
      kind: decision.kind,
      mode: effective.mode,
      target: target ? publicTarget(target.descriptor) : null,
      floor: classification.floor,
      maxClassification: isSend ? maxClassification : null,
      sentCount: sentRecords.length,
      withheldCount: decision.withheld.length,
      canSendAnyway: decision.kind === "held" ? decision.canSendAnyway : false,
      canExcludeControlled: decision.kind === "blocked" ? decision.canExcludeControlled : false,
      notice: decision.notice,
      noticeText,
    };
    if (decision.kind === "blocked") publicDecision.reason = decision.reason;
    if (decision.kind === "held") {
      publicDecision.reason = decision.reason;
      publicDecision.holdTriggers = decision.triggers;
    }
    const sourceChips: SourceChip[] = [
      ...sources.map((s) => ({ key: s.key, ref: s.ref, title: s.record.title, classification: s.record.classification, sent: true, fingerprint: s.fingerprint })),
      ...decision.withheld.map((w) => ({
        key: null,
        ref: w.ref,
        title: loaded.get(refKey(w.ref))?.title ?? refKey(w.ref),
        classification: w.classification,
        sent: false,
        reason: w.reason,
      })),
    ];

    return {
      requestId,
      req,
      task,
      taskInput,
      effective,
      policy,
      dict,
      epoch,
      classification,
      decision,
      budget,
      loaded,
      sources,
      userText,
      userInput,
      send,
      minted,
      tokensUsed,
      publicDecision,
      sourceChips,
      badgeText: target ? badgeTextFor(target.descriptor) : "No provider",
    };
  }

  function tokenLegend(p: Prepared): TokenLegendEntry[] {
    const map = p.send?.redaction.tokens ?? p.userInput?.tokens;
    if (!map) return [];
    const role = p.req.actor.role;
    return [...map.values()]
      .sort((a, b) => (a.token < b.token ? -1 : a.token > b.token ? 1 : 0))
      .map((e) => {
        const kind = parseToken(e.token)!.kind;
        const visible = kind === "AMOUNT" ? canSee(role, "prices") : kind === "CONTACT" || kind === "EMAIL" || kind === "PHONE" ? canSee(role, "contacts") : true;
        return visible ? { token: e.token, kind, display: e.surface } : { token: e.token, kind, display: null, hiddenLabel: hiddenLabel(role) };
      });
  }

  async function preview(req: AIRequest): Promise<AIPreview> {
    const p = await prepare(req, deps.newRequestId());
    return {
      requestId: p.requestId,
      decision: p.publicDecision,
      sources: p.sourceChips,
      request: p.send ? p.send.sentRequest : null,
      payloadHash: p.send?.payloadHash ?? null,
      previewToken: p.send?.previewToken ?? null,
      storedForm: p.send?.storedForm ?? null,
      tokenLegend: tokenLegend(p),
      // The payload's own suspects when something would be sent (the user's text is inside it); else the input's.
      suspects: p.send ? p.send.redaction.suspects : (p.userInput?.suspects ?? []),
    };
  }

  // -------------------------------------------------------------------------------------------------------------
  // R1–R6
  // -------------------------------------------------------------------------------------------------------------
  function baseAudit(p: Prepared) {
    const withheld: AuditWithheld[] = p.decision.withheld.map((w) => ({ ref: refKey(w.ref), classification: w.classification, reason: w.reason }));
    return {
      createdAt: deps.now().toISOString(),
      requestId: p.requestId,
      actor: { personaId: p.req.actor.personaId, personId: p.req.actor.personId, role: p.req.actor.role },
      feature: p.req.feature,
      task: p.req.task,
      mode: p.effective.mode,
      recordsWithheld: withheld,
      notice: p.decision.notice,
      userInputRedacted: p.userInput?.value ?? null,
      promptVersion: p.task.promptVersion,
      policyVersion: POLICY_VERSION,
      appVersion: APP_VERSION,
      demoEpoch: p.epoch,
    };
  }

  function transportContext(p: Prepared, d: ProviderDescriptor): TransportContext {
    return {
      policy: p.policy,
      live: liveCapable(d, env, (k) => health.get(k)) ? deps.providers(d) : null,
      fallback: () => p.task.offlineFallback(p.taskInput),
      detokenize: (t) => detokenizeEntities(t, p.dict),
      sleep: deps.sleep,
    };
  }

  function resolveTransport(p: Prepared, request: ProviderRequest, payloadHash: string): ResolvedTransport {
    const d = p.send!.target.descriptor;
    const hint = p.req.scenarioHint ?? (p.task.scenarioReplay ? p.task.defaultScenario : undefined);
    return deps.transports.resolve(
      {
        task: p.req.task,
        targetClass: d.targetClass,
        promptVersion: p.task.promptVersion,
        payloadHash,
        descriptor: d,
        scenario: p.task.scenarioReplay && hint ? { hint, ...(p.userInput ? { question: p.userInput.value } : {}) } : null,
        sentFingerprints: p.sources.map((s) => s.fingerprint),
        structured: p.task.output.kind === "json",
      },
      transportContext(p, d),
    );
  }

  function badgeFor(p: Prepared, t: ResolvedTransport | null): RoutedBadge {
    const replay: RoutedBadge["replay"] = !t || t.transport === "live" ? "none" : t.transport === "demo_fallback" ? "fallback" : t.provenance === "hand_authored" ? "scripted" : "replay";
    const local = p.send?.target.descriptor.kind === "ollama" && replay !== "none" ? " (not contacted: replay)" : "";
    return { text: `${p.badgeText}${local}`, replay, recordedOnModel: t?.recordedOnModel ?? null };
  }

  async function* run(p: Prepared, signal: AbortSignal): AsyncGenerator<AIStreamEvent> {
    const base = baseAudit(p);

    // R1 — blocked / held: one complete row, nothing sent, no transport call.
    if (p.decision.kind === "blocked" || p.decision.kind === "held") {
      const auditId = db.$client.transaction(() => {
        persistPatternTokens(db, p.minted, base.createdAt);
        return writeComplete(db, {
          ...base,
          decision: p.decision.kind as "blocked" | "held",
          target: auditTarget(p.decision.target?.descriptor),
          maxClassification: p.classification.floor,
          classificationsIncluded: [p.classification.floor],
          tokensUsed: p.tokensUsed,
        });
      })();
      yield { t: "meta", requestId: p.requestId, decision: p.publicDecision, sources: p.sourceChips, badge: badgeFor(p, null) };
      yield { t: "done", auditId, outcome: p.decision.kind, transport: "none", provenance: null, latencyMs: 0, citationsValid: 0, citationsStripped: 0 };
      return;
    }

    const send = p.send!;
    const d = send.target.descriptor;
    const sentClasses = p.sources.map((s) => s.record.classification);
    const resolved = resolveTransport(p, send.sentRequest, send.payloadHash);
    const writeAheadFor = (r: ResolvedTransport, stored: ProviderRequest, hash: string, extra: { parentId?: number; attempt?: number }) =>
      writeAhead(db, {
        ...base,
        createdAt: deps.now().toISOString(),
        decision: p.decision.kind as "allow" | "withheld_partial" | "user_excluded_controlled",
        target: auditTarget(d)!,
        transport: r.transport,
        cassetteProvenance: r.provenance,
        maxClassification: maxClass(p.classification.floor, ...sentClasses),
        classificationsIncluded: rankOrdered([p.classification.floor, ...sentClasses]),
        recordsSent: p.sources.map((s) => refKey(s.ref)),
        tokensUsed: p.tokensUsed,
        requestPayloadRedacted: canonicalJson(stored),
        payloadHash: hash,
        payloadStoredForm: send.storedForm,
        ...extra,
      });

    const auditId = db.$client.transaction(() => {
      persistPatternTokens(db, p.minted, base.createdAt);
      const id = writeAheadFor(resolved, send.storedRequest, send.payloadHash, {});
      if (p.decision.kind !== "blocked" && p.decision.kind !== "held" && p.decision.heldOverride) {
        writeEvent(
          db,
          {
            kind: "possible_controlled_content_sent",
            actor: base.actor,
            subjectKind: "ai_audit_log",
            subjectId: String(id),
            classification: p.classification.floor,
            details: { auditId: id, triggers: (p.decision.notice?.params.triggers as string | undefined) ?? "" },
          },
          base.createdAt,
        );
      }
      return id;
    })();

    yield { t: "meta", requestId: p.requestId, decision: p.publicDecision, sources: p.sourceChips, badge: badgeFor(p, resolved) };

    const tokens: TokenMap = d.isCloud ? send.redaction.tokens : new Map();
    const sentKeys = new Set(p.sources.map((s) => s.key));
    const json = p.task.output.kind === "json";
    let finalized = false;
    let rowId = auditId;
    const rowTokens = p.tokensUsed;
    let stats = { citationsValid: 0, citationsStripped: 0 };
    const started = performance.now();

    const responseForStorage = (raw: string, r: ResolvedTransport): { text: string; tokens: string[] } => {
      if (d.isCloud && r.transport !== "demo_fallback") return { text: raw, tokens: rowTokens };
      const red = redactText(raw, p.dict, createPatternTokenResolver(db), { field: "response" });
      persistPatternTokens(db, red.minted, deps.now().toISOString());
      return { text: red.value, tokens: sortTokens([...rowTokens, ...red.tokensUsed]) };
    };

    const fin = (id: number, outcome: Exclude<AuditOutcome, "pending" | "blocked" | "held">, r: ResolvedTransport, extra: {
      response?: ProviderResponse | null;
      raw?: string | null;
      errorCode?: AIErrorCode | null;
    }) => {
      if (readDemoEpoch(db) !== p.epoch) return false;
      const stored = extra.raw ? responseForStorage(extra.raw, r) : { text: null, tokens: rowTokens };
      const resp = extra.response ?? null;
      return finalizeAudit(db, id, {
        completedAt: deps.now().toISOString(),
        outcome,
        servedModel: r.transport === "live" ? (resp?.servedModel ?? null) : r.provenance === "recorded" ? (resp?.servedModel ?? null) : null,
        responseRedacted: stored.text,
        tokensUsed: stored.tokens,
        inputTokens: resp?.usage.inputTokens ?? null,
        outputTokens: resp?.usage.outputTokens ?? null,
        latencyMs: performance.now() - started,
        ttftMs: resp?.timings.ttftMs ?? null,
        stopReason: resp?.rawStopReason ?? null,
        errorCode: extra.errorCode ?? null,
        citationsValid: stats.citationsValid,
        citationsStripped: stats.citationsStripped,
      });
    };

    let current = resolved;
    try {
      // R2 — transport · R3 — restore
      const callOpts = { signal, timeoutMs: env.AI_TIMEOUT_MS, requestId: p.requestId };
      const restorer = new StreamRestorer({ tokens, sentSourceKeys: sentKeys });
      let response: ProviderResponse | null = null;
      for await (const ev of current.stream(send.sentRequest, callOpts)) {
        if (ev.type === "text") {
          if (!json) {
            const out = restorer.push(ev.text);
            if (out) yield { t: "text", d: out };
          }
        } else response = ev.response;
      }
      if (!response) throw new AIError("provider_error");
      if (!json) {
        const tail = restorer.flush();
        if (tail) yield { t: "text", d: tail };
        stats = restorer.stats();
      }

      // R4 — post-process
      if (response.stopReason === "refusal") {
        finalized = fin(rowId, "refusal", current, { response, raw: response.text || null, errorCode: "refusal" });
        throw new AIError("refusal");
      }
      if (json && p.task.output.kind === "json") {
        const parse = p.task.output.parse;
        const tryParse = (raw: string): { ok: true; value: unknown } | { ok: false } => {
          try {
            return { ok: true, value: parse(JSON.parse(raw)) };
          } catch {
            return { ok: false }; // the error message is discarded: it can echo model output
          }
        };
        let parsed = tryParse(response.text);
        if (!parsed.ok) {
          // One repair retry: a child row (attempt 2) with the model's own output and a repair instruction.
          finalized = fin(rowId, "invalid_output", current, { response, raw: response.text, errorCode: "invalid_output" });
          const repairSent: ProviderRequest = {
            ...send.sentRequest,
            messages: [...send.sentRequest.messages, { role: "assistant", content: response.text }, { role: "user", content: REPAIR_INSTRUCTION }],
          };
          const repairStored = d.isCloud ? repairSent : redactRequest(repairSent, p.dict, createPatternTokenResolver(db)).value;
          const repairHash = payloadHashOf(repairStored);
          current = resolveTransport(p, repairSent, repairHash);
          const parentId = rowId;
          rowId = writeAheadFor(current, repairStored, repairHash, { parentId, attempt: 2 });
          finalized = false;
          response = null;
          for await (const ev of current.stream(repairSent, callOpts)) if (ev.type === "done") response = ev.response;
          if (!response) throw new AIError("provider_error");
          parsed = tryParse(response.text);
          if (!parsed.ok) {
            finalized = fin(rowId, "invalid_output", current, { response, raw: response.text, errorCode: "invalid_output" });
            throw new AIError("invalid_output");
          }
        }
        const data = restoreJsonStrings((parsed as { value: unknown }).value, { tokens, sentSourceKeys: sentKeys });
        yield { t: "result", data };
      }

      // R5 — finalize
      finalized = fin(rowId, "ok", current, { response, raw: response.text });
      if (!finalized) throw new AIError("demo_epoch_changed");
      yield {
        t: "done",
        auditId: rowId,
        outcome: "ok",
        transport: current.transport,
        provenance: current.provenance,
        latencyMs: Math.round(performance.now() - started),
        citationsValid: stats.citationsValid,
        citationsStripped: stats.citationsStripped,
      };
    } catch (err) {
      const e = toAIError(err);
      const code: AIErrorCode = signal.aborted && e.code !== "provider_timeout" ? "aborted" : e.code;
      if (!finalized && code !== "demo_epoch_changed") finalized = fin(rowId, outcomeFor(code), current, { errorCode: code });
      const reportCode: AIErrorCode = !finalized && readDemoEpoch(db) !== p.epoch ? "demo_epoch_changed" : code;
      yield { t: "error", code: reportCode, message: new AIError(reportCode).safeMessage };
      yield {
        t: "done",
        auditId: finalized ? rowId : null,
        outcome: reportCode === "demo_epoch_changed" ? "aborted" : outcomeFor(code),
        transport: current.transport,
        provenance: current.provenance,
        latencyMs: Math.round(performance.now() - started),
        citationsValid: stats.citationsValid,
        citationsStripped: stats.citationsStripped,
      };
    } finally {
      // The consumer stopped reading (client disconnect): abort the provider call and close the row as aborted.
      if (!finalized) fin(rowId, "aborted", current, { errorCode: "aborted" });
    }
  }

  function realRun(req: AIRequest, opts: RunOptions = {}): AIRun {
    const requestId = deps.newRequestId();
    const controller = new AbortController();
    const onAbort = () => controller.abort(opts.signal?.reason);
    async function* events(): AsyncGenerator<AIStreamEvent> {
      if (opts.signal?.aborted) controller.abort(opts.signal.reason);
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        let p: Prepared;
        try {
          p = await prepare(req, requestId);
        } catch (err) {
          const e = toAIError(err);
          yield { t: "error", code: e.code, message: e.safeMessage };
          return;
        }
        yield* run(p, controller.signal);
      } finally {
        opts.signal?.removeEventListener("abort", onAbort);
        controller.abort();
      }
    }
    const iterable = { [Symbol.asyncIterator]: () => events() };
    return {
      requestId,
      events: iterable,
      async collect(): Promise<AIRunResult> {
        const out: AIRunResult = { requestId, events: [], meta: null, text: "", data: undefined, done: null, error: null };
        for await (const ev of iterable) {
          out.events.push(ev);
          if (ev.t === "meta") out.meta = ev;
          else if (ev.t === "text") out.text += ev.d;
          else if (ev.t === "result") out.data = ev.data;
          else if (ev.t === "done") out.done = ev;
          else out.error = ev;
        }
        return out;
      },
    };
  }

  function runAI(req: AIRequest, opts: { dryRun: true }): Promise<AIPreview>;
  function runAI(req: AIRequest, opts?: RunOptions): AIRun;
  function runAI(req: AIRequest, opts?: RunOptions | { dryRun: true }): Promise<AIPreview> | AIRun {
    if (opts && "dryRun" in opts && opts.dryRun) return preview(req);
    return realRun(req, opts as RunOptions | undefined);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Health, warm-up, routing
  // -------------------------------------------------------------------------------------------------------------
  function routing() {
    const effective = effectiveRouting();
    const statuses: Partial<Record<ProviderKind, ProviderHealth["status"]>> = {};
    for (const kind of ["anthropic", "bedrock", "ollama"] as const) {
      const h = health.get(kind);
      if (h && usesLiveProbe(kind, policyNow())) statuses[kind] = h.status;
    }
    return { effective, summary: getRoutingSummary(env, { routing: effective, health: statuses }) };
  }

  async function healthReport(deep: boolean): Promise<HealthReport> {
    const { effective, summary } = routing();
    const policy = policyNow();
    const { descriptors } = resolveTargets(env, effective, policy, (k) => health.get(k));
    const providers: ProviderHealth[] = [];
    for (const kind of kindsForMode(env, effective)) {
      const d = descriptors[kind];
      if (!d) continue;
      const live = !policy.demoMode || usesLiveProbe(kind, policy);
      if (!live) {
        providers.push({
          kind,
          targetClass: d.targetClass,
          host: d.host,
          model: d.model,
          status: "replay",
          verified: "config-only-demo",
          checkedAt: null,
          deep,
          problems: [],
        });
        continue;
      }
      if (deep) {
        const h = kind === "ollama" ? await health.refresh(kind, true) : await deps.providers(d).health(true);
        providers.push(h);
      } else {
        providers.push(
          health.get(kind) ?? {
            kind,
            targetClass: d.targetClass,
            host: d.host,
            model: d.model,
            status: "not_checked",
            verified: d.verified,
            checkedAt: null,
            deep: false,
            problems: [],
          },
        );
      }
    }
    const bad = new Set(["unreachable", "misconfigured", "model_missing", "model_not_allowed"]);
    return {
      ok: summary.configProblems.length === 0 && providers.every((h) => !bad.has(h.status)),
      checkedAt: deps.now().toISOString(),
      deep,
      demoMode: policy.demoMode,
      demoLiveLocal: policy.demoLiveLocal,
      mode: effective.mode,
      cloudProvider: effective.cloudProvider,
      routingSource: effective.source,
      providers,
      configProblems: summary.configProblems,
      sdkEnvOverrides: sdkEnvOverridesPresent(),
    };
  }

  async function warm(): Promise<ProviderHealth | null> {
    const effective = effectiveRouting();
    const policy = policyNow();
    if (!kindsForMode(env, effective).includes("ollama") || !usesLiveProbe("ollama", policy)) return null;
    const d = resolveTargets(env, effective, policy, (k) => health.get(k)).descriptors.ollama;
    if (!d) return null;
    const p = deps.providers(d);
    if (!p.warm) return null;
    const h = await p.warm({ timeoutMs: env.AI_TIMEOUT_MS, requestId: deps.newRequestId() });
    healthStore.set("ollama", { health: h, at: deps.now().getTime() });
    return h;
  }

  return { runAI, healthReport, warm, routing };
}
