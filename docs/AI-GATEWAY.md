# AI gateway contract (Phase 3, as built)

The build contract for Phase 3 ("Provider abstraction, classification, routing policy, audit log", PLAN.md §13).
It was written as a contract for parallel builders; Phase 3 is now built and this document describes the code as it
stands. Where the build changed the draft, the text below was updated and the reason is recorded in §17 (items 10+).
PLAN.md stays the source of truth: §3.2, §4, §5.2, §7.7, §9, §11.1, §11.4, §12. If this document and PLAN.md disagree,
fix one of them in the same change (don't pick one silently).

Contents: [0 Shared files](#0-shared-files-already-written) · [1 Ownership](#1-module-map-and-ownership) ·
[2 Data flow](#2-data-flow-and-the-pipeline) · [3 Cross-builder API](#3-cross-builder-api-the-names-you-may-rely-on) ·
[4 Capabilities](#4-capabilities-and-task-gating) · [5 Policy](#5-policy-builder-policy) ·
[6 Redaction](#6-redaction-builder-redaction) · [7 Audit](#7-audit-builders-audit-and-auditseed) ·
[8 Providers](#8-providers-builder-providers) · [9 Errors](#9-errors) · [10 Gateway](#10-gateway-builder-gateway) ·
[11 Replay](#11-replay-builder-replay) · [12 Seeded history](#12-seeded-audit-history-builder-auditseed) ·
[13 Lint](#13-lint-and-architecture-rules-builder-lint) · [14 Wire formats](#14-wire-formats) ·
[15 Tests](#15-tests-plan-12-phase-3--files) · [16 Rules for every builder](#16-rules-for-every-builder) ·
[17 Decisions recorded](#17-decisions-recorded-here)

---

## 0. Shared files (already written)

| File | What it holds | Owner afterwards |
|---|---|---|
| `src/lib/ai/types.ts` | ProviderKind/TargetClass/AIMode re-exports, `ProviderDescriptor`, `LLMProvider`, `ProviderRequest`, `ProviderResponse`, `ProviderStreamEvent`, `CallOptions`, `ProviderHealth`, `HealthReport`, `TASK_NAMES`, `FEATURES`, `RecordRef` + `refKey()`, `AIActor`, `AIRequest`, `AIRequestBody`, `AIPreview`, `AIRun`, `AIRunResult`, `AIStreamEvent`, `PublicDecision`, `PublicTarget`, `SourceChip`, `RoutedBadge`, `TokenLegendEntry`, transport/replay types (`TransportLookup`, `TransportContext`, `ResolvedTransport`, `TransportResolver`), cassette types, `GatewayDeps`, `HealthSource` | gateway |
| `src/lib/ai/errors.ts` | `AIError`, `AI_ERROR_CODES`, `SAFE_MESSAGES`, `AI_ERROR_STATUS`, `toAIError()`, `aiErrorFromStatus()` | gateway |
| `src/lib/policy/types.ts` | `AiRoutingSetting`, `EffectiveRouting`, `RoutingSource`, `ClassifyRequestInput`, `RequestClassification`, `BudgetedRecord`, `WithheldRecord`, `PolicyTarget(s)`, `DecideInput`, `Decision` (+ Send/Blocked/Held), `BLOCK_REASONS`, `HoldTrigger`, `NOTICE_KEYS`, `Notice`, `RenderedNotice` | policy |
| `src/lib/redaction/types.ts` | token kinds, `RedactionDictionaryInput`, `ContactInput`, `RedactionDictionary`, `EntityTokenInfo`, `TokenMap`, `PatternTokenResolver`, `RedactionResult`, `Suspect`, `StreamRestorerOptions`, `RestoreStats` | redaction |
| `src/lib/redaction/patterns.ts` | **the token grammar**, fully implemented: `TOKEN_PATTERN_SOURCE`, `tokenRegex()`, `parseToken()`, `formatToken()`, `tokensIn()`, `escapeLiteralTokens()`, citation grammar, `tokenKey(seed)`, `hmacCode()`, `assignEntityCodes()`, `ambiguityEntityId()`, `patternTokenFor()` | redaction (add, never change outputs) |
| `src/lib/audit/types.ts` | `AuditRow/Insert`, `EventRow/Insert`, `APP_VERSION`, `isSeededRequestId()`, `AuditActor`, `AuditTargetFields`, `AuditWriteAheadInput`, `AuditFinalizeInput`, `AuditCompleteInput`, `EventInput`, `AuditViewer`, `AuditFilters`, `RevealResult`, `AUDIT_EXPORT_FORMATS` | audit |
| `src/db/schema/enums.ts` | + `AUDIT_TRANSPORTS` value `seeded`, + `EVENT_KINDS` value `audit_reveal`, type aliases (`AuditTransport`, `AuditOutcome`, `EventKind`, `TokenKind`, `TargetClass`, …). Text enums have no DB CHECK, so no migration was needed | — |
| `src/db/schema/assets.ts` + `drizzle/0003_customers_near_miss_ignore.sql` | `customers.near_miss_ignore` (json, default `[]`) so the runtime dictionary matches seed time. Migration is one `ALTER TABLE customers ADD …`; touches no `*_fts` table. **auditSeed populates it** in `build.ts` | — |
| `src/lib/auth/roles.ts` + `tests/roles.test.ts` | capabilities `useAi`, `testAiConnection`, `viewAudit`, `revealAudit`, `exportAudit` (§4) | — |
| `src/lib/env.ts` | + `sdkEnvOverridesPresent()`: names (never values) of SDK env vars that are set | — |
| `src/server/safe.ts` | `withSafeErrors()` now rethrows `AIError` unchanged (like `SafeError`) | — |
| `src/lib/policy/summary.ts` | `RoutingTarget.baseUrl` (the exact base URL) + exported `routingTargetFor(kind, env)` / `BuiltTarget` | policy |
| `package.json` | scripts `demo:record`, `demo:verify` | — |

---

## 1. Module map and ownership

Each builder writes ONLY the files listed for its key (plus new files inside its directories). Need a change in
someone else's file? Put it under "Requests for other builders" in your final message; don't edit it.

| Key | Owns (create / edit) |
|---|---|
| **redaction** | `src/lib/redaction/**` — `dictionary.ts`, `redact.ts`, `restore.ts`, `pattern-regex.ts` (EMAIL/PHONE/AMOUNT/PN regexes), `memory-resolver.ts`, `index.ts` (re-exports); keeps `patterns.ts`, `types.ts`. Tests `tests/redaction-*.test.ts` |
| **policy** | `src/lib/policy/{types.ts, decide.ts, notices.ts, covered-models.ts, classify-request.ts, summary.ts}` (keep every existing `matrix.ts` export working; `isCoveredModel` moves to `covered-models.ts` and is re-exported from `matrix.ts`), `src/lib/data/dictionary.ts`. Tests `tests/policy-*.test.ts`, `tests/classify-request.test.ts` (existing `policy-matrix`/`policy-summary` tests must keep passing) |
| **providers** | `src/lib/ai/providers/**` — `anthropic.ts`, `bedrock.ts`, `ollama.ts`, `factory.ts` (`descriptorFor`, `createProvider`, default `ProviderFactory`), `sdk-logger.ts`, `errors.ts` (SDK error → `AIError` mapping). Tests `tests/providers-*.test.ts`, `tests/secret-hygiene.test.ts` |
| **audit** | `src/lib/audit/**` — `ai-audit.ts` (writeAhead / finalize / writeComplete), `events.ts`, `token-store.ts`, `reveal.ts`, `export.ts`, `labels.ts`; `src/lib/data/audit.ts`, `src/server/queries/audit.ts`, `src/app/api/audit/export/route.ts`, `src/app/actions/audit.ts` (`revealAuditRow`). Tests `tests/audit-*.test.ts` except `audit-history` |
| **auditSeed** | `seed-data/audit/history.yaml`, `seed-data/README.md` (audit section), `src/lib/seed/{schemas.ts, parse.ts, build.ts, bundle.ts}`, `src/db/reset.ts`, `seed-data/seed.lock.json` (via `npm run seed:lock`). The only builder allowed to run `npm run seed:lock` and `npm run seed`. Test `tests/audit-history.test.ts` |
| **replay** | `src/lib/ai/replay/**` — `key.ts`, `cassette.ts` (zod + YAML read/write), `store.ts` (fs store, static path), `manifest.ts`, `lookup.ts` (`createTransportResolver`), `transport.ts` (ReplayTransport streaming), `similarity.ts`; `scripts/demo-record.mts`, `scripts/demo-verify.mts`; `seed-data/demo-cache/**` (`smoke.cloud.yaml`, `smoke.local.yaml`, `manifest.yaml`, `README.md`). Tests `tests/replay-*.test.ts`, `tests/cassettes.test.ts` |
| **gateway** | `src/lib/ai/gateway.ts`, `src/lib/ai/deps.ts` (`defaultGatewayDeps`; the ONLY file in `src/lib/ai` that may call `new Date()` / `randomUUID()`), `src/lib/ai/pipeline/**`, `src/lib/ai/projection.ts`, `src/lib/ai/tasks/**`, `src/lib/ai/routing.ts`, `src/lib/ai/health.ts`, `src/lib/ai/request-schema.ts`, `src/lib/ai/ndjson.ts`, `src/lib/boot.ts`, `src/instrumentation.ts`, `src/server/ai.ts`, `src/app/api/ai/[task]/route.ts`, `src/app/api/ai/preview/route.ts`, `src/app/api/health/route.ts`, `src/app/api/health/warm/route.ts`, `src/app/actions/ai-routing.ts`; owns `src/lib/ai/types.ts` + `errors.ts` afterwards. Tests `tests/gateway-*.test.ts`, `tests/ai-projection.test.ts` |
| **lint** | `eslint.config.mjs`, `tests/architecture.test.ts` |

Out of scope for Phase 3a (Phase 3b builds them on top of this contract): the `/settings` and `/audit` pages, the
header badge wiring to the effective routing, the e2e specs and the `e2e/no-egress.cjs` preload.

---

## 2. Data flow and the pipeline

```
 Client ── POST /api/ai/[task] {feature, input, pinned, …} ──► route.ts: withSafeErrors → requireActor → assertCan(useAi)
                                                                 │  zod AIRequestBodySchema; actor from the cookie
                                                                 ▼
 src/server/ai.ts (server-only) ──► gateway.runAI(req, {signal})   [src/lib/ai/gateway.ts, deps injected]
   P0 context ......... task registry (unknown → task_unknown), can(role, task.capability) (→ forbidden), input limits,
                        consent stub (task.consent === "required" needs consentId; none in Phase 3), effective routing
                        (routing.ts: AI_SETTINGS_LOCKED → env; app_settings[ai_routing]; env), targets + availability
                        (routing.ts + health.ts + providers/factory.descriptorFor), demo.epoch, redaction dictionary (cached)
   P1 projection ...... pinned refs → role-visible records via src/lib/data (invisible ones dropped silently) →
                        projectForRole(entity, role, "llm") → LlmProjection<T> (no pricing, no contacts, departure hidden)
   P2 retrieval ....... task.budget(...) → BudgetedRecord[] in rank order, chosen ignoring classification (Phase 3: [])
   P3 classify ........ classifyRequest({text: user text only, taskFloor, session, pinned}, entityDict) → floor, mentions, signals
   P4 decide .......... decide({mode, request, budget, targets, excludeAboveClearance, confirmNotControlled}) → Decision
   P5 notice .......... Decision.notice (key + params); rendered for the viewer by renderNotice() for meta / preview
   P6 assemble ........ sent records get S1…Sn (rank order) + fingerprints; task.buildPrompt(projections) → {system, messages};
                        ProviderRequest {system, messages, maxTokens, output, effort (only if caps.supportsEffort)};
                        JSON output on a non-native provider (Bedrock): prompt-JSON instruction appended to system
   P7 redact .......... cloud target (GovCloud too): redactRequest(req) (escape literals, then every string incl.
                        output.jsonSchema). Local target: request sent unredacted; storage copy = redactRequest(req)
   P8 freeze .......... payloadHash = sha256(canonicalJson(cloud ? redacted : storage copy));
                        previewToken = sha256(`${payloadHash}|${targetClass}|${host}|${model}`)
                        ── dryRun returns AIPreview here ──
                        real call with a previewToken that differs → AIError preview_stale (409), nothing written
   R1 audit ........... blocked / held: writeComplete() (transport none, nothing sent) → emit meta + done → stop.
                        else: transports.resolve(lookup, ctx) (sync, egress-free) → writeAhead() + persist minted pattern
                        tokens (one transaction); heldOverride → event possible_controlled_content_sent
   R2 transport ....... resolved.stream(sentRequest, {signal, timeoutMs, requestId})  (live adapter OR ReplayTransport
                        OR offline fallback — the only step that differs between live and demo)
   R3 restore ......... StreamRestorer(tokens: cloud ? this request's map : empty, sentSourceKeys) per text delta
   R4 post-process .... citation stats; JSON tasks: parse tokenized JSON → zod → one repair retry (child row, attempt 2)
                        → restore strings; refusal → outcome refusal; outputs inherit max(sent, floor)
   R5 finalize ........ epoch unchanged? finalize(id, {...}) : skip (+ error demo_epoch_changed)
   R6 emit ............ meta (first) → text* → result? → done; error event (safe message) before done on failure;
                        client disconnect (request.signal) aborts the provider call; the row finalizes as aborted
```

Ordering guarantees: `meta` is always the first event (emitted right after R1, so it carries the transport/replay
badge); `done` is always the last event of a run that reached R1; every run that reached R1 has exactly one audit row
(plus a child row per repair retry). Errors before R1 (P0–P8) produce NO audit row and NO event; the route returns
them with `AI_ERROR_STATUS[code]` (§14).

---

## 3. Cross-builder API (the names you may rely on)

Builders implement exactly these exported names/signatures (more exports are fine). `Db` = `import type { Db } from "@/db/client"`.

| Export | File (owner) | Signature |
|---|---|---|
| `buildRedactionDictionary` | `src/lib/redaction/dictionary.ts` (redaction) | `(input: RedactionDictionaryInput) => CompiledRedactionDictionary` (extends `RedactionDictionary`) |
| `redactText` | `src/lib/redaction/redact.ts` | `(text: string, dict: RedactionDictionary, patterns: PatternTokenResolver, opts?: { field?: string }) => RedactionResult<string>` |
| `redactRequest` | same | `(req: ProviderRequest, dict, patterns) => RedactionResult<ProviderRequest>` |
| `StreamRestorer` | `src/lib/redaction/restore.ts` | `new StreamRestorer(opts: StreamRestorerOptions)`; `.push(chunk: string): string`; `.flush(): string`; `.stats(): RestoreStats` |
| `restoreText` | same | `(text: string, opts: StreamRestorerOptions) => { text: string; stats: RestoreStats }` |
| `restoreJsonStrings` | same | `<T>(value: T, opts: StreamRestorerOptions) => T` (restores every string leaf) |
| `detokenizeEntities` | same | `(text: string, dict: RedactionDictionary) => string` (entity tokens → `display`; others → `[unknown]`) |
| `dictionaryHits` | `src/lib/redaction/dictionary.ts` | `(text: string, dict: RedactionDictionary) => { kind: TokenKind; start: number; end: number }[]` — positions only, so "no names" checks never print a name |
| `createMemoryPatternResolver` / `NO_PATTERN_TOKENS` | `src/lib/redaction/memory-resolver.ts` | in-memory `PatternTokenResolver` (tests, seed time, previews) |
| `dictionaryInputFromTables` | `src/lib/data/dictionary.ts` (policy) | `(t: DictionarySourceTables) => RedactionDictionaryInput` — pure; seed bundle tables and DB rows both satisfy `DictionarySourceTables` |
| `loadDictionaryInput` | same | `(db: Db) => RedactionDictionaryInput` |
| `classifyRequest` | `src/lib/policy/classify-request.ts` | `(input: ClassifyRequestInput, dict: EntityDictionary) => RequestClassification` |
| `retrievalSignal` | same | `(budget: readonly BudgetedRecord[], isCleared: (c: Classification) => boolean) => boolean` |
| `decide` | `src/lib/policy/decide.ts` | `(input: DecideInput) => Decision` (pure) |
| `renderNotice` | `src/lib/policy/notices.ts` | `(notice: Notice, ctx: { recordLabel(id: string): string \| null; role: Role }) => RenderedNotice` |
| `resolveEffectiveRouting` | `src/lib/policy/summary.ts` | `(env: Env, setting: AiRoutingSetting \| null) => EffectiveRouting` |
| `parseAiRoutingSetting` | same | `(value: unknown) => AiRoutingSetting \| null` (invalid → null, ignored) |
| `routingOptionAvailability` | same | `(env: Env) => { locked: boolean; modes: Record<AIMode, Option>; cloudProviders: Record<CloudProviderKind, Option> }`, `Option = { enabled: boolean; reason?: string }` |
| `getRoutingSummary` | same | `(env: RoutingEnv, opts?: { routing?: EffectiveRouting; health?: Partial<Record<ProviderKind, ProviderHealthStatus>> }) => RoutingSummary` (old one-arg call keeps working; `source: RoutingSource`) |
| `routingTargetFor` | same (exists) | `(kind: ProviderKind, env: RoutingEnv) => BuiltTarget` |
| `isCoveredModel` | `src/lib/policy/covered-models.ts` (re-exported by `matrix.ts`) | `(modelId: string \| undefined) => boolean` |
| `descriptorFor` | `src/lib/ai/providers/factory.ts` (providers) | `(target: RoutingTarget, a: { available: boolean; verified: ProviderVerification; unavailableReason?: string }) => ProviderDescriptor` |
| `createProvider` | same | `(d: ProviderDescriptor, env: Env, deps?: ProviderDeps) => LLMProvider`; `ProviderDeps = { fetch?: typeof fetch; now?: () => Date; bedrockAuth?: BedrockAuthOverride }` |
| `defaultProviderFactory` | same | `ProviderFactory` (lazy clients cached on `globalThis`, keyed by kind\|baseUrl\|model) |
| `writeAhead` / `finalize` / `writeComplete` | `src/lib/audit/ai-audit.ts` (audit) | `(db: Db, input: AuditWriteAheadInput) => number`; `(db, id: number, input: AuditFinalizeInput) => boolean` (false if the row is gone or already complete); `(db, input: AuditCompleteInput) => number` — synchronous |
| `writeEvent` | `src/lib/audit/events.ts` | `(db: Db, input: EventInput, nowIso: string) => number` |
| `createPatternTokenResolver` / `persistPatternTokens` | `src/lib/audit/token-store.ts` | `(db: Db) => PatternTokenResolver`; `(db, minted: PatternTokenRecord[], nowIso: string) => void` (insert-or-ignore) |
| `revealRow` / `canRevealRow` | `src/lib/audit/reveal.ts` | `(row: Pick<AuditRow, "id" \| "tokensUsed" \| "actorPersonaId" \| "actorPersonId">, viewer: AuditViewer, lookup: (token: string) => { kind: TokenKind; value: string } \| null) => RevealResult`; `(row, viewer) => boolean` |
| `createTransportResolver` | `src/lib/ai/replay/lookup.ts` (replay) | `(store: CassetteStore) => TransportResolver` |
| `replayKey` | `src/lib/ai/replay/key.ts` | `(k: ReplayKeyInput) => string` = `${task}\|${targetClass}\|${promptVersion}\|${payloadHash}` |
| `fsCassetteStore` | `src/lib/ai/replay/store.ts` | `() => CassetteStore` (reads `path.join(process.cwd(), "seed-data", "demo-cache")`, a static literal) |
| `memoryCassetteStore` | same | `(files: CassetteFile[]) => CassetteStore` |
| `createGateway` | `src/lib/ai/gateway.ts` (gateway) | `(deps: GatewayDeps) => Gateway` (§10.1) |
| `defaultGatewayDeps` | `src/lib/ai/deps.ts` | `(overrides?: Partial<GatewayDeps>) => GatewayDeps` |
| `sourceFingerprint` | `src/lib/ai/pipeline/assemble.ts` | `(ref: RecordRef, projection: unknown) => string` = `${refKey(ref)}@${sha256Hex(canonicalJson(projection)).slice(0, 16)}` |

`canonicalJson` / `sha256Hex` come from `src/lib/seed/source.ts` (pure; reuse, don't copy).

---

## 4. Capabilities and task gating

Added to `src/lib/auth/roles.ts` (tests updated):

| Capability | owner | quoter | machinist | trainee | Opened by DEMO_OPEN_CONTROLS | Used by |
|---|---|---|---|---|---|---|
| `useAi` | ✓ | ✓ | ✓ | ✓ | — | `POST /api/ai/[task]`, `/api/ai/preview` (then the task's own capability) |
| `testAiConnection` | ✓ | – | – | – | **yes** | task `smoke` ("Send test prompt"), `GET /api/health?deep=1`, `POST /api/health/warm` |
| `viewAudit` | ✓ | ✓ | ✓ | ✓ | — | `/audit` queries (scope: owner all rows via `viewAll`; others own rows) |
| `revealAudit` | ✓ | ✓ | ✓ | ✓ | — | `revealAuditRow` (owner any row; others own rows) |
| `exportAudit` | ✓ | ✓ | ✓ | ✓ | — | `POST /api/audit/export` (rows the viewer can see) |
| `changeAiRouting` (exists) | ✓ | – | – | – | yes | `setAiRouting` |
| `viewAll` (exists) | ✓ | – | – | – | **never** | audit scope = every row |

Each task in the registry names `capability` (smoke: `testAiConnection`; later tasks mostly `useAi`). P0 checks
`can(actor.role, task.capability, { demoOpenControls })` and throws `AIError("forbidden")`.

Reveal per token kind (PLAN.md §4.8): CUSTOMER, PERSON, PART, JOB, QUOTE, PN → every role; AMOUNT → only
`canSee(role, "prices")`; CONTACT, EMAIL, PHONE → only `canSee(role, "contacts")`. Hidden entries come back as
`{ token, value: null, hiddenLabel: hiddenLabel(role) }`. Only tokens in the row's own `tokens_used` are ever resolved
(a typed literal `[[CONTACT_…]]` was escaped before redaction, so it is never in `tokens_used`).

---

## 5. Policy (builder: policy)

### 5.1 `src/lib/data/dictionary.ts`
`DictionarySourceTables` = the subset of rows needed: `shopProfile[0].{seed, certifications}`, `customers.{id, name,
redactionAliases, classification, partClassificationFloor, nearMissIgnore}`, `customerAccounts.{customerId,
contactName, contactEmail}`, `people.{id, fullName, redactionAliases}`, `personas.{id, label, role, personId,
redactionAliases}`, `parts.{id, partNumber, classification}`, `jobs.{id, jobNumber, classification}`,
`quotes.{id, quoteNumber, classification}`, `materials.{name, shortName, aliases}`, `machines.{model, name}`.
It must reproduce exactly what `src/lib/seed/build.ts` passes to `buildDictionary` today: people + the owner persona
(`id` = persona id `P-OWNER`, `fullName` = `redactionAliases[0] ?? labelNamePart(label)`, aliases = its
`redactionAliases`), the stoplist (material name/short name/aliases, machine model/name, shop certifications,
`"AS9102"`), `nearMissIgnore` = all customers' `nearMissIgnore`. `tokenSeed` = `shop_profile.seed`. A test asserts the
DB-built `EntityDictionary` and the seed-built one produce identical `analyzeText` output on a fixed corpus.

### 5.2 `classify-request.ts`
`classifyRequest`: `floor = maxClass(text floor (analyzeText over input.text + user turns), session ?? general,
max(pinned), taskFloor)`; `signals = analyzeText(...).signals`; `detectorHit = signals.length > 0`. The text is ONLY
user-supplied text; task templates and record bodies never enter it. `retrievalSignal(budget, isCleared)` = budget
non-empty AND (rank-1 not cleared OR `2 × notCleared ≥ budget.length`).

### 5.3 `decide.ts` (pure; fails closed)
`ok(t, c) = t !== null && t.descriptor.available && allowed(c, t.descriptor.targetClass, t.opts)`.

- **local**: `t = targets.local`; not available → `blocked("local_unavailable")`, notice `blocked_local_unavailable {host, model}`. Else send everything (`allow`).
- **cloud**: `t = targets.cloud`; null/unavailable → `blocked("provider_unavailable")`, notice `blocked_provider_unavailable {providerKind}`. `!allowed(floor)` → `blocked("request_not_cleared")`, notice `blocked_request_controlled {recordIds, classification: floor, providerKind, model}` (recordIds = mentions + pinned whose class isn't cleared). Triggers = signal kinds (`numeric_core`, `near_miss_customer`, deduped, that order) + `retrieval` if `retrievalSignal(budget, c => ok(t, c))`. Triggers non-empty: detector hit → `held` (`canSendAnyway: false`); else not confirmed → `held` (`canSendAnyway: true`); else continue with `heldOverride: true`. Partition budget: cleared → `sent`, rest → `withheld` (`not_cleared_for_target`, no backfill). Kind = `withheld_partial` if any withheld, else `allow`. Notice: heldOverride → `sent_after_hold {withheldCount, triggers}`; else withheld → `withheld_records {count, recordKinds, classification (highest withheld), mode, providerKind, model}`; else null.
- **hybrid**: `need = max(floor, detectorHit ? max(signal classes) : general, every budget class)` (a suspected-EC request is routed like EC: fail closed). `hybridRoute(need, {cloud, ecTarget, local})` from `matrix.ts`: cloud / ec_target / local → `allow` on that target with the whole budget. Blocked → if `excludeAboveClearance` AND cloud available AND `allowed(floor, cloud)` AND `!detectorHit` → `user_excluded_controlled` on the cloud with records not cleared withheld (`user_excluded`), notice `user_excluded_controlled {count}`; else `blocked("local_unavailable_controlled")` with `canExcludeControlled` = (cloud available AND `allowed(floor, cloud)` AND `!detectorHit` AND at least one budget record not cleared for the cloud), notice `blocked_hybrid_local_down {host, count, canExclude: 0|1}`. **Never** a cloud fallback for anything not cleared.
- `excludeAboveClearance` is ignored outside Hybrid (it can only narrow). `confirmNotControlled` is ignored when there is a detector hit. Both come from the POST body and are recomputed server-side every time.
- `redact = target.descriptor.isCloud` (GovCloud included). Blocked/held: every budget record is in `withheld`.

### 5.4 `notices.ts`
Copy from PLAN.md §4.4 with the params above. Params hold IDs, enums, counts and hosts only (never names or
part/job/quote numbers); `recordLabel(id)` resolves "job RJ-26-0310" at view time for the viewer (null → "a record").
Actions: withheld → `switch_local`; blocked_request_controlled → `switch_local`, `show_matching_records`; held →
`switch_local` (+ `send_anyway` when `canSendAnyway`); blocked_hybrid_local_down → `exclude_controlled` when
`canExclude`; blocked_local_unavailable / blocked_provider_unavailable → `open_settings`. Hybrid-local-down copy is
exact: "…Floorwise never sends controlled data to the cloud as a fallback."

### 5.5 `summary.ts`
Add `resolveEffectiveRouting` (precedence: `AI_SETTINGS_LOCKED=true` → env only, source `locked_env`; else a valid
setting → `setting`; else env `LLM_PROVIDER` + `AI_MODE` → `env`), `parseAiRoutingSetting`, `routingOptionAvailability`
(locked → everything disabled, reason "Settings are locked (AI_SETTINGS_LOCKED=true)"; anthropic enabled when
DEMO_MODE or key; bedrock when AWS_REGION valid + BEDROCK_MODEL_ID + base URL ok; local when Ollama is local-qualified;
hybrid when the chosen cloud side and the EC target qualify), and the `opts` argument of `getRoutingSummary` (mode
and cloud provider from `opts.routing`; `RoutingTarget.health` from `opts.health`; unreachable/model_not_allowed Ollama
→ `configured` stays, clearance becomes none for that target). Never put values in `configProblems`.

---

## 6. Redaction (builder: redaction)

- **Dictionary** (`buildRedactionDictionary`): entity surfaces exactly like `entity-detect.ts` (one alternation,
  longest first, Unicode boundaries, NFC, `X-Ray`/`Gamma Ray` compounds consumed, person full/first/last forms with the
  same case rules, part numbers with optional separators + trailing revision, job and quote numbers) **plus contacts**
  (name with a trailing `(…)` removed; full/first/last forms like people; kind CONTACT, entity ID = customer ID). You may
  reuse `buildDictionary` by passing contacts as extra people with an internal ID prefix. Token per surface: customer →
  `CUSTOMER`; person form full/first/last → `PERSON` / `_F` / `_L`; part/job/quote → `PART`/`JOB`/`QUOTE`; contact →
  `CONTACT` (+ `_F`/`_L`). Codes come from `assignEntityCodes(tokenKey(tokenSeed), every entity incl. ambiguity IDs)`.
  A first name shared by two people (or two contacts) → ambiguity token `formatToken(kind, code(ambiguityEntityId(name)), "F")`
  restoring to the first name only. `entityTokens` maps every token (all variants) to `EntityTokenInfo`.
- **Patterns** (never inside a produced token), in this order: EMAIL (`local@domain.tld`) and PN (strings matching any
  customer's `part_number_pattern` shape or the shop's `RJ-yy-nnnn` / `RQ-yy-nnnn` shapes, unanchored; spec numbers
  AS/AMS/MIL/ASTM/SAE… never) run BEFORE the dictionary, so an address or part number that contains a customer name
  or alias becomes one token (a PN that is exactly a known part / job / quote number gets that record's dictionary
  token instead); then the dictionary; then PHONE (`(+1 )?(\(ddd\)|ddd)[ .-]ddd[ .-]dddd`) and AMOUNT (`$1,800`,
  `$1800.50`, `$2.5k`, `$165/hr`, `$165 per hour`, `165 an hour`, `165 dollars`, `USD 1,800`; bare numbers, hours,
  tolerances, percentages and spec numbers never match) on the text between hits. See §17 item 10.
  Token = `patternTokenFor(key, kind, value, resolver.isTaken)` unless `resolver.tokenFor(kind, value)` exists; new ones
  are returned in `minted` (the gateway persists them at R1 only — previews never persist).
- **redactText / redactRequest**: NFC, `escapeLiteralTokens`, then EMAIL → PN → dictionary → PHONE → AMOUNT. `redactRequest` walks
  EVERY string: `system`, each `messages[i].content`, and every string key and value inside `output.jsonSchema` and
  `output.schemaName`. `tokensUsed` = distinct tokens in the result, code-point sorted. `TokenMapEntry.surface` = first
  replaced text for that token in this request. Suspects: lowercase first names of people/contacts (`ask ray`) with
  `field` = `"system"`, `"messages[1].content"`, … Never redact: materials, machine makes/models, process terms,
  tolerances, hours, spec numbers, the shop's own name.
- **redactAroundTokens** (response storage, §17 item 16): a cloud response keeps the tokens this request sent and
  everything between them is redacted like user input; a token the request didn't send is escaped.
- **StreamRestorer**: holds back a trailing partial `[` / `[[…` / `[S…` (≤ `TOKEN_MAX_LENGTH`), restores tokens in
  `opts.tokens` to their `surface`, unknown tokens → `[unknown]`, keeps `[S#]` in `sentSourceKeys`, strips others
  (counted). Unit-tested by splitting every token and citation at every offset (and a fuzz over random chunkings).
- No logging anywhere in this module. `real_value`s never leave the token map / store.

---

## 7. Audit (builders: audit and auditSeed)

### 7.1 `ai_audit_log` columns per decision (EVERY column)

| Column | allow / withheld_partial / user_excluded_controlled | blocked | held | seeded rows |
|---|---|---|---|---|
| id | autoincrement | ← | ← | explicit 1…N (seed) |
| created_at | `deps.now()` ISO at R1 | ← | ← | yaml, before DEMO_TODAY |
| completed_at | at finalize (null while pending) | = created_at | = created_at | yaml |
| request_id | `req_<uuid>` (child rows reuse it) | ← | ← | `SEED-0001`… |
| parent_id / attempt | null / 1 (repair child: parent id / 2) | null / 1 | null / 1 | yaml `parent` → id / 2 |
| actor_person_id, actor_persona_id, actor_role | actor | ← | ← | from `actor_persona` |
| feature, task | request / registry | ← | ← | yaml |
| mode | effective mode | ← | ← | yaml |
| decision | decision kind | blocked | held | yaml |
| provider_kind, target_class, model, endpoint_host, region, cross_region, is_cloud | target descriptor | refused/unavailable target (null if none) | target | yaml (validated) |
| served_model | live `response.model`; recorded replay: recorded-on model; hand-authored/fallback: null | null | null | null |
| transport | `live` / `demo_replay_exact` / `demo_replay_scenario` / `demo_fallback` (selected before R1) | `none` | `none` | `seeded` (or `none` for blocked/held) |
| cassette_provenance | replay: file provenance; else null | null | null | `hand_authored` when a response exists |
| max_classification | max(floor, sent classes) | floor | floor | yaml (validated) |
| classifications_included | distinct (floor + sent), rank order | [floor] | [floor] | yaml |
| records_sent | refKeys in S# order | [] | [] | yaml |
| records_withheld | `{ref, classification, reason}` | every budget record | every budget record | yaml |
| notice_key, notice_params | `Decision.notice` (null for plain allow) | notice | notice | yaml |
| redaction_token_count, tokens_used | `tokensUsed.length`, `tokensUsed` (finalize may extend for local) | from the redacted user input | ← | computed |
| user_input_redacted | redacted user text (cloud: as sent; local: storage redaction) | redacted user text | ← | yaml (tokenized) |
| request_payload_redacted | canonicalJson(redacted / storage request) | null | null | canonicalJson(yaml `request`) |
| payload_hash | P8 hash | null | null | sha256 of the above |
| payload_stored_form | cloud `as_sent_redacted`; local `redacted_for_storage` | null | null | per target |
| response_redacted | cloud: tokenized text as received; local and fallback: storage-redacted text; JSON tasks: the raw (tokenized) JSON text | null | null | yaml (tokenized) |
| prompt_version | task.promptVersion | ← | ← | yaml |
| input_tokens, output_tokens | usage (replay: cassette usage) | null | null | yaml |
| latency_ms, ttft_ms | measured (`performance.now()` deltas) | 0 / null | 0 / null | yaml |
| stop_reason | provider raw stop reason | null | null | yaml |
| outcome | pending → ok / refusal / invalid_output / provider_error / timeout / aborted | blocked | held | yaml |
| error_code | `AIErrorCode` or null | null | null | yaml |
| citations_valid, citations_stripped | restorer stats | 0 | 0 | yaml |
| policy_version | `POLICY_VERSION` | ← | ← | `matrix-v1` |
| app_version | `APP_VERSION` | ← | ← | ← |
| demo_epoch | `app_settings["demo.epoch"]` at R1 | ← | ← | 0 |
| tenant_id | default | ← | ← | default |

Seeded rows are recognized by `isSeededRequestId(request_id)` (prefix `SEED-`) AND transport `seeded`/`none`. The UI
labels them "Seeded example (fictional)" and their responses "scripted (not model output)". Reset never archives
them (they aren't `transport='live'`; `reset.ts` also excludes `SEED-` explicitly).

### 7.2 Writer, events, token store (audit)
- `writeAhead` inserts with `outcome: "pending"`, `completedAt: null`; `finalize` is one `UPDATE … WHERE id = ? AND
  completed_at IS NULL` (returns false when 0 rows: reset happened); `writeComplete` inserts a finished row.
- `writeEvent`: details are IDs/enums/counts/booleans only (validate: strings ≤ 64 chars matching `^[A-Za-z0-9_.:,|-]*$`).
  Event kinds used in Phase 3: `settings_change` (subjectKind `app_setting`, subjectId `ai_routing`, details `{mode,
  cloudProvider, previousMode, previousCloudProvider}`), `possible_controlled_content_sent` (`{auditId, triggers}`),
  `audit_export` (`{format, rowCount, maxClassification, includeEvents}`), `audit_reveal` (`{auditId, tokenCount,
  revealedCount}`), `health_check` (`{providerKind, deep, warm, status}`), `demo_reset` (exists).
- `token-store.ts`: `redaction_tokens` rows `{token, kind, realValue, scope: "global", createdAt}`; `entity_id` null
  for pattern tokens. `real_value` is never logged, never returned except through Reveal.

### 7.3 Reveal, export, data layer (audit)
- `revealRow` (pure): only tokens in `row.tokensUsed`; scope: owner (viewAll) any row, others only rows where
  `actor_person_id = viewer.personId` (or, with no personId, `actor_persona_id = viewer.personaId`); per-kind role
  filter (§4). Lookup = dictionary `entityTokens` (display) + `redaction_tokens`. `revealAuditRow(id)` Server Action:
  `withSafeErrors`, `requireActor`, `assertCan("revealAudit")`, scope check (else `SafeError("forbidden")`), event
  `audit_reveal`, returns `RevealResult`.
- `src/lib/data/audit.ts`: `listAuditRows(db, viewer, filters, dict) → AuditListVM` (newest first, limit 200,
  `{ rows: AuditRowVM[], events?: EventRowVM[], truncated: boolean }`), `auditRowDetail(db, viewer, id) → AuditDetailVM
  | null`. VMs: names resolved at view time (actor label), `providerLabel`, `replayLabel` (`REPLAY` · `REPLAY · scripted
  (not model output)` · `Offline fallback · scripted (not model output)` · `Seeded example (fictional)` · null),
  `storedFormLabel` ("sent: redacted · stored: as sent" / "sent: unredacted (local) · stored: redacted"), records with
  role-visible labels, rendered notice, retry chain ids, `canReveal`. Free text `q` (≤ 200 chars): `redactText(q, dict,
  read-only resolver)` → LIKE (escaped) on `user_input_redacted`, `request_payload_redacted`, `response_redacted`, plus
  every token of the redacted q against `tokens_used`. Never log `q`.
- `export.ts`: `toCsv(rows)` (every column except tenant_id; cells starting with `= + - @ \t \r` get a leading `'`),
  `toJson(rows)`; `exportFileName(maxClassification | "empty", nowIso, format)` =
  `floorwise-audit-<classification>-<YYYYMMDD>.<csv|json>` (UTC date from the injected clock).
- `POST /api/audit/export` body `{ format: "csv" | "json", filters: AuditFilters }`: `withSafeErrors` → `requireActor`
  → `assertCan("exportAudit")` → rows the viewer can see → event `audit_export` → `Content-Disposition: attachment;
  filename=…`, `Cache-Control: private, no-store`. Seam: DEMO_PIN for non-loopback clients (Phase 8).
- `src/server/queries/audit.ts`: `getAuditPage(filters)`, `getAuditDetail(id)` — `connection()` → `requireActor()` →
  `assertCan("viewAudit")` → pure function (docs/DATA-LAYER.md pattern).

---

## 8. Providers (builder: providers)

- `descriptorFor(target, a)` copies `targetClass`, `providerKind→kind`, `isCloud`, `model`, `baseUrl`, `host`,
  `region`, `endpointMode`, `fips`, `crossRegion`, `coveredModel`, `isLoopback`, `locality`, `govCloud` from the
  `RoutingTarget` and availability from `a`. Adapters use `descriptor.baseUrl` and nothing else for the endpoint, and
  refuse (`provider_unavailable`) when `baseUrl` is empty or `hostOf(baseUrl) !== host`.
- **Anthropic** (`new Anthropic({...})` built lazily, never at import): `apiKey: env.ANTHROPIC_API_KEY` (explicit
  string — no client is built without one), `authToken: null`, `webhookKey: null`, `baseURL: descriptor.baseUrl`,
  `maxRetries: 2`, `timeout: env.AI_TIMEOUT_MS`, `logLevel: "warn"`, `logger: sdkLogger("anthropic")` (each method logs
  `log.warn("provider_sdk_log", { provider, level })` and DISCARDS every argument), `fetch: deps.fetch` when injected.
  Params: `{ model, max_tokens, system, messages, output_config: { effort?, format? } }` — format =
  `jsonSchemaOutputFormat(output.jsonSchema, { transform: false })` for JSON output; never `temperature`, `top_p`,
  `top_k`, `thinking`, `tool_choice`, `tools`, `fallbacks`, betas, or a trailing assistant message. Stream with
  `client.messages.stream(params, { signal, timeout })`; text deltas → `{type:"text"}`; final message →
  `{type:"done", response}` (`servedModel = message.model`, `usage`, `rawStopReason = stop_reason`, refusal →
  `stopReason: "refusal"` + `refusalCategory = stop_details?.category ?? null`; the explanation is dropped). Health deep
  = `client.models.retrieve(model)`. **No server-side refusal fallbacks and no client fallback middleware** (§17).
- **Bedrock**: `new AnthropicBedrock({ awsRegion: descriptor.region, baseURL: descriptor.baseUrl, maxRetries: 2,
  timeout, logLevel: "warn", logger, fetch? })` (runtime) or `new AnthropicBedrockMantle({...})` (mantle). Require
  region + model (else `provider_unavailable`; never construct a client that would default to us-east-1). Production:
  standard AWS credential chain (no explicit credentials). Tests: `deps.bedrockAuth` = explicit fake bearer `apiKey`, or
  fake static keys, or a stub `providerChainResolver` — the container's real AWS chain must never be consulted.
  `caps.nativeJsonSchema = false` (prompt-JSON; the gateway puts the schema instruction in `system`), never send
  `output_config.format`; `supportsEffort = true`. Same forbidden parameters as Anthropic.
- **Ollama** (`fetch` only, `redirect: "error"`, `AbortSignal.any([o.signal, AbortSignal.timeout(o.timeoutMs)])`):
  `POST {baseUrl}/api/chat` NDJSON with `{ model, messages: [{role:"system"}, …], stream: true, think: false,
  keep_alive: "60m", options: OLLAMA_OPTIONS, format? }` where `OLLAMA_OPTIONS = { num_ctx: env.OLLAMA_NUM_CTX,
  temperature: 0, num_predict: OLLAMA_NUM_PREDICT_CAP (1536) }` is built once and identical on EVERY call (chat, warm);
  `format = output.jsonSchema` for JSON output. Health: `/api/version` (≥ 0.34.4), deep `/api/show` (model present,
  `remote_host` empty — non-empty → status `model_not_allowed` and every call refuses with `model_not_allowed`),
  `/api/ps` (warm, GPU share). `warm()` = `/api/chat` with `messages: []` and the identical options. Record
  `load_duration`/`eval_count` into `timings`. Refuse descriptors whose `locality === "not_local"`. `caps =
  { nativeJsonSchema: true, supportsEffort: false, maxContextTokens: env.OLLAMA_NUM_CTX }`.
- **Errors** (`providers/errors.ts`): `APIUserAbortError`/`AbortError` → `aborted`; `APIConnectionTimeoutError` /
  timeout signal → `provider_timeout`; `APIConnectionError` / fetch `TypeError` → `provider_connection`; `APIError` with
  status → `aiErrorFromStatus(status)`; malformed JSON / anything else → `provider_error`. Never read `err.message`,
  `err.error`, response bodies or headers into logs, AIErrors or the audit.
- **Availability** (computed in `routing.ts`, gateway): DEMO_MODE and not (Ollama AND DEMO_LIVE_LOCAL) →
  `available = target.configured`, `verified: "config-only-demo"`. Live: Anthropic/Bedrock → `available =
  target.configured`, `"config-only"`; Ollama → `target.configured && health.status === "ready"`, `"live-probe"`
  (health cache TTL: ready 15 s, otherwise 5 s; a stale entry is refreshed before P4 with a 2 s probe timeout).

---

## 9. Errors

`AIError(code)` only; message is always `SAFE_MESSAGES[code]`. Where each code arises:

| Code | Raised by | Before R1? | Audit outcome |
|---|---|---|---|
| invalid_request | route body validation, P0 input limits, unknown session/thread id | yes | — |
| task_unknown | P0 (task not implemented) | yes | — |
| forbidden | P0 capability check | yes | — |
| consent_required / consent_target_changed | P0 consent stub | yes | — |
| preview_stale | P8 token mismatch | yes | — |
| demo_epoch_changed | R5 (reset during the stream) | no | row gone; none |
| provider_* / model_not_allowed | adapters (R2) | no | provider_error (timeout → `timeout`) + error_code |
| refusal | R4 (`stopReason === "refusal"`) | no | refusal |
| invalid_output | R4 after the repair retry | no | invalid_output |
| aborted | client disconnect / signal | no | aborted |
| internal | anything else (`toAIError`) | either | provider_error + `internal` |

Blocked and held are **decisions, not errors**: HTTP 200, `meta` + `done`, a complete audit row.

---

## 10. Gateway (builder: gateway)

### 10.1 Gateway object
```ts
export interface Gateway {
  runAI(req: AIRequest, opts: { dryRun: true }): Promise<AIPreview>;
  runAI(req: AIRequest, opts?: RunOptions): AIRun;
  healthReport(deep: boolean): Promise<HealthReport>;
  warm(): Promise<ProviderHealth | null>;   // null when the effective mode doesn't use a live Ollama
  routing(): { effective: EffectiveRouting; summary: RoutingSummary };
}
export function createGateway(deps: GatewayDeps): Gateway;
```
`src/server/ai.ts` (`import "server-only"`): a `globalThis` singleton `createGateway(defaultGatewayDeps())` and thin
exports `runAI`, `getHealthReport`, `warmLocalModel`, `getAiRouting`. Scripts and tests call `createGateway` directly.
`GatewayDeps` also has `tasks?` (register test tasks, e.g. a JSON task for the repair retry), `healthStore?` (the
health TTL cache, injectable), `retrieve?` (the Phase 4 retrieval seam: records found for the question, budgeted like
pinned ones), `routingOverride?` and `transportPolicyOverride?` (tests and scripts only).

### 10.2 Tasks (`src/lib/ai/tasks/**`, projections only; never import `@/db` or `@/lib/data`)
```ts
interface TaskDefinition<P> {
  name: TaskName; features: FeatureName[]; promptVersion: string; capability: Capability;
  classificationFloor: Classification; consent: "none" | "required";
  output: { kind: "text" } | { kind: "json"; schemaName: string; jsonSchema: JsonObject; parse(v: unknown): unknown /* zod */ };
  effort: Effort; maxTokens: number; scenarioReplay: boolean; defaultScenario?: string; maxPinned: number;
  prepare(ctx: { actorName; input; pinned }): P;     // P1: the task input from the request (no DB access)
  buildPrompt(input: P, sources: { key: string; projection: unknown }[]): { system: string; messages: ProviderMessage[] };
  offlineFallback(input: P): OfflineFallback;     // labelled "scripted (not model output)"
}
```
**`smoke`** (Settings "Send test prompt"): features `["settings_test"]`, `promptVersion "smoke-v1"`, capability
`testAiConnection`, floor `internal`, no consent, text output, effort `low`, `maxTokens 1024` (headroom for adaptive
thinking), `scenarioReplay: true`, `defaultScenario: "smoke"`, no records, budget `[]`. Input projection
`{ actorName }` = `labelNamePart(persona.label)` loaded in P0 from the DB. System: "You are a connectivity check for a
demo application. Reply with one short sentence. Do not repeat names or identifiers from the message." User: "This is a
connectivity check from {actorName} on the Settings page. Reply with one short sentence confirming you received it."
(The persona name is what makes `[[PERSON_…]]` visible in the audit.) No runtime timestamps in any prompt.
Fallback text: "Offline fallback (scripted, not model output): no recorded reply matched this test prompt, so nothing
was sent to a model."

### 10.3 Other gateway modules
- `projection.ts`: `type LlmProjection<T> = T & { readonly __llm: true }`; `projectForRole(entity, role, "llm")` for
  card / job / quote / part / customer view rows: drop pricing fields, contacts and commercial terms always; win/loss
  only for roles that can see it; departure never. `tests/ai-projection.test.ts` asserts no pricing/contact keys for
  every role.
- `routing.ts`: `readAiRoutingSetting(db)`, `resolveTargets(env, effective, health) → { targets: PolicyTargets;
  descriptors: Partial<Record<ProviderKind, ProviderDescriptor>> }` (Cloud: cloud only; Local: local only; Hybrid:
  cloud + local + ecTarget = local, or Bedrock GovCloud when `HYBRID_EC_TARGET=govcloud`), `liveCapable(kind)` (for
  `TransportContext.live`: Anthropic with a key; Bedrock configured; Ollama probed ready).
- `health.ts`: `createHealthSource(factory, descriptorsFn, now)` — TTL cache on `globalThis`.
- `request-schema.ts`: zod `AIRequestBodySchema` (feature ∈ FEATURES; text ≤ 4000 chars; ≤ 40 turns of ≤ 4000;
  ≤ 10 pinned refs; ids `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$`; previewToken `^[0-9a-f]{64}$`; scenarioHint
  `^[a-z0-9_.-]{1,64}$`), `PreviewBodySchema = { task } & body`. Unknown keys are rejected. Bodies over 64 KB →
  `invalid_request`.
- `ndjson.ts`: `ndjsonResponse(events: AsyncIterable<AIStreamEvent>, signal)` → `Response` (§14); an iterator throw
  becomes one `{t:"error", code:"internal"}` line.
- `src/app/actions/ai-routing.ts` `setAiRouting(input: AiRoutingSetting): Promise<{ ok: true; routing: EffectiveRouting }
  | { ok: false; reason: string }>`: `withSafeErrors` → `requireActor` → `assertCan("changeAiRouting")` → zod →
  `routingOptionAvailability(env)` (locked or disabled option → `{ ok: false, reason }`) → upsert
  `app_settings[ai_routing]` (`updatedByPersonaId`, real time) + event `settings_change` → `revalidatePath("/", "layout")`.
- `src/instrumentation.ts` `register()`: `await import("@/lib/boot")` → `logBoot()`: `log.info("boot", {...})` with
  the NAMES of set variables (`envSummary()` booleans), `log.warn("sdk_env_overrides_present", { names })` from
  `sdkEnvOverridesPresent()`; an invalid env logs `env_invalid` (field names only). No exporters, no `onRequestError`.
- `src/lib/ai/deps.ts` `defaultGatewayDeps()`: `getDb()`, `getEnv()`, `now: () => new Date()`, `newRequestId: () =>
  "req_" + randomUUID()`, `defaultProviderFactory`, `createHealthSource(...)`, `createTransportResolver(fsCassetteStore())`,
  `sleep` via `setTimeout` honouring the signal.
- Dictionary cache: keyed by `shop_profile.seed_bundle_hash | demo.epoch`; holds `{ entityDict, redactionDict }`.

### 10.4 Routes
- `POST /api/ai/[task]` (`export const POST = withSafeErrors(async (request, ctx: RouteContext<"/api/ai/[task]">) =>
  …)`): `requireActor` → `assertCan("useAi")` → `task ∈ TASK_NAMES` → body → `runAI({...body, task, actor}, { signal:
  request.signal })`. Await the FIRST event before building the Response: an `error` first event → status
  `AI_ERROR_STATUS[code]` with that single line; otherwise 200 and stream the rest.
- `POST /api/ai/preview`: same checks, `PreviewBodySchema`, `runAI(..., { dryRun: true })` → JSON `AIPreview`;
  AIError → JSON `{ error: { code, message } }` with its status. `Cache-Control: private, no-store`.
- `GET /api/health`: `withSafeErrors`; basic report without an actor (config + cached health, never a network call,
  never a value); `?deep=1` → `requireActor` + `assertCan("testAiConnection")` → probes (in DEMO_MODE without live
  local: no network, status `replay`) + event `health_check`.
- `POST /api/health/warm`: `requireActor` + `assertCan("testAiConnection")` → `gateway.warm()` → `{ ok, health }`;
  no-op (`health: null`) unless the effective mode uses Ollama live (live mode, or DEMO_LIVE_LOCAL=true).

### 10.5 Settings precedence and DEMO_MODE
Precedence: `AI_SETTINGS_LOCKED=true` → env only; else `app_settings[ai_routing]` (valid); else env `LLM_PROVIDER` +
`AI_MODE` (whose defaults give cloud/Anthropic). Model IDs change only via env. Reset clears the setting.
DEMO_MODE=true: availability from configuration (`config-only-demo`, no key needed) except Ollama with
DEMO_LIVE_LOCAL=true; R2 asks the replay resolver; a miss → `DEMO_MISS=live` and a live-capable provider → live call
(audited `live`), else the task's offline fallback (`demo_fallback`). DEMO_MODE=false: live adapters only (the
resolver returns the live provider); a target that isn't available is blocked by `decide()`, never substituted.

---

## 11. Replay (builder: replay)

- **Key** `replayKey({task, targetClass, promptVersion, payloadHash})`; host and model are not part of it (a test
  proves the key and the lookup result are unchanged when `OLLAMA_MODEL`, `OLLAMA_BASE_URL`, `ANTHROPIC_MODEL` or
  `BEDROCK_BASE_URL` change).
- **Lookup** (`createTransportResolver(store).resolve(lookup, ctx)`):
  1. `!ctx.policy.demoMode`, or Ollama target with `demoLiveLocal` → live (`ctx.live`; null → a transport whose calls
     throw `provider_unavailable`).
  2. exact: an entry in a file with the same `task`, `targetClass`, `promptVersion` and `payloadHash` → `demo_replay_exact`.
  3. Bedrock target (commercial or GovCloud) with no own entry → the same key under `targetClass: anthropic`, exact
     only, `recordedOnModel` set (badge "recorded on {model}"). Cloud and local entries never stand in for each other.
  4. scenario (only when the task isn't in `SCENARIO_REPLAY_FORBIDDEN` and `lookup.scenario` is set): same task +
     targetClass, `entry.scenario === hint`, `turnIndex` equal when both set, Jaccard ≥ 0.6 on the tokenized
     normalized `question` when the entry has one, and EVERY `entry.sources[].fingerprint ∈ lookup.sentFingerprints`
     → `demo_replay_scenario`. First match in file/entry order.
  5. miss → `ctx.policy.demoMiss === "live" && ctx.live` → live; else `ctx.fallback()` → `demo_fallback` (no provenance).
- **ReplayTransport**: receives the identical `ProviderRequest` + descriptor a live adapter would. Cloud replays stream
  the TOKENIZED text (the gateway's restorer does the work); local replays stream `ctx.detokenize(text)`. Deterministic
  chunks of 12 code points. Speeds: `realistic` (cloud TTFT ≈ 700 ms, then ~25 ms per chunk), `fast` (100 ms / 5 ms),
  `instant` (no sleeps); caps regardless of recorded timings: structured tasks ≤ 2 s total, local answers ≤ 8 s total.
  Uses `ctx.sleep` (abortable). Returns a `ProviderResponse` with the cassette's stop reason/usage, `servedModel` =
  recorded-on model or null.
- **Cassette file** `seed-data/demo-cache/<id>.yaml` (tokenized; no seed name anywhere; snake_case on disk):

```yaml
# Replay cassette for the Settings "Send test prompt" (smoke task) in Cloud mode. TOKENIZED: never write a real name.
# provenance hand_authored = written by hand; the app labels it "REPLAY · scripted (not model output)".
# After a prompt or seed change run: npm run demo:record -- --rekey && npm run demo:verify
format: 1
id: smoke.cloud
task: smoke
target_class: anthropic
prompt_version: smoke-v1
provenance: hand_authored
recorded_on: null                 # recorded: { provider_kind: anthropic, model: claude-sonnet-5-5, date: 2026-10-21 }
entries:
  - id: P-OWNER                   # one entry per switcher persona (the payload names the persona)
    payload_hash: "<64 hex>"      # filled by demo:record --author / --rekey
    scenario: smoke
    turn_index: null
    question: null
    sources: []                   # [{ key: S1, fingerprint: "card:KC-091@0123456789abcdef" }]
    note: Owner persona
    response:
      text: "Received - this short reply confirms the connectivity check came through."
      data: null
      stop_reason: end_turn
      usage: { input_tokens: null, output_tokens: null }
      ttft_ms: 700
      latency_ms: 1200
```
  Phase 3 ships `smoke.cloud` (required) and `smoke.local` (`target_class: ollama_local`), each with entries
  `P-OWNER`, `P-PER-01`, `P-PER-05`, `P-PER-02`, `P-PER-06`; other personas get a scenario replay (`defaultScenario:
  "smoke"`, no sources). Responses never echo a name or token.
- **Manifest** `seed-data/demo-cache/manifest.yaml`: `format: 1`, `requests: ManifestRequest[]` (snake_case on disk),
  e.g. `{ id: smoke.cloud.owner, phase: 3, expect: "smoke.cloud#P-OWNER", persona_id: P-OWNER, mode: cloud,
  cloud_provider: anthropic, task: smoke, feature: settings_test }`. Each phase appends.
- **`npm run demo:record -- --task smoke --target anthropic|ollama [--persona P-OWNER]`**: live through `runAI()` with
  `routingOverride` = the target as the global mode and `transportPolicyOverride { demoMode: false }`; needs
  credentials (else exits 1 with a plain message naming the missing setting); writes/diffs the entry in tokenized form
  (`response_redacted` of the audit row; provenance `recorded`, `recorded_on` filled). `--author`: dry run (P0–P8, no
  transport) for every manifest request of that task/target; writes a skeleton to `data/demo-skeletons/<id>.yaml`
  (gitignored: payload hash, S# → record table, rendered redacted prompt). `--rekey`: for every manifest request, dry
  run, set the expected entry's `payload_hash`, remap `S#` keys by fingerprint ref, and FAIL (exit 1) if a cited source
  is no longer sent. Prints IDs, hashes and statuses only (`scripts/lib/out.ts`).
- **`npm run demo:verify`**: fresh `:memory:` DB (migrate + `resetDatabase` with `readBundle()` or a fresh build),
  `createGateway` with a provider factory that THROWS (no egress possible) and `transportPolicyOverride { demoMode:
  true, demoMiss: "offline", replaySpeed: "instant" }`; each manifest request in its own `routingOverride`; asserts
  `done.transport === "demo_replay_exact"` and the entry equals `expect`; warns (doesn't fail) while hand_authored
  entries remain; exit 1 on any failure.
- **Integration step** (after all builders): `npm run demo:record -- --rekey` fills the real payload hashes (the replay
  builder writes `"0".repeat(64)` placeholders), then `npm run demo:verify` must pass. `tests/cassettes.test.ts` runs
  the same verification in Vitest.

---

## 12. Seeded audit history (builder: auditSeed)

`seed-data/audit/history.yaml`, 21 fictional rows (SEED-0001…0021) dated before DEMO_TODAY, tokenized with literal tokens computed by
`patterns.ts` + the dictionary (only ENTITY tokens: pattern tokens would be unresolvable after a reset). Suggested mix:
6 cloud `allow` Ask rows (several personas), 2 `withheld_partial` (an EC job withheld), 2 `blocked` (an
export-controlled question in Cloud: nothing sent), 1 `held`, 1 `allow` after "send anyway" (`sent_after_hold`),
1 `user_excluded_controlled` (Hybrid, local down), 3 local Ollama rows (`redacted_for_storage`, one answering an EC
question), 1 Bedrock commercial row (`cross_region` from `crossRegionOf(model)`), 1 `settings_test` smoke row,
1 `provider_error`/timeout row, 1 repair chain (parent `invalid_output` + child `ok`).

```yaml
# Fictional example rows for the /audit page. Shown as "Seeded example (fictional)"; responses are "scripted (not model
# output)". Everything is TOKENIZED: write [[CUSTOMER_…]]/[[PERSON_…]]/[[PART_…]] tokens, never a name or number.
# Run npm run seed:check after editing (it rejects names, unknown tokens and inconsistent decisions), then seed:lock.
- id: SEED-0001
  created_at: "2026-09-02T14:05:11Z"
  completed_at: "2026-09-02T14:05:15Z"
  actor_persona: P-PER-05
  feature: ask_shop
  task: ask_shop
  prompt_version: ask-v0
  mode: cloud
  decision: withheld_partial
  provider_kind: anthropic
  target_class: anthropic
  model: claude-sonnet-5-5
  endpoint_host: api.anthropic.com
  region: null
  cross_region: null
  max_classification: customer_confidential
  classifications_included: [internal, customer_confidential]
  records_sent: [card:KC-001, card:KC-002, job:J-A02]
  records_withheld: [{ ref: job:J-A06, classification: export_controlled, reason: not_cleared_for_target }]
  notice: { key: withheld_records, params: { count: 1, recordKinds: job, classification: export_controlled, mode: cloud, providerKind: anthropic, model: claude-sonnet-5-5 } }
  user_input: "How do we quote thin-wall Ti brackets for [[CUSTOMER_36V4]]?"
  request:                       # a ProviderRequest (tokenized); stored as canonical JSON, hashed by the engine
    system: "…"
    messages: [{ role: user, content: "…" }]
    max_tokens: 1500
    output: { kind: text }
    effort: medium
  response: "…[S1]…"
  usage: { input_tokens: 1840, output_tokens: 310 }
  latency_ms: 4200
  ttft_ms: 900
  stop_reason: end_turn
  outcome: ok
  error_code: null
  citations: { valid: 3, stripped: 0 }
  parent: null                   # repair child: the parent's SEED id
```
(The token in the example is illustrative: compute real codes.) Engine work: zod schema in `schemas.ts`, `FILES.auditHistory`
in `parse.ts`, rows in `build.ts` (computed: actor ids/role, transport `seeded` | `none`, `cassette_provenance`
`hand_authored` when a response exists, `payload_hash`, `request_payload_redacted`, `tokens_used`, token count,
`payload_stored_form`, `policy_version`, `app_version`, `demo_epoch 0`, explicit ids 1…N, attempt/parent), `aiAuditLog`
appended LAST to `SEEDED_TABLES` in `bundle.ts`; `reset.ts` archive query also excludes `request_id LIKE 'SEED-%'`.
Also populate `customers.nearMissIgnore` from `near_miss_ignore` in `build.ts`. **seed:check** (with `file:line`):
schema; ids `SEED-0001…` unique and sequential; every `[[…]]` is a grammar token AND an entity token in the
dictionary built by `dictionaryInputFromTables(tables)` → `buildRedactionDictionary`; `dictionaryHits` empty in every
text field (no names, numbers or persona labels); dates; decision ↔ transport/notice/records/outcome consistency
(§7.1); referenced records exist and withheld classifications equal the records'; every sent record `allowed()` for
the target with default options and every withheld one not; `max_classification` ≥ every sent record;
local rows `ollama_local` + `redacted_for_storage` + `127.0.0.1`; notice params use only the keys of §5.3 with
ID/enum/count values; `parent` refers to an earlier row. Then `npm run seed:lock`.

---

## 13. Lint and architecture rules (builder: lint)

ESLint (`eslint.config.mjs`; remember a later block's `no-restricted-imports` REPLACES earlier options for matching
files, so every block repeats the base patterns):
- Provider SDKs (`@anthropic-ai/*`, `@aws-sdk/*`) only in `src/lib/ai/providers/**`; telemetry libraries nowhere.
- Internal AI modules `@/lib/ai/{pipeline,replay,providers,tasks,transport}/**`, `@/lib/ai/gateway`, `@/lib/ai/deps`
  may be imported only from `src/lib/ai/**`, `src/server/ai.ts`, `scripts/**` and `tests/**`. App code calls the
  gateway through `src/server/ai.ts`. (`@/lib/ai/types`, `errors`, `endpoints`, `projection` are public.)
- `src/lib/ai/tasks/**` may not import `@/db*`, `@/lib/data*`, `@/server*`.
- `no-restricted-properties` `process.env` in `src/**` and `scripts/**` except `src/lib/env.ts`,
  `scripts/lib/telemetry-off.mts`, `scripts/lib/child-env.mts` (config files are outside these globs).

`tests/architecture.test.ts` (grep, comments stripped), in addition to the existing rules:
- Ollama API paths (`/api/chat`, `/api/show`, `/api/ps`, `/api/version`, `/api/generate`, `/api/pull`) only in `src/lib/ai/providers/**`.
- No `fallbacks`, `server-side-fallback`, `RefusalFallback` anywhere in `src/` or `scripts/`.
- In `src/lib/ai/providers/**`: no `top_p`, `top_k`, `tool_choice`, `thinking`; `temperature` only in `ollama.ts`
  (where `temperature: 0`, `think: false`, `keep_alive` and `redirect: "error"` must appear); every `new Anthropic(`,
  `new AnthropicBedrock(`, `new AnthropicBedrockMantle(` passes `baseURL`, `logLevel` and `logger`.
- Every `src/app/api/**/route.ts` export (`GET|POST|PUT|PATCH|DELETE`) is `withSafeErrors(` and the file calls
  `requireActor(` — except `src/app/api/health/route.ts` (wrapped, may skip the actor for the basic report).
- `src/lib/{ai,audit,redaction,policy}/**`: no `Math.random(`, `Date.now(`, `new Date()`, `randomUUID(` except
  `src/lib/ai/deps.ts` (providers use `performance.now()` for latency and `deps.now` for timestamps).
- `@/lib/ai/gateway` imported only by `src/server/ai.ts`, `scripts/**`, `tests/**`; `server-only` never under `src/lib`.
- Cassette and seeded-history files contain only grammar tokens (checked in their own tests).

---

## 14. Wire formats

**`POST /api/ai/[task]`** — request `Content-Type: application/json`, body `AIRequestBody` (user text in the body,
never in the URL). Response `200`, `Content-Type: application/x-ndjson; charset=utf-8`, `Cache-Control: no-store`; one
JSON object per line, `\n`-terminated:
```
{"t":"meta","requestId":"req_…","decision":{"kind":"allow","mode":"cloud","target":{…},"floor":"internal",…},"sources":[],"badge":{"text":"Anthropic API · claude-sonnet-5-5","replay":"scripted","recordedOnModel":null}}
{"t":"text","d":"Received - this short reply "}
{"t":"text","d":"confirms the connectivity check came through."}
{"t":"done","auditId":42,"outcome":"ok","transport":"demo_replay_exact","provenance":"hand_authored","latencyMs":1210,"citationsValid":0,"citationsStripped":0}
```
Blocked/held: `meta` (decision + notice) then `done` (`outcome` blocked/held, `transport` none). Failure after meta:
`{"t":"error","code":"provider_timeout","message":"<safe message>"}` then `done`. Pre-stream failure: status
`AI_ERROR_STATUS[code]`, body = one `error` line. `text` is already restored and citation-checked; `result` carries
validated structured data (restored).

**`POST /api/ai/preview`** → `application/json` `AIPreview` (or `{ "error": { code, message } }`), `Cache-Control:
private, no-store`. **`GET /api/health[?deep=1]`** → `HealthReport`. **`POST /api/health/warm`** → `{ ok, health }`.
**`POST /api/audit/export`** → file download (§7.3).

---

## 15. Tests (PLAN.md §12, Phase 3 → files)

| PLAN §12 item | File | Owner |
|---|---|---|
| Policy table: every classification × target incl. unlisted GovCloud host, SDK base-URL env vars set, Ollama `remote_host`, non-loopback plaintext host, covered model, global profile; hybrid EC → local; hybrid local down → blocked, never cloud; escape-hatch button rules (pinned EC + hybrid + Ollama down → no button) | `tests/policy-decide.test.ts` | policy |
| Matrix snapshot shared with the Privacy page | `tests/policy-matrix.test.ts` (exists) | policy |
| Effective routing precedence, option availability, summary with effective routing/health | `tests/policy-routing.test.ts` (+ existing `policy-summary.test.ts`) | policy |
| Notices: every key renders, no names in params | `tests/policy-notices.test.ts` | policy |
| Entity detection & suspicion against the seeded DB: pinned J-A10, typed `RJ-26-0310`, typed `GDS-4410-120` → blocked in Cloud; "the 4410 manifold", "Graymor" → held; "Graymoor" alone → customer_confidential and sent; Maya's question → customer_confidential, not held; T0/R1–R4 no signals; DB dictionary ≡ seed dictionary | `tests/classify-request.test.ts` | policy |
| Redaction round-trip with surface variants; "X-Ray" not a person; ambiguity token; contacts; amounts/rates; whole `ProviderRequest` incl. `jsonSchema` walked; literal escaping | `tests/redaction-request.test.ts`, `tests/redaction-dictionary.test.ts` | redaction |
| Stream restorer fuzzed at every split; unknown → `[unknown]`; citations ⊆ sent | `tests/redaction-stream-restorer.test.ts` | redaction |
| Token grammar/codes deterministic (patterns.ts) | `tests/redaction-patterns.test.ts` | redaction |
| Literal `[[CONTACT_…]]` typed by a trainee reveals nothing; per-kind role filter; own-row scope | `tests/audit-reveal.test.ts` | audit |
| Writer: every decision type writes the right row (§7.1), finalize once, trigger blocks a second update, APP_VERSION = package.json | `tests/audit-writer.test.ts` | audit |
| Data layer role scoping + free-text search via the redactor; export CSV injection guard, filename, event | `tests/audit-data.test.ts`, `tests/audit-export.test.ts` | audit |
| Seeded history: parses, no names, tokens resolvable, decisions consistent, reset skips archiving them | `tests/audit-history.test.ts` | auditSeed |
| Adapters: request shape (no forbidden params, explicit baseURL, effort, format), streaming, refusal, error mapping, Ollama options identical every call, `remote_host` refusal, non-loopback refusal | `tests/providers-anthropic.test.ts`, `tests/providers-bedrock.test.ts`, `tests/providers-ollama.test.ts` | providers |
| Secret hygiene: real Anthropic + Bedrock clients, injected fetch (success, HTTP 500, malformed JSON with a canary), `ANTHROPIC_LOG=debug` set; spy stdout/stderr/console; no canary key/phrase, no dictionary name (owner incl.), no prompt fragment; AIError messages clean | `tests/secret-hygiene.test.ts` | providers |
| Replay key unchanged when `OLLAMA_MODEL`/base URLs change | `tests/replay-lookup.test.ts` ("replay key") | replay |
| Lookup order; scenario refused when a cited fingerprint wasn't sent; card_extract never scenario; cloud/local never substitute; Bedrock uses Anthropic labelled | `tests/replay-lookup.test.ts` | replay |
| Transport: chunking, speeds/caps, cloud tokenized vs local de-tokenized | `tests/replay-lookup.test.ts` ("ReplayTransport") | replay |
| Cassettes: parse, exact-hit via the gateway, no seed names, citations ⊆ sent, manifest consistent | `tests/cassettes.test.ts` | replay |
| Pipeline order; blocked/held never call the transport (resolver spy never invoked); every decision's audit row; preview token rejected after a Local → Cloud switch; escape hatch only narrows and is server-recomputed (forged POST still blocked); held "send anyway" only without a detector hit, audited + event; hybrid local down → blocked, never cloud; abort → aborted row | `tests/gateway-pipeline.test.ts`, `tests/gateway-preview.test.ts`, `tests/gateway-escape-hatch.test.ts` | gateway |
| Parity: stub live transport vs replay → identical decision, payload hash and audit rows except transport/provenance/served_model | `tests/gateway-parity.test.ts` | gateway |
| Full path hygiene: replay, live, failure, blocked and held calls through `runAI` with log spies; `ai_audit_log`/`event_log` contain no dictionary names (a name the model writes in the clear is stored tokenized) | `tests/gateway-hygiene.test.ts` | gateway |
| Role projection for every role (AI projections) | `tests/ai-projection.test.ts` | gateway |
| Architecture rules | `tests/architecture.test.ts` | lint |

Tests are offline and deterministic: inject `fetch`, clocks (`now`), ids (`newRequestId`), `sleep` (instant) and
in-memory cassette stores; use `seededDb()` / `actorFor()` from `tests/helpers/seeded-db.ts`. Tests may set
`process.env` (e.g. `ANTHROPIC_LOG=debug`) and must restore it; they never read the container's AWS or
`ANTHROPIC_BASE_URL` values.

---

## 16. Rules for every builder

- Don't run git, `npm audit fix`, `drizzle-kit push`, or long-running servers you don't stop; never delete `data/*.db`
  while a server runs. Only auditSeed runs `npm run seed:lock` / `npm run seed`.
- No new dependencies (both SDKs are installed). Anything else needs an exact pin and a reason in your report.
- Console only via `src/lib/log.ts` (app) or `scripts/lib/out.ts` (scripts). `process.env` only in `src/lib/env.ts`.
- Never log or store prompts, payloads, responses, transcripts, keys or raw errors; audit tables hold REDACTED text,
  IDs and enums only. Never put a seed name in a cassette, seeded row, test snapshot or log line.
- Real time and random IDs only for audit/event/session timestamps and request IDs, through the injectable
  `now` / `newRequestId`. Everything else deterministic: code-point sorts, no locale formatting without `en-US` + UTC.
- Honest copy (CLAUDE.md rule 10): hand-written cassettes, seeded rows and fallbacks say "scripted (not model output)";
  replays say REPLAY; "nothing leaves this computer" only for a loopback host.
- Never edit PLAN.md or CLAUDE.md: list needed changes under "PLAN changes" in your final message.
- Run `npm run check` before you finish; your tests must pass on their own, and other builders' in-progress files must
  not be "fixed" by you — report the conflict instead.

---

## 17. Decisions recorded here

1. **No refusal fallbacks.** Neither the server-side `fallbacks` parameter / server-side-fallback betas nor the client
   fallback middleware are used: the routing policy and the audit must know exactly which model receives data, and a
   fallback could reach a covered (30-day-retention) model. A refusal ends the call with outcome `refusal`.
2. **Seeded audit rows** use transport `seeded` (new enum value) and request IDs `SEED-NNNN`, so they are never confused
   with live calls or replays and Reset never archives them.
3. **`ProviderVerification` gains `"config-only"`** for live-mode cloud targets that aren't probed per call.
4. **Hybrid treats a detector hit (suspected export-controlled) like export_controlled** when choosing the target, and
   never offers the escape hatch while a detector hit exists (fail closed).
5. **Effective-routing precedence lives in `src/lib/policy/summary.ts`** (routing decisions stay in `src/lib/policy/`,
   CLAUDE.md rule 5); `src/lib/ai/routing.ts` only reads the setting and builds targets.
6. **Pattern tokens are value-keyed HMACs** (stable across requests and resets, persisted in `redaction_tokens` for
   Reveal); seeded rows and cassettes use entity tokens only.
7. **`customers.near_miss_ignore`** is stored so the runtime dictionary equals the seed-time one.
8. **Capabilities** `useAi`, `testAiConnection` (opened by DEMO_OPEN_CONTROLS), `viewAudit`, `revealAudit`,
   `exportAudit`; tasks name their capability.
9. **Smoke cassettes** carry one exact entry per switcher persona plus a scenario fallback, and their replies never
   echo a name, so every persona gets a REPLAY row.
10. **EMAIL and PN run before the dictionary** (the draft had the dictionary first). Otherwise an address or part
    number that contains a customer's name or alias ("buyer@aerovance.…", "HFC-99999") left the rest of the string
    in the clear around a customer token. A PN-shaped string that is exactly a known part / job / quote number still
    gets that record's own dictionary token, so the PN probe never changes the surface a later name restores to.
11. **Retrieval seam.** `GatewayDeps.retrieve?` returns the records found for a question; they are budgeted with the
    pinned ones and are what the hybrid "ask without controlled records" escape hatch can drop. Pinned records are
    part of the request floor and are never dropped (the escape hatch only narrows). Phase 4 plugs FTS retrieval in here.
12. **Health is a store, not a function.** `GatewayDeps.healthStore?` is the TTL cache (`createHealthSource`, 15 s ready /
    5 s otherwise) so tests can inject a "local down" state; `/api/health` reads it and `?deep=1` refreshes it.
13. **`capsFor()` is static** per provider kind (native JSON schema, effort support, context size); no capability probe.
14. **`SourceChip.fingerprint`** (`kind:id@hash16`) travels with the chip so cassettes can cite sources stably across
    S# renumbering, and the scenario matcher can require every cited fingerprint to have been sent.
15. **Audit detail renders `TokenSegment[]`** (text / token pieces) for the typed input, the stored request and the
    response, so the drawer can style tokens without parsing HTML; Reveal maps only that row's tokens.
16. **Cloud responses are redacted around their tokens before storage** (`redactAroundTokens`): the request's own
    tokens stay, a name or amount the model wrote in the clear is tokenized, and a token the request didn't send is
    escaped. Local and fallback responses are redacted whole (they are plain text). Found by
    `tests/gateway-hygiene.test.ts`.
17. **Known limitation: pattern-token codes are keyed by the public shop seed.** AMOUNT / EMAIL / PHONE / PN tokens are
    HMACs of the value under `tokenKey(shop seed)`, a demo constant, so someone with the repo could confirm a guessed
    value from its token. Acceptable for fictional demo data; a real deployment needs a per-install secret key.
18. **Seeded history has 21 rows** (every decision, local EC redacted-for-storage, Bedrock global profile, a smoke
    test, a timeout and a repair chain), all `transport: seeded`, `SEED-NNNN` IDs, explicit row IDs inserted by Reset.
