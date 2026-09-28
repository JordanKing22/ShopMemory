# ShopMemory — Build Plan

> **Status:** Phase 0 (plan only). No application code yet. Waiting for answers to the questions in [§17](#17-questions-before-phase-1) before starting Phase 1.
>
> **What this is:** a scripted, reliable **sales demo** for CNC / precision machine shops. It captures the tacit know-how of senior people (quoting judgment, setups, machine quirks, customer requirements) and makes it usable by newer employees, with privacy and deployment flexibility that ITAR/CUI shops can see. **All data is fictional.**
>
> Research date for every version number, model ID and vendor statement below: **2026-09-28**. Anything marked *ASSUMPTION* is a decision you can overrule; they are collected in [§16](#16-assumptions-to-confirm).

## Contents

1. [Goals, non-goals, principles](#1-goals-non-goals-principles)
2. [Decisions at a glance](#2-decisions-at-a-glance)
3. [Architecture](#3-architecture)
4. [AI gateway and privacy layer](#4-ai-gateway-and-privacy-layer)
5. [Data model](#5-data-model)
6. [Knowledge risk: taxonomy, coverage and risk math](#6-knowledge-risk-taxonomy-coverage-and-risk-math)
7. [Seed data](#7-seed-data)
8. [Core modules](#8-core-modules)
9. [Screens and routes](#9-screens-and-routes)
10. [UI and theme](#10-ui-and-theme)
11. [Demo mode and the scripted path](#11-demo-mode-and-the-scripted-path)
12. [Testing and quality gates](#12-testing-and-quality-gates)
13. [Phase breakdown](#13-phase-breakdown)
14. [Risks and mitigations](#14-risks-and-mitigations)
15. [Seams for out-of-scope items](#15-seams-for-out-of-scope-items)
16. [Assumptions to confirm](#16-assumptions-to-confirm)
17. [Questions before Phase 1](#17-questions-before-phase-1)
18. [Sources](#18-sources)
19. [Progress log](#19-progress-log)

---

## 1. Goals, non-goals, principles

**Goals**
- A 12–14 minute scripted demo (six steps, [§11](#11-demo-mode-and-the-scripted-path)) that works every time, with or without network or API keys.
- Seven working modules: Knowledge Risk dashboard, AI Interviewer (plus Quote Reasoning Log), Knowledge Library, Ask the Shop, Document Generator, Machine pages, Training.
- A privacy and deployment layer that a prospect can *see*: classification on every record, a single routing policy, redaction with a "What will be sent" preview, an audit log, roles, consent, and cloud / local / hybrid modes.
- Installs cleanly with `npm install` on Windows 10/11 and Ubuntu 22.04/24.04 without C++ build tools.

**Non-goals (seams only, [§15](#15-seams-for-out-of-scope-items))**: real authentication/SSO, multi-tenant hosting, ERP / Paperless Parts integrations, vector search, production deployment.

**Principles**
1. **The AI is the interviewer; the shop is the expert.** Code and prompts contain *method* (Critical Decision Method, ACTA knowledge audit, laddering, teach-back), never machining facts. Every domain fact lives in `seed-data/` (fictional, for SME review) or comes from the person being interviewed. The interviewer is mechanically prevented from introducing technical terms or numbers the expert didn't say ([§8.2](#82-ai-interviewer-and-quote-reasoning-log)).
2. **One chokepoint for AI.** Every model call goes through `runAI()`. Nothing else imports a provider SDK. Classification, routing, redaction, preview and audit therefore can't be skipped by a feature.
3. **Demo mode changes only the transport.** Cached responses flow through the same routing, redaction, restoration and audit code as live calls.
4. **Deterministic by construction.** Fixed seed, fixed `DEMO_TODAY`, stable IDs, UTC formatting. Reset restores the exact same state in well under 2 seconds.
5. **Honest copy.** The app never claims to be ITAR/CMMC/FedRAMP compliant, never says "audio deleted" when it never had the audio, and labels replayed AI answers as replays.

---

## 2. Decisions at a glance

| Area | Decision | Why (short) |
|---|---|---|
| Runtime | **Node 24 LTS** (engines `>=22.13 <27`) | Active LTS until Oct 2026, maintained to Apr 2028; Node 22 also works |
| Framework | **Next.js 16.3.6** App Router, TypeScript 5.9, React 19.2 (as installed by create-next-app), Turbopack | Current stable. TS 7 / ESLint 10 break `eslint-config-next` today |
| Layout | `src/` directory, alias `@/*` → `./src/*` | Keeps SME-editable `seed-data/` and tooling at the root, app code in `src/` |
| Styling | **Tailwind CSS 4.3** (CSS-first `@theme`), **shadcn/ui CLI 4.21** (Radix base) | Brief. No `tailwind.config.js` in v4 |
| DB driver | **better-sqlite3 pinned to exactly `12.11.1`** + drizzle-orm 0.45.3 + drizzle-kit 0.31.11 | Downloads a prebuilt binary (no compiler) on Windows and Ubuntu; FTS5 included; sync API makes atomic reset trivial. **Not 13.0.3**: it currently triggers `node-gyp` on lockfile installs (upstream issue #1516). Fallback: `@libsql/client` 0.18 (needs VC++ runtime on Windows) |
| Search | SQLite **FTS5** (bm25) + tag/synonym boosts; no vector DB | Brief; deterministic; zero extra services |
| Cloud LLM | `@anthropic-ai/sdk` 0.129.0, `ANTHROPIC_MODEL` default **`claude-sonnet-5-5`** (verified valid ID) | Brief |
| Bedrock | `@anthropic-ai/bedrock-sdk` 0.34.0, `BEDROCK_ENDPOINT=runtime` default (`mantle` optional); `AWS_REGION` and `BEDROCK_MODEL_ID` **required, no defaults** | Shares request/stream types with the Anthropic adapter; runtime client otherwise silently defaults to us-east-1 |
| Local LLM | Ollama ≥ 0.34.4 via native `/api/chat` (plain `fetch`), default **`OLLAMA_MODEL=qwen3.5:4b`**, `think:false`, `num_ctx` 8192 | Fits a 16 GB laptop without GPU; final pick after you answer Q1 |
| Structured output | JSON schema where the provider supports it, **always** zod-validated in code with one repair retry | Bedrock (Sonnet 5.5) and small Ollama models don't guarantee schema adherence |
| Voice | Browser Web Speech API behind a **speech-engine policy** (prefer Chrome on-device; block vendor-cloud speech for controlled records) + "Simulated dictation" for the demo | Chrome's default engine sends audio to Google; see [§4.9](#49-consent-and-voice) |
| Tests | Vitest 5 (+ vite 8), Playwright 1.63, a single `npm run demo:check` gate | Protects the scripted path on both OSes |
| Fonts | `geist` npm package via `next/font/local` | Builds and runs fully offline |
| QR | `qrcode` 1.5.4 → server-rendered SVG | Deterministic, no client JS |

---

## 3. Architecture

### 3.1 Big picture

```
 Browser (Chrome desktop / tablet)
   │  pages (React Server Components)          NDJSON streams          Server Actions (mutations)
   ▼                                              ▲                          │
 ┌──────────────────────────────── Next.js 16 server (Node runtime) ────────────────────────────────┐
 │  src/app/(app)/*  pages ──► src/lib/data/*  (role-aware reads; every read calls connection())   │
 │  src/app/api/ai/[task] ──► runAI()  ◄── the ONLY path to a model                                  │
 │        runAI: actor → role projection → retrieval (FTS5) → classify → policy.decide →            │
 │               withheld notice → assemble → redact (cloud) → [preview returns here] →             │
 │               audit write-ahead → TRANSPORT → restore tokens → validate/cite → audit finalize    │
 │                                     │                                                             │
 │                    ┌────────────────┼──────────────────────┐                                      │
 │                    ▼                ▼                      ▼                                      │
 │          Anthropic adapter   Bedrock adapter        Ollama adapter        ReplayTransport         │
 │          (api.anthropic.com) (commercial/GovCloud)  (127.0.0.1:11434)     (DEMO_MODE cassettes)   │
 │                                                                                                   │
 │  better-sqlite3 (one connection per process, WAL) ──► data/shopmemory.db (+ FTS5 tables)          │
 └───────────────────────────────────────────────────────────────────────────────────────────────────┘
        ▲ npm run seed / Reset demo: one synchronous transaction, deterministic reinsert from seed-data/
```

### 3.2 Repository layout

```
ShopMemory/
  PLAN.md  CLAUDE.md  AGENTS.md*  README.md  .env.example  .gitattributes  .gitignore
  next.config.ts  drizzle.config.ts  eslint.config.mjs  vitest.config.mts  playwright.config.ts
  tsconfig.json  postcss.config.mjs  components.json            (* AGENTS.md is generated by create-next-app)
  seed-data/            ALL domain content, SME-editable (YAML / CSV / Markdown) + demo cassettes
  drizzle/              generated migrations + custom FTS5 migration
  data/                 runtime DB, seed bundle, uploads (gitignored; data/.gitkeep committed)
  scripts/              *.mts run with tsx: seed, seed-check, demo-record, demo-verify, demo-check, e2e-server, serve-https
  tests/                Vitest unit/integration tests
  e2e/                  Playwright specs + no-egress preload
  docs/                 DEMO-RUNBOOK.md, SME-REVIEW.md (Phase 8)
  src/
    app/
      (app)/            app shell + pages (risk, library, ask, interview, documents, machines, people, jobs, training, audit, privacy, settings, review, demo)
      api/              ai/[task], ai/preview, health, audit/export, export, uploads
      actions/          Server Actions (persona, ai-mode, reset, approvals, reviews, consent, delete)
    components/         ui/ (shadcn), risk/, interview/, ask/, documents/, machines/, privacy/, common/
    db/                 schema/*.ts, client.ts (no server-only), reset.ts, classification.ts, fts.ts
    server/             db.ts, ai.ts  — `import 'server-only'` wrappers used by the app
    lib/
      env.ts log.ts errors.ts time.ts
      auth/             identity.ts, roles.ts, field-policy.ts
      data/             role-aware data access (cards, jobs, people, machines, documents, audit…)
      retrieval/        fts-query.ts (sanitizer), synonyms.ts, retriever.ts, similar-jobs.ts
      coverage/         compute.ts, params.ts
      policy/           matrix.ts, targets.ts, decide.ts, notices.ts, entity-detect.ts
      redaction/        dictionary.ts, patterns.ts, redact.ts, stream-restorer.ts
      ai/               types.ts, gateway.ts, pipeline.ts, transport.ts, structured.ts, citations.ts,
                        tasks/*, providers/{anthropic,bedrock,ollama}.ts, replay/*
      audit/            ai-audit.ts, events.ts, query.ts, export.ts
      interview/        machine.ts (state machine), probes.ts, tracker.ts, novelty.ts, traceability.ts
      speech/           policy.ts (pure, shared), engine.client.ts
      demo/             steps.ts, preflight.ts, fast-forward.ts
      seed/             load.ts, schemas.ts (zod), prng.ts (mulberry32), generate.ts, bundle.ts
```

### 3.3 Conventions that shape the architecture
- **Reads** are React Server Components calling `src/lib/data/*` functions that take the current `actor`, call `await connection()` (so pages are never prerendered with stale data), and return role-projected objects.
- **Mutations** are Server Actions that start with `requireActor()` + `assertCan(...)` (Server Actions are reachable by direct POST).
- **AI calls and downloads** are route handlers (`/api/ai/[task]` streams NDJSON; `/api/audit/export`, `/api/export`). Server Actions run one at a time and cap bodies at 1 MB, so they're kept short.
- `cacheComponents` stays **off**; no `use cache` on DB data.
- The DB module and the gateway core don't import `server-only` (it throws under `tsx` scripts); the app imports them through `src/server/*` wrappers that do.

---

## 4. AI gateway and privacy layer

### 4.1 Provider abstraction

```ts
// src/lib/ai/types.ts (abridged)
type ProviderKind = 'anthropic' | 'bedrock' | 'ollama';
type TargetClass  = 'anthropic' | 'bedrock_commercial' | 'bedrock_govcloud' | 'ollama_local';
type AIMode       = 'cloud' | 'local' | 'hybrid';

interface ProviderDescriptor { kind; targetClass; isCloud; model; host; region?; endpointMode?: 'runtime'|'mantle'; fips?; available; verified: 'live-probe'|'config-only-demo' }

interface LLMProvider {
  readonly descriptor: ProviderDescriptor;
  readonly caps: { nativeJsonSchema: boolean; supportsEffort: boolean; maxContextTokens: number };
  complete(req: ProviderRequest, o: CallOptions): Promise<ProviderResponse>;
  stream(req: ProviderRequest, o: CallOptions): AsyncIterable<ProviderStreamEvent>;
  health(deep?: boolean): Promise<ProviderHealth>;
}

// Exactly what goes over the wire (already redacted for cloud). The preview panel shows this object.
interface ProviderRequest {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];   // text only; photos never sent in v1
  maxTokens: number;
  output: { kind: 'text' } | { kind: 'json'; schemaName: string; jsonSchema: object };
  effort?: 'low' | 'medium' | 'high';
}
```

**Adapter rules (verified against current docs)**

| Adapter | Must do | Must never do |
|---|---|---|
| Anthropic (`providers/anthropic.ts`) | Lazy client (so DEMO_MODE needs no key), `logLevel: 'warn'` set explicitly (at `ANTHROPIC_LOG=debug` the SDK logs request bodies), `maxRetries: 2`, timeout. Effort via `output_config.effort` (`low` for interviewer phrasing, `medium` elsewhere). JSON via `output_config.format` with a **hand-written** JSON schema (`jsonSchemaOutputFormat(schema, { transform: false })`, because the SDK's zod helper silently drops `enum`). Check `stop_reason === 'refusal'`. Leave `max_tokens` headroom for adaptive thinking. | Send `temperature` / `top_p` / `top_k`, forced `tool_choice` (`any`/`tool`), assistant prefill, or `thinking: {type:'disabled'}` — each returns HTTP 400 on Sonnet 5.5. Combine structured output with the Citations feature (400). |
| Bedrock (`providers/bedrock.ts`) | `AnthropicBedrock` (runtime, default) or `AnthropicBedrockMantle` (`BEDROCK_ENDPOINT=mantle`). Require `AWS_REGION` + `BEDROCK_MODEL_ID` and **fail closed** without them. `BEDROCK_BASE_URL` for FIPS/VPC endpoints (the SDK ignores `AWS_USE_FIPS_ENDPOINT`). Standard AWS credential chain (profile/SSO, env keys, or `AWS_BEARER_TOKEN_BEDROCK`). Prompt-JSON + zod (`nativeJsonSchema: false`). | Hardcode model IDs. Assume structured outputs (Sonnet 5.5 on Bedrock returns 400). Same sampling/tool_choice rules as above. |
| Ollama (`providers/ollama.ts`) | Native `POST /api/chat` with plain `fetch` + NDJSON parsing. **Always** `think: false`, identical `options` on every call (`num_ctx` from `OLLAMA_NUM_CTX`, `temperature: 0`, `num_predict` cap), `keep_alive: '60m'`, `format: z.toJSONSchema(...)` for JSON tasks, `truncate: false` outside production. Refuse models whose `/api/show` reports a non-empty `remote_host` (Ollama "cloud" tags). Record `load_duration` / `eval_count` timings in the audit row. | Use the OpenAI-compatible `/v1` (can't set `num_ctx` per request). Omit `think` (thinking defaults **on** and makes CPU answers take minutes). Change options between calls (forces a model reload). |

Bedrock model IDs are **not** hardcoded. `.env.example` points to: AWS "Supported inference profiles", Anthropic "Claude in Amazon Bedrock", and the AWS GovCloud (US) Bedrock page. As of 2026-09-28 Anthropic's docs list Bedrock IDs such as `anthropic.claude-sonnet-5-5` (Mantle) and runtime inference profiles such as `global.anthropic.claude-sonnet-5-5`; GovCloud uses the `us-gov.` prefix. **Sonnet 5.5 has no confirmed GovCloud availability yet**, so a GovCloud demo would use another model (for example Opus 5.5). Confirm on the real account with `aws bedrock list-inference-profiles --region us-gov-west-1`.

### 4.2 The chokepoint: `runAI()`

```ts
runAI(req: AIRequest, opts: { dryRun: true }): Promise<AIPreview>;              // "What will be sent"
runAI(req: AIRequest, opts?: { expectedPayloadHash?: string; signal?: AbortSignal }): AIRun;  // real call
// AIRequest carries: task, feature, actor, input text/turns, pinned RecordRefs, retrieval query, sessionId, consentId, scenarioHint (demo matching only)
// Callers pass record *references*; the gateway loads bodies and classifications from the DB itself,
// so a feature can't under-declare a classification.
```

Every AI surface calls `POST /api/ai/[task]`, which returns `runAI(...).events` as `application/x-ndjson`:

```ts
type AIStreamEvent =
  | { t: 'meta'; requestId; decision: PublicDecision; sources: SourceChip[]; badge }   // always first; includes withheld notice
  | { t: 'text'; d: string }        // already token-restored and citation-checked on the server
  | { t: 'result'; data: unknown }  // structured tasks, zod-validated
  | { t: 'done'; auditId; outcome; latencyMs; citationsStripped }
  | { t: 'error'; code; message };  // safe message only, never payload text
```

**Pipeline** (P-steps are shared by the preview and real runs; R-steps only for real runs):

| # | Step | Detail |
|---|---|---|
| P0 | Context | Actor from the persona cookie; routing settings; cached provider health; task allowed for this role; valid consent for interview/extraction/quote-log tasks |
| P1 | Role projection | Records pass through `projectForRole(entity, role, 'llm')`. The prompt builders receive an `LlmProjection<T>` type that has no pricing or contact fields at all. Records the role can't see are dropped silently (not reported as "withheld", so their existence isn't revealed) |
| P2 | Retrieval | FTS5 + tags + synonyms over role-visible records; choose the task's context budget (e.g. Ask: 8 cards + 3 jobs) *ignoring classification* — this is the set the request "touches" |
| P3 | Classify | **Floor** = max of (a) entities detected in the user's text (naming an export-controlled job/part/customer makes the question itself export-controlled), (b) the session's classification, (c) pinned records. Candidates keep their own classifications |
| P4 | Decide | `policy.decide()` ([§4.4](#44-routing-policy)) → target, sent vs withheld (withheld slots backfilled with the next-best cleared records), or **blocked** |
| P5 | Notice | Withheld/blocked message rendered for the first `meta` event |
| P6 | Assemble | Sources get per-request keys `S1…Sn` (DB IDs never reach the provider); task prompt built with a `promptVersion`; Ollama token budget enforced |
| P7 | Redact | Only when the target is cloud — **including GovCloud** |
| P8 | Freeze | `payloadHash = sha256(canonical(redacted payload + target))`. **Preview returns here.** A real call with a stale `expectedPayloadHash` is rejected |
| R1 | Audit write-ahead | Row inserted with `outcome='pending'`. Blocked decisions write a complete row with nothing sent and stop |
| R2 | Transport | Live adapter, **or `ReplayTransport` in DEMO_MODE — the only step that differs** |
| R3 | Restore | `StreamRestorer` swaps tokens back using *this request's* map; safe across chunk boundaries |
| R4 | Post-process | Citations `[S#]` kept only if actually sent (others stripped and counted; an answer with zero valid citations gets an "unverified" banner); zod validation + one repair retry (child audit row); refusal handling; outputs inherit `max(sent classifications, floor)`; task hooks (e.g. card traceability gate) |
| R5 | Audit finalize | Redacted response, tokens, latency, outcome, served model. A SQLite trigger blocks updates after completion |
| R6 | Emit | text → result → done; client disconnect aborts the provider call |

**Enforcement:** ESLint `no-restricted-imports` (provider SDKs only inside `src/lib/ai/providers/*`; `transport`/`pipeline`/`replay` internal to `src/lib/ai`), `no-console` (only `log.ts` and scripts), `no-restricted-properties` on `process.env` (only `env.ts` and config files), plus `tests/architecture.test.ts` that greps for the same things (needed because `next build` no longer runs lint).

### 4.3 Data classification

Four levels, ranked: `general < internal < customer_confidential < export_controlled`. Every card, job, part, quote, transcript (interview + turns), document, quiz, photo, machine event and quote-reasoning log has `classification`, plus `classification_source` (`derived` | `override_up` | `override_down`) and a required reason for overrides. One module (`src/db/classification.ts`) derives floors and reclassifies dependents in one transaction with an audit event.

| Record | Derived floor | Notes |
|---|---|---|
| customer | — (default `customer_confidential`) | Each customer also has a `part_classification_floor` (defense customers: `export_controlled`) |
| part | max(customer floor, `export_control ∈ {ear_controlled, itar}` → export_controlled) | Lowering below the customer floor: owner + reason only |
| quote / job | the part (up only) | |
| interview (transcript) | max of linked quote/job/part/customer and the level chosen at consent | Can be raised mid-session |
| knowledge card | max(source interview, all linked records, `internal`) | Never auto-lowered |
| document / quiz | max of source cards (at pinned versions) | Recomputed when sources change |
| photo | max of linked records | |

People, personas, machines and the shop profile are implicitly `internal`; materials and process topics `general`. UI tooltip on every badge: *"These labels control routing inside this app. They are not official CUI markings or export-classification determinations."*

### 4.4 Routing policy

A single config object in `src/lib/policy/matrix.ts` is the source of truth; the Privacy page matrix and the header clearance dots render from it.

| Classification ↓ / Target → | Anthropic API | Bedrock (commercial region) | Bedrock GovCloud (allowlisted host) | Ollama (this computer / allowlisted on-prem host) |
|---|---|---|---|---|
| general | ✅ redacted | ✅ redacted | ✅ redacted | ✅ |
| internal | ✅ redacted | ✅ redacted | ✅ redacted | ✅ |
| customer_confidential | ✅ redacted *(ASSUMPTION; `CUSTOMER_CONFIDENTIAL_CLOUD=deny` makes it local/GovCloud-only)* | ✅ redacted | ✅ redacted | ✅ |
| export_controlled | ❌ | ❌ | ✅ redacted | ✅ |

- Redaction on cloud calls is **always on** and not configurable.
- **Pricing and customer contacts never reach any model**, regardless of classification (field rule, [§4.8](#48-roles)).
- **GovCloud target** only if *all* hold: region ∈ {`us-gov-west-1`, `us-gov-east-1`}; the resolved host (lower-cased, exact match) is in `GOVCLOUD_ENDPOINT_ALLOWLIST` (default: the two `bedrock-runtime-fips.<region>.amazonaws.com` hosts); the host contains the region; `https:` with no path/userinfo; model ID prefix `us-gov.` (runtime) or `anthropic.` (mantle). Otherwise it's treated as commercial and the Settings page says which check failed.
- **Ollama counts as local** only if `OLLAMA_BASE_URL` is loopback or in `OLLAMA_HOST_ALLOWLIST`, and the model has no `remote_host`.

**`decide()`** (pure function):

```
floor = max(requestText entities, session, pinned)
local mode : target = local;  unavailable → blocked('local_unavailable')
cloud mode : target = cloud;  floor not cleared → blocked('request_not_cleared')   // nothing sent, no transport call
hybrid     : need = max(floor, classifications of the budgeted context set)
             cloud cleared for need → cloud;  else local available → local
             else blocked('local_unavailable_controlled')        // FAIL CLOSED: never falls back to cloud
sent = context records cleared for target (+ backfill);  withheld = the rest;  redact = target.isCloud
```

- Hybrid routes by the highest classification in the budgeted context set (not all 40 candidates), so one weakly related controlled card doesn't push every question local.
- Hybrid with Ollama down: refused, with an explicit **"Ask without the N controlled records"** button that sends a *new*, separately audited request.
- Mode is global and server-side (no per-request client override).

**User-facing notices** (`policy/notices.ts`):
- *Withheld:* "2 export-controlled records were withheld from this answer. Cloud mode (Anthropic API · claude-sonnet-5-5) isn't cleared for export-controlled data, so they were not sent. Switch to Local or Hybrid to include them." + expandable list.
- *Blocked:* "Not sent. This question refers to job RJ-26-0318, which is export-controlled. Export-controlled data can go only to the local model or an allowlisted AWS GovCloud endpoint. Nothing was sent to Anthropic. [Switch to Local] [Show matching records]"
- *Hybrid, local down:* "Not sent. This request includes export-controlled records, which must go to the local model, but Ollama at 127.0.0.1:11434 isn't responding. ShopMemory never sends controlled data to the cloud as a fallback."
- Search panels and "similar jobs" are local DB queries (not AI calls), so they show everything the *role* may see; records not sent to the AI carry a lock chip: "Shown to you · not sent to {provider}".

### 4.5 Redaction

**Dictionary** built from the DB (cached, version-bumped on writes and reset):

| Source | Token (derived from the entity ID, so stable across resets) |
|---|---|
| customer names + aliases | `[[CUSTOMER_01]]` (from `CUS-01`) |
| person full names, last names, first names/nicknames (capitalized, case-sensitive) | `[[PERSON_01]]` (from `PER-01`) |
| part numbers (hyphen/space/dot-insensitive) | `[[PART_A01]]` (from `PRT-A01`) |
| job and quote numbers (they cross-reference customer POs) | `[[JOB_A03]]`, `[[QUOTE_A01]]` |
| customer contacts (never sent anyway) | `[[CONTACT_01]]` |
| regex: part-number-like strings not in the DB; emails; phones | `[[PN_01]]`, `[[EMAIL_01]]`, `[[PHONE_01]]` (persisted in `redaction_tokens`) |

- One compiled alternation, **longest match first** ("Ray Delgado" before "Ray"), Unicode-aware boundaries (`(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])`, handles "Aerovance's", "Ray-approved"), NFC-normalized input.
- **Not redacted, on purpose:** materials, machine makes/models, process terms, tolerances, hours, spec numbers (AS9102, AMS, MIL…), the shop's own name. That's the know-how the model needs; the brief lists customers, part numbers and people.
- **Restoration** (`StreamRestorer`): buffers any trailing partial token (`[[`…) across chunks, restores only tokens in *this request's* map (unknown → `[unknown]`), and validates `[S#]` citations in the same pass. Unit-tested by splitting every token at every offset.
- **Limitations shown in the preview panel:** unknown names in free text, misspellings / speech errors ("Arrow Vance"), indirect identifiers, and — most importantly — the technical content itself. For export-controlled work **routing is the control; redaction only reduces exposure.** The preview lists fuzzy near-misses ("suspects") with a one-click "Redact this" that adds an alias. Stable tokens let a provider correlate `[[CUSTOMER_01]]` across calls; the Privacy page states that trade-off.

### 4.6 "What will be sent" preview

A sheet opened from the Send button in Ask the Shop, Document Generator, Quote Log and Training (the interviewer gets a "Show last payload" link instead, so the flow isn't interrupted every turn). It is the **same `runAI()` with `dryRun: true`**, so the preview is byte-identical to what is sent. It shows destination (provider · model · host · region · mode), classification chips, sent/withheld records with reasons, the exact `ProviderRequest` JSON with tokens highlighted (signal-orange outline, ink text), a collapsible token legend rendered locally for fields the viewer's role may see, and **"Send exactly this"** (passes `payloadHash`). For local targets the header reads "Local: not redacted; never leaves this computer" (the last clause only when the host is loopback).

### 4.7 Audit log

Two tables: `ai_audit_log` (every AI call, including blocked ones) and `event_log` (consent, persona switches, settings changes, card/document transitions, speech sessions and blocks, exports, deletes, resets).

- **`ai_audit_log` columns:** timestamps, request/parent IDs and attempt, actor (persona, name, role), feature, task, mode, decision, provider kind, target class, configured and served model, endpoint host, region, isCloud, transport (`live` | `demo_replay_exact` | `demo_replay_scenario` | `demo_fallback` | `none`), max classification, classifications included, record IDs sent, records withheld (+reason), notice, redaction token count and tokens used, **redacted user input, redacted request payload, payload hash, payload stored form, redacted response**, prompt version, token usage, latency/TTFT, stop reason, outcome, safe error, citation counts, policy version, app version.
- **Guarantee:** no unredacted payload is ever persisted. Cloud rows store exactly the redacted payload that was sent. **Local (Ollama) rows store the payload redacted-for-storage** (same redactor, run for the audit row only), labelled "sent: unredacted (local) · stored: redacted". A **Reveal** toggle re-hydrates at render time for the owner (or the call's own actor, for fields their role may see). This keeps one testable invariant: *the audit tables never contain a dictionary name.*
- **Integrity:** write-ahead then one finalize; a trigger aborts later updates. Only Reset demo and Full delete remove rows, and both write an event. (Seam: hash chain + "Verify".)
- **Viewer `/audit`:** filters (date, persona, role, feature, provider, model, mode, decision, classification, replay, outcome, free text over redacted input), detail drawer (Sent · Response · Policy · Reveal · Retry chain), owner sees all rows, others their own.
- **Export** `GET /api/audit/export?format=csv|json` (owner): CSV formula-injection guard, filename carries the highest classification included, each export writes an event.

### 4.8 Roles

Demo personas: **Owner** (Dana Whitcomb, owner/GM; not a knowledge holder — *ASSUMPTION*), **Ray** (quoter; used for approvals), **Maya** (quoter), **Marv** (machinist), **Devin** (trainee). An "Act as…" menu can derive a persona for any seeded person. Cookie `sm_persona` (httpOnly, SameSite=Lax); the role is read from the DB, never from the cookie.

| Field / capability | owner | quoter | machinist | trainee | Sent to an LLM? |
|---|---|---|---|---|---|
| Prices, unit price, margins, shop rates, material cost, risk adders | ✓ | ✓ | hidden | hidden | **never** |
| Quoted vs actual hours, setup/cycle times | ✓ | ✓ | ✓ | ✓ | yes |
| Win/loss and loss reason | ✓ | ✓ | hidden | hidden | only if the role can see it |
| Customer names and documented quirks | ✓ | ✓ | ✓ | ✓ | yes (tokenized for cloud) |
| Customer contacts and commercial terms | ✓ | ✓ | hidden | hidden | **never** |
| Planned retirement dates | ✓ | ✓ | risk colors only | risk colors only | no |
| Audit log | all rows + Reveal | own rows | own rows | own rows | — |
| Audit export, full export, full delete | ✓ | – | – | – | — |
| Change AI mode, Reset demo | ✓ (**any persona when `DEMO_MODE=true`** — *ASSUMPTION*, so step 6 needs no persona switch) | | | | — |
| Approve cards | as contributor, or "on behalf" with logged reason | as contributor | as contributor | as contributor | — |
| Approve documents | ✓ | if assigned reviewer | if assigned reviewer | – | — |
| Start interview / Quote Reasoning Log | any subject / ✓ | self / ✓ | self / – | – / – | — |
| Generate documents | ✓ | ✓ | ✓ | – | — |

Hidden fields render a visible pill ("Hidden for Machinist role") so the demo can point at it. Enforcement is server-side in three places: data access functions, every action/route handler, and the gateway's role projection. `tests/role-projection.test.ts` asserts trainee/machinist payloads contain no pricing field names, `$` amounts or contact tokens.

### 4.9 Consent and voice

**Consent.** Interviews and quote logs can't start until the subject (or the owner "on behalf", naming the subject) ticks a consent box. `consent_records` stores who, when, text version, SHA-256 of the exact text shown, and the speech engine disclosed. `runAI()` refuses interview/extraction/quote-log tasks without valid consent. Withdrawal deletes the transcript and unapproved drafts and writes an event.

**The brief's "raw audio is deleted after transcription" can't be stated truthfully with the Web Speech API**: ShopMemory never receives the audio at all, and the browser vendor might (Chrome's default engine sends audio to Google; Safari may use Apple servers and the page can't tell; Chrome 139+ offers an on-device mode via `processLocally`, `SpeechRecognition.available()` and `install()`; Android Chrome has no on-device mode). So the copy is engine-specific, shown in a chip next to every mic:

| Engine | Chip copy |
|---|---|
| Chrome on-device | "Voice: on this device. Audio never leaves this computer. ShopMemory saves only the text you approve." |
| Chrome/Edge cloud | "Voice: Google (or Microsoft) speech service. Your browser sends audio to that service to turn it into text. ShopMemory never receives or stores audio." |
| Safari | "Voice: Apple speech. Safari may transcribe on this device or on Apple's servers, and ShopMemory can't tell which. ShopMemory never receives or stores audio." |
| Blocked | "Voice is off for this interview because this browser can't guarantee on-device speech for customer-confidential or export-controlled work. Please type, or use Chrome with on-device speech installed." |
| Simulated (demo) | "Simulated dictation (demo): plays the scripted answer; no microphone used." |

**Speech policy** (`src/lib/speech/policy.ts`, pure): on-device always allowed; vendor-cloud speech **blocked** in Local mode, for customer_confidential or export_controlled sessions, or when Hybrid would route the session local (redaction can't apply to audio); never a silent fallback from `processLocally=true` to cloud. Speech sessions and blocks are logged (engine, duration, character count — never transcript text). The "audio deleted after transcription" sentence is reserved for the future local speech-to-text seam ([§15](#15-seams-for-out-of-scope-items)), where deletion would be enforced and audited.

Voice requires a secure context: `http://localhost` is fine; a tablet hitting `http://192.168.x.x` gets no microphone. The scripted voice moments therefore run in Chrome on the laptop.

### 4.10 Secret and payload hygiene
- `src/lib/env.ts`: zod-validated env parsed once at boot (`instrumentation.ts`); conditional rules (e.g. `LLM_PROVIDER=bedrock` requires `AWS_REGION` + `BEDROCK_MODEL_ID`); boot log prints which variables are *set*, never values. The only file allowed to read `process.env`.
- `src/lib/log.ts`: the only place `console.*` is allowed. Accepts flat primitive fields, drops keys matching `prompt|payload|messages|content|text|body|transcript|key|secret|token|authorization|password|cookie`, truncates strings, scrubs `sk-ant-…`, AWS key IDs/secrets, `Bearer …`.
- Provider errors are wrapped (`AIError { code, safeMessage }`); raw SDK error objects (which can carry request options) are never logged or rethrown to Next's overlay.
- Never set `OLLAMA_DEBUG_LOG_REQUESTS` (writes request bodies to disk). Setup docs recommend `OLLAMA_NO_CLOUD=1`.
- `tests/secret-hygiene.test.ts`: canary API key + canary phrase in Maya's question, spy on stdout/stderr/console across the full scripted path (including a forced provider error and `ANTHROPIC_LOG=debug`), assert no canary, no dictionary name, no prompt fragment appears — and that the audit tables contain no dictionary names.

### 4.11 Settings, header badge, preflight

**Precedence:** `AI_SETTINGS_LOCKED=true` → env only; else the in-app setting (`app_settings`) if set; else env (`LLM_PROVIDER` + `AI_MODE`); else cloud/Anthropic. Model IDs change only via env. Reset demo restores `DEMO_DEFAULT_MODE`.

**Header badge (always visible, collapses to icon + short label on phones):** mode pill (CLOUD / LOCAL / HYBRID), provider line (`Anthropic API · claude-sonnet-5-5`, `Amazon Bedrock · us-gov-west-1 · FIPS · allowlisted`, `Ollama · qwen3.5:4b · this computer · Ready`), four clearance dots (G/I/CC/EC), a `REPLAY` tag in DEMO_MODE (signal-orange fill, **ink** text), and a health dot linking to Privacy & Deployment. Every AI result also carries a per-request "Routed to …" chip (Hybrid uses two providers).

**Preflight** `GET /api/health` (+ `?deep=1`): Anthropic key present / reachable (deep: `models.retrieve`, no shop data); Bedrock region, endpoint, resolved host, FIPS, allowlist checks, credential source; Ollama version ≥ 0.34.4, model pulled, `remote_host` empty, thinking values, GPU share, context length, warm. `POST /api/health/warm` pre-loads Ollama with identical options (at boot and when switching to local/hybrid; skipped in DEMO_MODE).

### 4.12 `.env.example` (committed; `.gitignore` has `.env*` and `!.env.example`)

```bash
LLM_PROVIDER=anthropic              # anthropic | bedrock | ollama
AI_MODE=                            # cloud | local | hybrid (default: local if LLM_PROVIDER=ollama, else cloud)
HYBRID_CLOUD_PROVIDER=anthropic     # cloud side of hybrid when LLM_PROVIDER=ollama
AI_SETTINGS_LOCKED=false
CUSTOMER_CONFIDENTIAL_CLOUD=allow   # allow | deny
DEMO_MODE=true
DEMO_DEFAULT_MODE=cloud             # restored by Reset demo (see Q2)
DEMO_MISS=offline                   # offline | live   (what DEMO_MODE does on a cache miss)
DEMO_REPLAY_SPEED=realistic         # realistic | fast | instant
DEMO_LIVE_LOCAL=false               # true = Local mode calls the real Ollama even in DEMO_MODE
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5-5
AWS_REGION=                         # REQUIRED for bedrock (no silent us-east-1)
BEDROCK_ENDPOINT=runtime            # runtime | mantle
BEDROCK_MODEL_ID=                   # REQUIRED. Confirm current IDs (do not guess):
#   https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html
#   https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock
#   https://docs.aws.amazon.com/govcloud-us/latest/UserGuide/govcloud-bedrock.html
BEDROCK_BASE_URL=                   # FIPS/VPC override, e.g. https://bedrock-runtime-fips.us-gov-west-1.amazonaws.com
GOVCLOUD_ENDPOINT_ALLOWLIST=bedrock-runtime-fips.us-gov-west-1.amazonaws.com,bedrock-runtime-fips.us-gov-east-1.amazonaws.com
# AWS auth: AWS_PROFILE (incl. SSO) | AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_SESSION_TOKEN | AWS_BEARER_TOKEN_BEDROCK
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:4b
OLLAMA_NUM_CTX=8192
OLLAMA_HOST_ALLOWLIST=
PUBLIC_BASE_URL=http://localhost:3000   # what machine QR codes encode (use the laptop's LAN URL for a tablet)
AI_TIMEOUT_MS=60000
```

---

## 5. Data model

### 5.1 Conventions
- SQLite via Drizzle; migrations with `drizzle-kit generate` + `migrate` (**never `push`**, which would drop the FTS tables; `tablesFilter: ['!*_fts*']`).
- One synchronous connection per process cached on `globalThis`; `journal_mode=WAL`, `busy timeout 5000`, `foreign_keys=ON`, `synchronous=NORMAL`. Transactions must be synchronous (better-sqlite3 throws on async callbacks).
- Text IDs, never random UUIDs in seed data. **People, customers and parts use opaque codes** (`PER-01`, `CUS-01`, `PRT-A01`) because IDs get serialized near prompts — a slug like `ray-delgado` would carry the name straight past the redactor. Machines/materials use readable slugs (`m-dmu50`, `mat-ti64`); printed QR codes encode `/machines/<id>`, so machine IDs are permanent.
- Dates `YYYY-MM-DD`, timestamps ISO-8601 UTC; `real` for hours and money; JSON columns typed via `$type<T>()`; enums declared once in `src/db/schema/enums.ts`; DB `CHECK` on every classification column.
- No birth dates or ages; only `hire_date` and `planned_departure_date`.

### 5.2 Tables (33 + 2 FTS5 virtual tables)

**Shop, people, personas**

| Table | Key columns |
|---|---|
| `shop_profile` (1 row) | name "Ridgeline Precision", employee_count 30, certifications `["AS9100D (fictional)"]`, **demo_today** `2026-09-15`, seed, seed_bundle_hash, fictional_notice |
| `people` (8) | id `PER-01…08`, full_name, display_name, job_title, department, app_role, cohort (veteran/new_hire), hire_date, prior_experience_years, planned_departure_date, departure_kind, is_knowledge_holder, bio_md, redaction_aliases[], sort_order |
| `personas` (5) | id `P-OWNER` / `P-PER-01`…, label, role, person_id (NULL for owner), is_default_for_role, show_in_switcher |

**Assets and customers**

| Table | Key columns |
|---|---|
| `machines` (8) | id `m-vf4`…, asset_tag `RP-M01`…, name, make, model, kind, year_installed, acquired (new/used), status, capabilities[], unit_history_md (this unit's history only) |
| `machine_events` | id, machine_id, occurred_on, kind (issue/repair/pm/crash/alarm/upgrade), summary, job_id?, person_id?, classification |
| `materials` (7) | id `mat-6061`…, name, short_name, family, aliases[] (feeds search synonyms) |
| `customers` (6) | id `CUS-01…06`, name, industry, customer_since, is_new_customer, part_classification_floor, quality_requirements_md, redaction_aliases[], part_number_pattern, classification |
| `customer_accounts` | **role-hidden** (owner/quoter): contact_name (fictional), contact_email (`@example.com`), payment_terms, annual_spend_usd, pricing_notes_md |

**Parts, quotes, jobs**

| Table | Key columns |
|---|---|
| `parts` (60) | id `PRT-A01` (anchor) / `PRT-G17` (generated) / `PRT-I01` (internal), customer_id?, part_number, revision, description, family, material_id, features[] (thin_wall, five_axis, tight_tolerance…), min_wall_in, max_wall_height_in, tightest_tol_in, complexity 1–5, export_control (none/ear99/ear_controlled/itar — demo label, not a determination), is_anchor, classification |
| `quotes` (120) | id `Q-A01` / `Q-G001`, quote_number, part_id, customer_id, quoted_on, quoted_by_person_id, qty, primary/secondary machine, quoted_setup_hours, quoted_cycle_minutes, **quoted_hours**, lead_time_days, outcome (won/lost/no_bid/pending), lost_reason, judgment_drivers[], quoter_notes_md, search_title/text/tags (**never contain prices**), classification |
| `quote_financials` | **role-hidden** (separate table so non-cleared queries never join it): shop_rate, material_cost, outside_processing, risk_adder_hours, scrap_allowance_pct, unit_price, total_price, target_margin_pct |
| `jobs` (70 won + 4 internal) | id `J-A02`, job_number, quote_id?, part_id, status, started_on, shipped_on, lead_person_id, actual_machine_id, actual setup/run/**actual_hours**, variance_pct, scrap_qty, ncr_count, on_time, debrief_md, classification |
| `quote_reasoning_logs` | quote_id, interview_id, person_id, main_driver, machine_rationale, hours_rationale, risk_priced_in, risk_bucket (hours/setup/scrap_allowance/inspection/outside_processing/other), what_would_change, junior_would_miss, confidence_1to5, variance_review_md, classification |

**Taxonomy and expertise**

| Table | Key columns |
|---|---|
| `topics` (28 heat-map rows) | id `t-thin-wall` / `t-mat-ti64` / `t-m-dmu50` / `t-cus-01`, category (process/machine/material/customer), label, FK to the matching entity |
| `tags` (~40) | id, label, topic_id? (auto-maps extracted cards to topics), synonyms[] |
| `person_topic_expertise` | (person, topic) → tacit_level 0–3, assessed_by (sme_seed/owner/self), note |

**Knowledge cards**

| Table | Key columns |
|---|---|
| `knowledge_cards` | id `KC-001…090` seeded, **`KC-091…094` reserved for the scripted interview**, `KC-101+` runtime; version, supersedes_id, type (quoting_rule / setup_tip / machine_quirk / customer_quirk / inspection_gotcha / failure_story), status (draft / pending_review / approved / rejected / superseded), title, statement, rationale, common_mistake, applies_when[], does_not_apply_when[], cues[], actions[], thresholds[] (`{quantity, comparator, value, value_max, unit, verbatim}`), open_questions[], expert_confidence (always/usually/sometimes/not_sure/not_stated), **source_person_id** (credited by name), source_kind, source_interview_id, created_by, approved_by, approved_at, approval_mode (self/on_behalf), review_notes, search_text, search_tags, classification |
| `card_links` | card → exactly one of job / quote / part / machine / material / customer / person (CHECK), mention (the expert's words) |
| `card_topics` | card ↔ topic (≤ 3 per card; drives coverage) |
| `card_tags` | card ↔ tag |
| `card_evidence` | card → interview turn (must be an **expert** turn), start_char, end_char, quote (exact substring) — every card has ≥ 1 |

**Interviews, transcripts, consent**

| Table | Key columns |
|---|---|
| `interviews` | id `INT-01…08`, **`INT-LIVE-RAY` reserved**, `INT-M-PER-0n` (hidden manual-entry sessions that give hand-entered cards provenance), mode (full_interview / quote_reasoning_log / manual_entry), expert_person_id, run_by_persona_id, topic_id, context quote/job/part/customer, status, phase, tracker_state (json), speech_engine, `audio_retained` (CHECK = 0), script_key, classification |
| `interview_turns` | id `<interview>-T001`, seq, speaker (interviewer/expert/system), phase, move (CLARIFY_NUMBER, ASK_EXCEPTION, NOVICE_GAP…), text, text_source (typed/voice/simulated/template/llm/seed), classification (= interview) |
| `consent_records` | interview_id, person_id, consent_text_version, consent_text_sha256, speech_engine_disclosed, granted, granted_at, recorded_by_persona_id, mode (self/on_behalf), revoked_at |

**Documents and training**

| Table | Key columns |
|---|---|
| `documents` | id `DOC-SS-01…25`, **`DOC-SS-LIVE` reserved**, `DOC-101+`; kind (setup_sheet / work_instruction / onboarding_checklist), title, status (draft / expert_review / approved / superseded), version, machine/part/job/for_person, reviewer_person_id, generated_by (seed/ai/manual/assembled), body (json sections with per-line card citations), body_md, program_refs[] (setup sheets cite CAM program numbers instead of speeds/feeds), approval fields, classification |
| `document_cards` | document ↔ card at a pinned card_version, section, sort |
| `quizzes`, `quiz_questions`, `quiz_question_cards` | item_type (apply / boundary / spot_cue / novice_trap / rank), scenario, choices, answer_key, rubric (criteria with card_id + evidence quote), primary_card_id, classification |
| `quiz_attempts`, `quiz_answers`, `training_progress` | attempts, per-criterion grades (correct/partial/incorrect/**unclear**), graded_by (code/llm/seed), mastery per (trainee, card) |

**Privacy and system**

| Table | Key columns |
|---|---|
| `ai_audit_log`, `event_log` | see [§4.7](#47-audit-log) |
| `redaction_tokens` | token, kind, entity_id?, real_value (**never logged, never routable**), scope, created_at — for free names and regex hits; entity tokens derive from IDs |
| `app_settings` | key → json value (`ai_routing`, `demo.epoch`, …) |
| `media_assets` | photos only (no audio, ever): file path under `data/uploads/`, sha256, size, links, classification |
| `coverage_snapshots` | baseline written at seed so the Risk Map can show "▲ +14 since reset" |

### 5.3 Full-text search
- Custom migration `drizzle/0001_fts.sql` creates `cards_fts(card_id UNINDEXED, title, body, tags)` and `quotes_fts(quote_id UNINDEXED, title, body, tags)` with `tokenize='porter unicode61 remove_diacritics 2'`, kept in sync by `AFTER INSERT/DELETE/UPDATE OF search_*` triggers; `rebuildFts()` runs at the end of every reset.
- **User text is always sanitized before `MATCH`** — the demo question itself (`thin-wall`) and `Ti-6Al-4V` throw `no such column` if passed raw (verified). Tokenize to letters/digits, drop stopwords and 1-char tokens, quote each, join with OR; expand synonyms (`ti` → titanium, 6al4v…) from `seed-data/taxonomy/search-synonyms.yaml`, material aliases and tag synonyms.
- Ranking `bm25(cards_fts, 0, 10, 1, 5)` plus tag/entity boosts; results joined back to base tables filtered by `status='approved'` and role visibility. A second count over the classification-excluded set feeds the "withheld" notice.

---

## 6. Knowledge risk: taxonomy, coverage and risk math

**Topics (28 rows):** 7 processes (thin-wall & low-rigidity parts; quoting & estimating judgment; 5-axis setups & workholding; tight tolerance & thermal control; first article (AS9102) & CMM inspection; heat treat, finishing & outside processing; CAM programming & toolpath strategy), 8 machines, 7 materials, 6 customers. **Holders:** the 8 people. Trainee training progress is a separate "knowledge transfer" metric; it never makes a trainee a holder.

**Inputs:** `E(p,t)` = SME-seeded tacit level 0–3 (0 none · 1 working · 2 independent, can teach basics · 3 deep, the go-to person); approved cards credited to `p` and tagged with `t`. Only **approved** cards count; drafts show as a hatched "pending" increment.

```
w(c)        = TYPE_WEIGHT[type] × CONF_WEIGHT[confidence]      (quoting_rule, failure_story 1.0; others 0.8 ·
                                                                 always/usually 1.0, sometimes/not_stated 0.75, not_sure 0.5)
C(p,t)      = Σ w(c) over approved cards by p tagged t           f(p,t) = E=0 ? 0 : min(1, C / (K·E)),  K = 4
m(p)        = months DEMO_TODAY → planned departure              U(p) = no date ? 0.25 : clamp(1 − (m−12)/48, 0.25, 1)
y(p)        = years at Ridgeline                                  T(p) = 0.6 + 0.4·min(1, y/30)
B(p,t)      = best backup level among others                     D(p,t) = 1 − 0.6·min(1, B/E)
risk(p,t)   = round(100 × (E/3) × (1 − f) × U × T × D)            0–100; bands: high ≥ 50 · elevated 35–49 · watch 20–34 · low < 20
Coverage(t) = 100 × Σ_p min(E, C/K) / Σ_p E                        (expertise-weighted captured share)
SPOF(t)     = the p with E = 3, B ≤ 1, E/ΣE > 0.5 and f < 0.5
Person "deep coverage" = captured share over the topics where E(p,t) = 3  ← the "coverage score" demo step 5 points to
```

Constants live in `src/lib/coverage/params.ts`; the UI labels scores "estimate" and shows the inputs on click. It is a transparent heuristic, not a validated instrument.

**Seeded matrix highlights** (full 28×8 CSV in `seed-data/expertise-matrix.csv`): Ray is level 3 on titanium, thin-wall, quoting, Inconel 718 and Aerovance; titanium and thin-wall have **only level-1 backups**, so the SPOF rule flags exactly two cells — **Ray × Titanium and Ray × Thin-wall**. Every other level-3 cell has a level-2 backup. With retirement in 20 months (U = 0.83), no non-Ray cell can exceed 25.

**Worked example (targets for the golden test; recalibrated in Phase 1 against the final seed cards):**

| | Before step 2 | After Ray approves KC-091…094 |
|---|---|---|
| Ray × Titanium risk | **57 (High)** — E 3, f 15% | **41 (Elevated)** — f 38% |
| Ray × Thin-wall risk | **57 (High)** | **41 (Elevated)** |
| Titanium topic coverage | **14.0** | **28.0 (+14.0)** |
| Thin-wall topic coverage | **13.0** | **27.0 (+14.0)** |
| Ray deep coverage | **18.2 %** | **32.2 % (+14.0)** |
| Ray's top risk | Ti / thin-wall (57) | Inconel 718 (46) → "Suggested next interview" |

Golden tests assert these numbers, the SPOF set before and after, and that pending cards never change coverage. If an SME edit to the seed breaks them, `seed:check` reports a **demo invariant** error naming the cell.

---

## 7. Seed data

### 7.1 Folder (one place for all domain content)

```
seed-data/
  README.md                    how to edit, ID rules, "run npm run seed:check", field glossary
  shop.yaml                    shop profile, DEMO_TODAY 2026-09-15, SEED, fictional notice
  people.yaml  personas.yaml  machines.yaml (+ machine events)  materials.yaml
  customers.yaml               6 customers, each with quirks + role-hidden `account:` block
  expertise-matrix.csv         28 topics × 8 people, levels 0–3 (opens in Excel; BOM and ';' tolerated)
  taxonomy/                    topics.yaml, tags.yaml, search-synonyms.yaml
  parts/                       anchors.yaml (12 demo parts), internal.yaml (4), families.yaml (generator templates → 44)
  quotes/                      anchors.yaml (14 quotes + anchor jobs, pricing, debriefs), internal-work-orders.yaml, quote-model.yaml (generator knobs)
  cards/                       90 cards, one YAML file per contributor (PER-01-ray-delgado.yaml …)
  interviews/                  8 transcripts, Markdown + frontmatter, ~30–45 turns each (## T001 expert …)
  quote-logs/                  3 short Quote Reasoning Logs
  documents/setup-sheets/      25 setup sheets, Markdown + frontmatter
  training/                    quizzes.yaml, attempts.yaml (seeded progress for the new hires)
  audit/history.yaml           ~20 historical audit rows (tokenized; includes withheld and blocked examples)
  demo/                        anchors.yaml (manifest + invariants), ray-live-interview.yaml (scripted answers + expected cards)
  demo-cache/                  replay cassettes (tokenized YAML), see §11.4
```

`.gitattributes` forces LF for `seed-data/**`, and the loader normalizes CRLF→LF and Unicode NFC (e.g. "Tomás"); otherwise a Windows checkout would shift evidence offsets and change hashes.

### 7.2 The fictional cast (*ASSUMPTION — names to be collision-checked before external use*)

| ID | Name | Role (app_role) | Hired (tenure at DEMO_TODAY) | Planned departure |
|---|---|---|---|---|
| PER-01 | **Ray Delgado** | Lead Quoter / Estimator (quoter) — ran the first 5-axis for 12 years before moving to quoting | 1995-06 (31.3 y) | **retirement 2028-05-15 (20 months)** |
| PER-02 | Marv Tollefson | 5-Axis Lead (machinist) | 2000-08 (26.1 y) | — |
| PER-03 | Linda Marchetti | Quality Manager (machinist) — owns AS9102 and the CMM | 2004-03 (22.5 y) | retirement 2029-11 (38 mo) |
| PER-04 | Tomás Ibarra | Lathe Lead (machinist) — Swiss, mill-turn, Inconel rings | 1999-01 (27.7 y) | retirement 2031-01 (52 mo) |
| PER-05 | **Maya Chen** | Quoter (quoter) | 2026-01-12 (8 months) | — |
| PER-06 | Devin Okafor | Setup Machinist (trainee) | 2026-03 (6 mo) | — |
| PER-07 | Priya Raman | CMM Inspector (trainee) | 2025-10 (11 mo) | — |
| PER-08 | Jonah Pruitt | CAM Programmer (machinist) | 2025-07 (14 mo) | — |
| P-OWNER | Dana Whitcomb | Owner / GM (owner) — persona only, not a knowledge holder | — | — |

**Customers** (part-number patterns feed the redactor and validator):

| ID | Name | Industry | Parts / quotes | Part floor | Notes |
|---|---|---|---|---|---|
| CUS-01 | **Aerovance** | aerospace — aerostructure brackets and fittings | 14 / 32 | customer_confidential | `AV-####-##`; quirks around first article on new revisions and rework approval |
| CUS-02 | Halvorsen Flight Controls | aerospace — actuation housings | 9 / 20 | customer_confidential | |
| CUS-03 | Lumacor Surgical | medical — 316L instruments, PEEK | 8 / 16 | customer_confidential | |
| CUS-04 | Quantrel Semiconductor Equipment | semiconductor — 6061 chamber parts, PEEK insulators | 9 / 20 | customer_confidential | |
| CUS-05 | Graymoor Defense Systems | defense — 17-4 manifolds, 7075 housings | 9 / 20 | **export_controlled** | |
| CUS-06 | Stellan Guidance Systems | defense & space — Ti and In718 housings; new customer (Nov 2025) | 7 / 12 | **export_controlled** | |

**Machines** (*ASSUMPTION for the unnamed models*): Haas VF-4 (`m-vf4`, bought used 2011), Haas ST-20, DMG MORI DMU 50, Okuma GENOS M560-V, Mazak INTEGREX i-200, **Citizen Cincom L20** (Swiss), **ZEISS CONTURA** (bridge CMM), **Mitsubishi Electric MV2400R** (wire EDM). Two `machine_quirk` cards per machine, always written as *this unit's* history (asset tag, dates, what we saw, what we do) — never a manufacturer or model-wide claim; `seed:check` lints for defect/recall language.

**Materials:** 6061-T6, 7075-T651, 17-4 PH, 316/316L, Ti-6Al-4V (Grade 5), Inconel 718, PEEK — with aliases for search.

### 7.3 Counts and mix

| Records | Count | Classification mix (general / internal / cust. conf. / export ctrl.) |
|---|---|---|
| Parts | 60 (12 anchor + 44 generated + 4 internal) | 0 / 4 / 41 / **15** |
| Quotes | 120 (won 70, lost 42, no-bid 5, pending 3) | 0 / 0 / 90 / **30** (Graymoor 18, Stellan 12) |
| Jobs | 74 (66 complete with actuals, 4 in process, 4 internal) | 0 / 4 / 52 / **18** |
| Knowledge cards | 90 (quoting_rule 18, setup_tip 20, machine_quirk 16, customer_quirk 14, inspection_gotcha 12, failure_story 10; approved 80, pending_review 6, draft 2, rejected 2) | 14 / 38 / 26 / **12** |
| Setup sheets | 25 (approved 20, expert_review 3, draft 2) | 0 / 10 / 10 / **5** |
| Interview transcripts | 8 (Ray ×2, Marv ×2, Linda ×2, Tomás ×2; ~32 cards carry real evidence spans) | 0 / 3 / 3 / **2** |

Ray deliberately has **no** titanium or thin-wall interview yet — his Ti cards come from "the binder" (hand-entered). That's what makes the live interview meaningful.

### 7.4 Quoted-vs-actual variance (clusters where judgment matters)
Each won job: `v = μ + σ·z` with `μ = base + Σ driver means`, drivers = thin_wall, titanium, inconel, five_axis, tight_tolerance, new_customer, first_article; jobs **quoted by Ray** get `μ × 0.35`, `σ × 0.6` (he prices the judgment in). Clamp to [−25 %, +90 %]; round actuals to 0.5 h. Expected: routine jobs ≈ ±5 %; thin-wall Ti not quoted by Ray ≈ +20 %; the same work quoted by Ray ≈ +7 %. `seed:check` prints the table and **fails if judgment-heavy non-Ray variance is under 2.5× the routine mean.** Generator knobs (setup hours by machine kind, cycle minutes by family, material time factors, shop rates, win odds) live in `seed-data/quotes/quote-model.yaml` as SME-reviewable starting points.

### 7.5 Determinism and validation
- **Clock:** `DEMO_TODAY = 2026-09-15T12:00:00Z` from `shop.yaml`; every seeded date is relative to it and all tenure/retirement/risk math uses `getDemoToday()`, never the wall clock. Runtime records (audit rows, approvals) use real time; the header shows "Demo date: Sep 15, 2026".
- **PRNG:** mulberry32 with a **per-record sub-seed** `fnv1a32("${SEED}|${recordId}|${stream}")`, so editing one record never reshuffles others. Display uses `en-US` + `timeZone: 'UTC'`; canonical JSON for hashes.
- **`npm run seed:check`** (safe while the server runs; touches no DB): zod schema per file with `file:line` errors in plain English; cross-file checks (unique IDs, FKs resolve, part numbers match the customer pattern, evidence quotes are exact substrings of an expert turn, every threshold's verbatim and every number in a statement appear in the evidence, ≤ 3 topics per card, classification ≥ derived floor, reserved IDs absent, anchors present with pinned values, golden coverage invariants, similar-jobs invariant, variance clustering); warnings for count drift, machine-quirk wording, numeric speeds/feeds in setup sheets. On success it writes `data/seed-bundle.json` — the last *valid* bundle, which the Reset button replays, so a half-edited YAML file can't break a reset in front of a prospect.

### 7.6 Demo-critical anchors (pinned in `seed-data/demo/anchors.yaml`)

| ID | What | Used in step |
|---|---|---|
| PER-01 Ray, PER-05 Maya, CUS-01 Aerovance | cast | all |
| PRT-A01 / **Q-A01** | Aerovance `AV-2231-07` rev C "Bracket, fuel line support", Ti-6Al-4V, min wall 0.040 in, 5-axis, first article. **The recent quote Ray is interviewed about:** qty 24, quoted by Ray 2026-09-11, 58.0 h, pending, DMU 50 | 2, 4 |
| **J-A02** | Similar job 1 — Aerovance Ti sensor-mount bracket, Ray: quoted 32.0 h, actual 33.5 h (+4.7 %) | 3 |
| **J-A03** | Similar job 2, **the job that went sideways** — Aerovance Ti duct-support bracket quoted by **Maya during Ray's April leave**: 27.0 h → 41.5 h (+53.7 %), 4 scrapped (walls moved after unclamping), 1 NCR | 2 (Ray's critical incident), 3 |
| **J-A04** | Similar job 3 — Aerovance Ti harness-clip bracket, Ray: 44.0 h → 42.5 h (−3.4 %) | 3 |
| J-A06 | Stellan Ti thin-wall housing, `itar`, **export_controlled** — matches Maya's question, so step 3 shows "1 similar job withheld" (a preview of step 6) and step 6b includes it | 3, 6 |
| **J-A10** | **The export-controlled job for step 6c** — Graymoor `GDS-4410-120` hydraulic manifold, 17-4 PH, `itar`: 96.0 h → 118.5 h (+23 %), linked to two export-controlled cards | 6 |
| J-A09 | Graymoor commercial spare, classification overridden **down** with a logged reason (Privacy page example) | 7 |
| KC-001…012 | Ray's existing cards (KC-001…003 on Ti/thin-wall/Aerovance approved; KC-011/012 pending review) | 1, 3 |
| **KC-091…094, INT-LIVE-RAY, DOC-SS-LIVE** | Reserved IDs created only by the scripted interview / setup sheet. Starting the scripted interview again deletes and recreates them (idempotent) | 2–5 |
| DOC-SS-05, QZ-02 | An approved DMU 50 setup sheet; a "Thin-wall basics" quiz with a seeded trainee attempt | 4, training |

Invariant: for PRT-A01's features with cloud-cleared classifications, the top-3 similar completed jobs are exactly {J-A02, J-A03, J-A04}; the generator's `reserved_combinations` keep other Aerovance thin-wall Ti brackets out of the data.

### 7.7 Reset (`npm run seed` and the in-app **Reset demo**)
One synchronous `IMMEDIATE` transaction shared by both: delete all rows child→parent, reset `sqlite_sequence`, reinsert the bundle parent→child in chunks (FTS refilled by triggers, then `rebuildFts()`), restore `app_settings` from env, write coverage baselines, write a `demo_reset` event, then `wal_checkpoint(TRUNCATE)`. WAL + 5 s busy timeout make it safe while `next dev`/`next start` holds the DB (research measured 5,000 rows in ~13 ms under 40 concurrent reads, with readers seeing all-old or all-new). `demo.epoch` increments so in-flight AI streams skip their final writes. Uploaded photos not in the bundle are removed after commit. **Never delete the `.db` file while a server runs** (Linux keeps writing the deleted copy; Windows refuses); `npm run db:nuke` requires the server stopped and says so.

---

## 8. Core modules

### 8.1 Knowledge Risk dashboard (`/risk`)
- Heat map: topics (rows, grouped by category) × the 8 holders (columns, sorted by risk contribution so Ray is first). **Cell fill = `risk(p,t)`** on a single-hue sequential ramp with the number printed; a view toggle switches the cell metric to **Expertise** (tacit level) or **Captured %**. Right-hand columns: topic Coverage (bar) and topic Risk band chip with a "Single point of failure" flag.
- Column headers: name, tenure, and a "⌛ Retires in 20 mo" chip (owner/quoter; others see the risk only).
- KPI row: topics at high risk, single points of failure, holders departing within 24 months, cards approved in the last 30 days.
- Click / Enter on a cell opens a sheet: the explanation ("Ray holds deep titanium knowledge · 2 approved cards · 15 % captured"), the inputs behind the score, approved cards, pending drafts count, **Interview Ray about Titanium**, **Open in Library**.
- Delta mode after changes vs the seeded baseline: changed cells get an orange ring and a `+14` chip, numbers count up (900 ms, `prefers-reduced-motion` respected), Before/Now toggle.

### 8.2 AI Interviewer and Quote Reasoning Log
**Architecture — code picks the move, the model only phrases it:**
1. After each expert turn, a **tracker** call (structured output) updates per-rule slots: condition, exception, rationale, cue, action, number, novice error, confidence; plus vague terms ("thin", "a lot"), judgment markers ("went sideways", "gut"), contradictions, sensitive mentions (feed redaction), expert signals (done / asks the AI for the answer / stop).
2. A deterministic TypeScript policy picks the next **move** (first match wins): guardrails (stop → wrap; "asks AI for the answer" → "I don't know your shop — what would you do?"; content above the provider's clearance → pause and re-route) → CLARIFY_NUMBER → ASK_WHY (ladder up) → ASK_CONDITION → ASK_EXCEPTION → ASK_HOW_TELL (ladder down) → SURFACE_CONFLICT (neutral) → PROBE_MARKER → next unused knowledge-audit probe (noticing, job smarts, anomalies, equipment difficulties, past & future, big picture, self-monitoring, improvising).
3. An **interviewer** call phrases that move as one open question (≤ 30 words, not yes/no, not double-barreled, no praise or technical agreement, reuses the expert's words, no presupposition). A **lexical-novelty check** rejects any question that introduces a technical term, cause, remedy or number not already in the transcript, the job record or the probe template; after two failures the template is used verbatim.

**Phases:** consent → scope → task map (ACTA) → incident (CDM sweep 1) → timeline (sweep 2) → deepen (sweep 3 + knowledge audit + laddering; ≤ 3 decision points) → what-if (sweep 4) → novice gap → **teach-back (mandatory before extraction)** → wrap → extract → expert review. Teach-back is the reversed AHRQ pattern: the AI states *"When {conditions}, {action}, because {rationale} — except when {exception}. Numbers: {thresholds}. What did I get wrong or leave out?"* and the expert corrects it. End conditions: phases done, budget (≈ 30 expert turns live), saturation (3 turns with nothing new), or the expert stops.

**Quote Reasoning Log** (~3 minutes after a quote is saved; ≤ 2 clarifiers total): main driver · why this machine · where the hours came from · what risk was priced in and where it went (hours / setup / scrap allowance / inspection / outside processing) · what would change the price · what a newer quoter would miss · confidence 1–5. When actuals land, a one-question variance review ("Actual came in at 41.5 h vs 27 h quoted — was it the risk you priced in?").

**Extraction and approval:** extractor output (zod schema → JSON schema) includes title, type, statement, applies_when, does_not_apply_when, rationale, cues, actions, common_mistake, thresholds (verbatim + normalized, e.g. "forty thou" → 0.040 in), expert_confidence, links, tags, evidence spans, open questions. **Server-side traceability gate** rejects (not warns) cards whose evidence isn't an exact substring of an *expert* turn, whose threshold verbatims or statement numbers don't appear in the evidence, or whose links aren't mentioned in the transcript. Cards are drafts until the **source expert** approves (owner may approve "on behalf" with a logged reason; the card shows it). Editing an approved card creates a new version back in review. Only approved cards feed Ask the Shop, Training and coverage.

### 8.3 Knowledge Library (`/library`)
FTS search with facets (type, machine, material, customer, contributor, status, classification). Card page: statement, applies/doesn't apply, thresholds (verbatim next to normalized), evidence quotes linked to the transcript turn, links to person / job / machine, **"Contributed by Ray Delgado"** credit, version history, status timeline. Drafts carry "Draft — awaiting {name}".

### 8.4 Ask the Shop (`/ask`)
Retrieval via FTS + tags + synonyms + entity boosts; budgeted context (8 cards + 3 jobs); answer streamed with inline citation chips `[Ray Delgado · KC-091]` (hover: card summary and approval date). **Similar past jobs** panel: top 3 completed jobs by feature/material/customer/family similarity with quoted vs actual bars and variance (local DB query; role-gated fields). Withheld/blocked notices, routing chip, history with Re-run, "Create setup sheet from these cards". Deterministic offline fallback when there's no model: "Most relevant approved cards" with citations, clearly labelled.

### 8.5 Document Generator (`/documents`)
Setup sheets, work instructions, onboarding checklists generated from selected approved cards (plus part/machine records). Every line cites its card(s); classification = max of sources. Status flow **draft → expert review → approved** (reviewer can send back); reviewer defaults to the cards' source expert. Deterministic "assembled from cards (no AI)" fallback. Print view: classification banner top and bottom, "DRAFT — NOT APPROVED FOR PRODUCTION" watermark until approved, numbered citation footnotes, approval block, fictional footer. Setup sheets reference CAM program numbers rather than stating speeds and feeds (*ASSUMPTION*: shrinks what must be domain-accurate).

### 8.6 Machine pages (`/machines/[id]`)
Mobile-first: quirks (this unit's), common setups (setup sheets + setup tips), recent issues (last 90 days of events and failure stories), captures, QR code. Sticky bottom capture bar — **Photo**, **Voice note**, **Note** — with 88 px buttons. Photos: `<input type=file accept="image/jpeg,image/png" capture="environment">` → client resize to 1600 px JPEG → route handler → server `sharp().rotate().resize().jpeg()` (strips EXIF/GPS) → `data/uploads/`, classification inherited, served through an authorized route (not `next/image`, whose cache would survive "full delete"), never sent to a model in v1. Voice notes use the speech policy. Captures go to the expert's review queue; they aren't cards until approved. Printable 4 × 2 in QR label per machine and an 8-up label sheet; QR encodes `${PUBLIC_BASE_URL}/machines/<id>`.

### 8.7 Training (`/training`)
Quizzes generated **only from approved cards**, filling a card's conditions with seed records: *apply* (all conditions hold), *boundary* (an exception holds → "rule doesn't apply"), *spot the cue*, *novice trap* (distractor = the card's common mistake), *rank* (ShadowBox-style). Rubric criteria derive from card fields and carry the card ID, evidence quote and contributor. Multiple-choice/rank items are graded by code (deterministic, cacheable); free-text grading (live mode) returns met / not met / **unclear** per criterion — "unclear" never counts against the trainee and goes to an "Ask Ray" queue. Mastery = correct on 2 distinct scenarios including a boundary item. Progress matrix (trainee × card) for owner/leads. Feedback quotes the card: "From Ray Delgado's card…".

### 8.8 Privacy & Deployment (`/privacy`)
Active mode explained in plain words; the classification × provider matrix rendered from `policy/matrix.ts`; the deployment options (Anthropic API, Bedrock commercial, Bedrock GovCloud allowlisted, local Ollama, hybrid) with a simple diagram; redaction explainer with its limitations; speech policy; vendor statements quoted verbatim with links and a "last reviewed" date; disclaimers; **Full export** (SQLite online backup + JSON dump + uploads, owner only, warns that it contains real names from the token table) and **Full delete** (typed confirmation; delete in place + `VACUUM` + purge uploads while the server keeps running; then offer Reset demo).

Copy rules: *"ShopMemory is designed to support shops that handle controlled information: you label records, a policy decides which AI provider may see them, and every AI call is logged. Using ShopMemory does not by itself make a shop ITAR, EAR, DFARS or CMMC compliant."* Never "ITAR compliant", "CMMC ready", "FedRAMP authorized", "guarantees", or "data never leaves" unless technically true in the current mode. Vendor quotes available (verified): Anthropic Public Sector FAQ — "ITAR data can only be processed in Claude via AWS Bedrock, which is IL5 accredited."; API retention page — "Retained data is never used for model training without your express permission."; Commercial Terms — "Anthropic may not train models on Customer Content from Services." No first-party retention number is stated (sources conflict); link to Anthropic's privacy center instead. Regulatory status (CMMC Phase 2 suspended 2026-07-13 pending review) goes only in a dated "Learn more" drawer.

---

## 9. Screens and routes

App shell (`src/app/(app)/layout.tsx`): non-dismissable fictional banner · header (logo, "Ridgeline Precision (fictional)", provider badge, persona switcher, presenter button) · sidebar (icon rail < 1200 px, bottom tab bar < 640 px) · toaster · presenter HUD (DEMO_MODE).

| Route | Purpose | Roles |
|---|---|---|
| `/` → `/risk` | Knowledge Risk heat map, KPIs, cell sheet, delta mode | all |
| `/people`, `/people/[id]` | Holders, tenure, departure, topics held, cards, deep coverage | all |
| `/jobs`, `/jobs/[id]` | Quotes and jobs, quoted vs actual, variance, win/loss, reasoning log, "Ask the Shop about this job" (pins the job) | all; prices owner/quoter |
| `/machines`, `/machines/[id]`, `/machines/[id]/print`, `/machines/labels` | Machine pages, capture, QR labels | all; capture machinist+ |
| `/library`, `/library/[cardId]` | Knowledge Library | all |
| `/interview`, `/interview/new`, `/interview/[id]`, `/interview/[id]/review` | Interviews, Quote Reasoning Log, consent gate, method tracker, review & approve | owner, quoter, machinist; review = source expert |
| `/review` | "My reviews" inbox (cards, documents, captures) | all |
| `/ask` | Ask the Shop | all |
| `/documents`, `/documents/new`, `/documents/[id]`, `/documents/[id]/print` | Document Generator | generate: owner/quoter/machinist |
| `/training`, `/training/[quizId]`, `/training/progress` | Quizzes and progress | all; progress matrix owner |
| `/audit` | Audit log viewer + export | owner all; others own rows |
| `/privacy` | Privacy & Deployment | view all; export/delete owner |
| `/settings` | AI mode, provider details (no secrets), Ollama health / warm, Bedrock allowlist status, `PUBLIC_BASE_URL` | owner (any persona in DEMO_MODE) |
| `/demo` | Presenter page: script, preflight, Reset, shortcuts, cassette log | DEMO_MODE |

Route handlers: `POST /api/ai/[task]`, `POST /api/ai/preview`, `GET /api/health`, `POST /api/health/warm`, `GET /api/audit/export`, `GET /api/export`, `POST /api/uploads`, `GET /api/uploads/[id]`. Server Actions: `setPersona`, `setAiMode`, `resetDemo`, `prepareDemoStep`, `recordConsent`, `approveCards`, `requestCardChanges`, `sendDocumentForReview`, `approveDocument`, `fullDelete`.

---

## 10. UI and theme

**Tokens** (Tailwind v4 `:root` + `@theme inline`; light theme only; contrast computed with the WCAG formula):

| Token | Value | Use / contrast |
|---|---|---|
| paper (background) | `#FAFAF7` | ink on paper 17.0:1 |
| ink (foreground) | `#16181C` | body text (aim ≥ 7:1 for shop glare) |
| primary (blue) | `#1D4ED8` | buttons (white on primary 6.7:1), links (6.4:1), focus ring |
| signal (orange) | `#F26B1D` | **fills only, with ink text** (5.8:1). White on signal fails (3.05:1) — never used |
| signal-strong | `#B4480E` | orange strokes, icons, text on paper (5.2:1) |
| muted text | `#4B5260` | secondary text (7.5:1) |
| input border | `#868B94` | form controls ≥ 3:1 (WCAG 1.4.11) |
| classification | general `#EEEDE7`/ink · internal `#E4ECFB`/`#1E3A8A` · cust. conf. `#EFE6FA`/`#5B21B6` · export ctrl. `#B42318`/white | badges with icon + word + shape cue, **never color-only**; export-controlled records get a full-width banner |

- Heat ramp: single-hue sequential, monotonic lightness (colorblind-safe), numbers printed; validated with the dataviz skill's checker in Phase 2.
- Typography: Geist (local font files), weights 400/500/600, `tabular-nums` on all numbers; 16 px body (18 px on coarse pointers), nothing under 14 px on screen.
- Tap targets: 44 px default, 48 px on coarse pointers, **64 px** machine-page actions, **88–96 px** photo/voice/stop; ≥ 12–16 px gaps; no hover-only, long-press-only or swipe-only actions.
- Layout works at 1280×720 CSS px (projector / Windows 150 % scaling), 820 px (tablet) and 390 px (phone) with no horizontal page scroll; the heat map scrolls inside its card.
- Print: global `@page { margin: .5in }`; label route `@page { size: 4in 2in }` (verified to produce a 288×144 pt PDF page in Chromium); `print:hidden` app chrome.
- States: skeletons, streaming caret with Stop, empty states that explain the next action, AI errors that never show payload text.

---

## 11. Demo mode and the scripted path

### 11.1 Replay design (`DEMO_MODE=true`)
- `ReplayTransport` receives the identical `ProviderRequest` + target descriptor that a live adapter would; everything before and after it is the same code.
- **Lookup order:** (1) exact `(task, targetKind, payloadHash)`; (2) scenario match — interview tasks by `(scenario, turnIndex, task)`, ask/doc tasks by scenario + normalized-question Jaccard ≥ 0.6 (case, whitespace, punctuation, synonyms normalized), with cited `S#` keys remapped via content fingerprints; (3) Bedrock may use an Anthropic entry (labelled "recorded on Anthropic API"), but **cloud and local entries never stand in for each other**; (4) miss → deterministic offline fallback (Ask: top approved cards with citations; interviewer: probe-bank template; extraction: none, offer manual entry; documents: assembled from cards), labelled on screen and audited as `demo_fallback`. `DEMO_MISS=live` calls the provider instead if credentials exist.
- **Cassettes are stored tokenized** (no cassette file contains a seed name). Cloud replays stream the tokenized text so restoration is exercised; local replays are de-tokenized inside the transport to emulate what a live Ollama returns (live local calls aren't redacted).
- Simulated streaming (cloud ≈ 700 ms TTFT; local slower, from recorded timings), scaled by `DEMO_REPLAY_SPEED`.
- **Honesty:** the header shows `REPLAY`, audit rows record the transport, and the Ollama badge reads "(not contacted: replay)" unless `DEMO_LIVE_LOCAL=true`.
- `npm run demo:record -- --step 3 --target anthropic|ollama` drives the scripted step through `runAI()` with a live transport and writes/diffs the cassette (hand-authored cassettes are allowed until you confirm API access). `npm run demo:verify` replays the whole script with no keys and dead provider URLs and asserts every scripted step resolves `demo_replay_exact`, so any prompt/seed/tokenizer change that silently degrades the demo fails CI.

### 11.2 The six steps

**Pre-demo:** `npm run demo` (seed → build → start) or **Reset demo**; `/demo` preflight all green; Chrome desktop at `http://localhost:3000`; persona Owner; mode per Q2 (default Cloud); DEMO_MODE on.

**Step 1 — Risk Map (~1.5 min · Owner · Cloud).** `/risk` opens with Ray's column first: "Ray Delgado · 31 yrs · ⌛ Retires in 20 mo". Titanium and Thin-wall rows show **High** and a single-point-of-failure flag; KPI tile: "2 topics depend on one person retiring within 24 months". Click *Titanium × Ray* (57): the sheet explains why and offers **Interview Ray about Titanium**. No AI call.

**Step 2 — Live interview with Ray (~4 min · persona switches to Ray · Cloud).** From the sheet → "This interview is with Ray Delgado. Switch persona?" → consent gate (engine-specific copy) → session `INT-LIVE-RAY` anchored on **Q-A01**. The presenter clicks suggested-reply chips (or presses `n`; optional **Simulated dictation** shows the voice path). The side **Method tracker** fills with Ray's own words — the visual proof that the AI supplies the method and Ray supplies the facts. *Content below is placeholder wording for SME review.*

| Turn | Speaker | Text (abridged) | Move |
|---|---|---|---|
| T0 | AI (template from the quote record) | "Thanks, Ray. You quoted the AV-2231-07 fuel line bracket for Aerovance on Sept 11 at 58 hours for 24 pieces. In one sentence, what drove that number the most?" | anchor (Quote Log Q1) |
| R1 | Ray | "The walls. Anything under forty thou in titanium moves on you, so I padded the finish passes, split it into two ops, and priced in a spare blank." | |
| **F1** | AI (phrased, novelty-checked) | "You said thin titanium 'moves on you.' Walk me through the last job where that actually happened." | **critical incident** |
| R2 | Ray | "The duct support bracket in April, while I was out. One clamping, rough and finish. When they unclamped, the walls sprang about four thou and four of the twelve failed profile on the CMM. Aerovance won't take rework without their MRB signing off, so we scrapped them. Now I rough, leave twenty thou, unclamp and let it sit, then finish in soft jaws with light passes." | |
| **F2** | AI (phrased) | "When a newer quoter picks up a bracket like this, what are they most likely to get wrong?" | **novice gap** |
| R3 | Ray | "They take the cycle time the software gives them and stop there. On thin Ti the finish passes run a lot slower, so I add thirty-five percent to finishing. And Aerovance wants a full first article on every new revision — about three more hours of CMM time and paperwork." | |
| **F3** | AI (template filled from tracker slots) | "Let me say it back as a rule: when a titanium wall is under forty thou, add thirty-five percent to finishing, rough and finish in separate ops leaving twenty thou, and price a spare blank — because the walls spring after unclamping. What did I get wrong or leave out?" | **teach-back** |
| R4 | Ray | "Close. Under forty thou *and* taller than about ten times the wall — a short thin wall is fine. Same on Inconel 718. On 6061 I don't bother. That one's always." | |
| T5 | AI (template) | "Got it — I've added the height limit, Inconel 718 and the 6061 exception. I'll draft cards for you to review." | wrap |

**Draft cards** (≈ 2 s) → four cards, each passing the traceability gate: **KC-091** quoting_rule "Thin-wall Ti / Inconel: add 35 % to finishing, two ops, spare blank" · **KC-092** setup_tip "Rough, leave 0.020 in, unclamp and rest, finish in soft jaws" · **KC-093** customer_quirk "Aerovance: full first article on every new revision; no rework without their MRB" · **KC-094** failure_story "J-A03 duct bracket: walls sprang 0.004 in after unclamping; 4 of 12 scrapped". Ray clicks **Approve all 4** (*ASSUMPTION: approval happens here, while Ray is the active persona* — otherwise steps 3 and 5 can't use them). Toast: "4 cards approved — credited to Ray Delgado". AI calls: tracker ×4, phrasing ×2, extraction ×1 = 7 audited calls.

**Step 3 — Maya asks the shop (~2 min · Maya · Cloud).** Persona → **Maya Chen · Quoter · 8 months** → Ask the Shop → *"How do we quote thin-wall Ti brackets for Aerovance?"* (optionally open **What will be sent**: `[[CUSTOMER_01]]`, `[[PERSON_01]]` highlighted; destination Anthropic API). The answer streams with citations to KC-091…094 and Ray's older cards; **Similar past jobs** shows exactly J-A02, J-A03, J-A04 with quoted vs actual; a notice reads "1 related job withheld — export-controlled; Anthropic API (cloud) isn't cleared for it. [Why?] [Try Local]".

**Step 4 — Setup sheet routed to Ray (~1.5 min · Maya).** "Create setup sheet from these cards" → `DOC-SS-LIVE` for PRT-A01 on the DMU 50 streams section by section with citation chips; badge **CUSTOMER CONFIDENTIAL** (inherited); **Send for expert review** → Ray. Stepper: Draft ✓ → **Expert review · waiting on Ray Delgado** → Approved. Optional 4b: switch to Ray → `/review` → Approve → the print preview's DRAFT watermark disappears.

**Step 5 — Risk Map moved (~1 min).** `/risk` opens in delta mode: Ray × Titanium 57 → **41**, High → Elevated; Titanium coverage 14 → **28**; Ray's deep coverage 18 % → **32 %** with `+14` chips; the "Suggested next interview" moves to Inconel 718. No AI call.

**Step 6 — Privacy moment (~3 min · Maya).**
- **6a Audit:** `/audit` → the Ask row: "Ask the Shop · Maya Chen · Anthropic API · claude-sonnet-5-5 · customer_confidential · 1 withheld · REPLAY". The detail shows the exact redacted payload — no "Aerovance", "Ray Delgado" or "AV-2231-07" anywhere — plus records sent/withheld and why. Show **Export CSV**.
- **6b Local:** badge → **Local** ("Ollama qwen3.5:4b on this computer") → Ask history → **Re-run**. The answer is plainer; **J-A06 is now included**, no withheld notice; preview says "this computer · redaction not needed"; new audit row "Ollama · sent unredacted (local) · stored redacted".
- **6c Blocked:** badge → **Cloud** → open job **J-A10** (EXPORT CONTROLLED banner) → **Ask the Shop about this job** (or type a question naming Graymoor or the part number). **Nothing streams**: "Not sent. This question refers to a job labeled EXPORT CONTROLLED… Nothing was sent to Anthropic." The audit shows a blocked row with nothing sent and no transport call. Optional: **Re-run in Local**; optional 6d: Hybrid auto-routes it local.

### 11.3 Presenter page, reset, idempotency
- `/demo`: six step cards (Go → prepares persona/mode and navigates; talking points; expected result; fallback line), preflight with Re-run, Reset demo (shows elapsed ms; target < 2 s, expected ~100 ms), cassette log (hit / positional / miss / blocked), shortcuts. Optional dual-screen control via `BroadcastChannel`.
- **Every step is idempotent and can run out of order:** step 2 "restart" deletes `INT-LIVE-RAY`, KC-091…094 and DOC-SS-LIVE; steps 3–5 fast-forward the canonical interview if it hasn't run (writes a non-AI `demo_fast_forward` event — never fake AI rows); step 6 replays step 3 through the gateway if no Ask row exists yet.
- Shortcuts (presenter mode only, ignored in inputs): `g 1…6` go to step, `g d` demo page, `n` next suggested reply/question, `p` persona, `m` mode, `h` HUD, `Shift+R` reset, `PageDown` next action (clicker), `?` help.
- Preflight checks: native module + FTS5, migrations, seed hash vs lock, anchors present, cassettes valid and hitting, traceability of scripted cards, DEMO_MODE, providers (live only), Ollama warm (warning in replay), on-device speech available + mic permission (**Test mic** before the audience is watching), Chrome ≥ 139, viewport ≥ 1280, no external requests since load, uploads dir.

### 11.4 Cassette inventory (10 required)

| Cassette | Step | Task | Target |
|---|---|---|---|
| `step2.track.1` … `.4` | 2 | interview_track | cloud |
| `step2.phrase.F1`, `step2.phrase.F2` | 2 | interview_phrase | cloud |
| `step2.extract` | 2 | card_extract | cloud |
| `step3.ask.cloud` | 3 | ask_shop | cloud |
| `step3.ask.local` | 6b | ask_shop | local |
| `step4.doc.cloud` | 4 | doc_generate | cloud |

Optional: `step6c.ask.local`, `smoke.cloud`, `smoke.local`, training generation/grading. The step-6c cloud question needs **no** cassette: it is blocked before the transport, and a test asserts the replay lookup is never called.

---

## 12. Testing and quality gates

**Vitest** (node environment): policy matrix (table-driven over every classification × target incl. unlisted GovCloud host, `baseURL` override, Ollama `remote_host`, non-loopback host; snapshot shared with the Privacy page); entity detection (the step-6c question → export_controlled → blocked; step-3 question → customer_confidential); redaction round-trip + stream restorer fuzzed at every split; coverage golden numbers; seed determinism (reset into `:memory:` twice → canonical dump hash = `seed-data/seed.lock.json`; counts match the brief; CRLF normalized); FTS sanitizer (demo question, `Ti-6Al-4V`, quotes, `*`, `NEAR`, empty string); cassettes (parse, hit, no seed names, extracted cards pass the gate, citations ⊆ sent); interview policy (scripted moves are exactly incident → novice gap → teach-back; teach-back introduces no new terms); gateway parity (each scripted step with a stub live transport vs replay → identical decision, payload hash and audit rows except `transport`); role projection; secret hygiene; architecture test; date formatting (fixed locale/UTC).

**Playwright** (1.63, Chromium, against `next build && next start` on port 3100 with a separate `data/e2e.db`, timezone deliberately non-UTC): `demo-path` (steps 1–6 serially with concrete assertions, e.g. exactly 3 follow-ups, 4 cards of the right types, exactly J-A02/A03/A04 in similar jobs, "1 withheld", audit payload matches `\[\[CUSTOMER_\d+\]\]` and contains no seed names, blocked row in 6c); `demo-idempotency` (step 3 straight after reset, step 2 restart, step 6 twice, reverse order, reset < 2 s with hash = lock); `routes-smoke` (every route at 1280/820/390: 200, no console errors, no hydration warnings, no horizontal scroll); `print` (label PDF 288×144 pt; watermark before approval); `a11y` (axe: no serious/critical). **No-egress guard:** a Node preload (`--require e2e/no-egress.cjs`) blocks every non-loopback socket/DNS lookup and logs attempts (also flags any connection to port 11434 in replay), and the browser fixture aborts any non-local request; `afterAll` asserts both counts are zero.

**Gates:** `npm run check` = eslint + `tsc --noEmit` + vitest. `npm run demo:check` = environment → check → `next build` (**fails if any DB-backed route is static `○`**) → Playwright suite → reset + preflight summary (target < 6 min). Proposed CI: GitHub Actions matrix `ubuntu-latest` × `windows-latest` on Node 24 running `demo:check` (*ASSUMPTION*; otherwise run it once on the demo machine).

---

## 13. Phase breakdown

Order: 1 → 2 → 3 → {4, 5, 6} → 7 → 8. Each phase ends with a commit, a push to the working branch, an entry in the [Progress log](#19-progress-log), and a summary to you of what changed and how to test it. Each AI phase ships its own cassettes and E2E spec, so Phase 8 joins finished pieces rather than doing a big-bang integration.

**Two deliberate deviations from the brief's phase list (*ASSUMPTION*):** (1) the **redaction core moves to Phase 3** alongside the gateway, because Phase 4 makes the first cloud calls and the brief says "before any cloud call"; Phase 7 still adds the "What will be sent" panel. (2) A **minimal persona cookie and pricing gate land in Phase 2**, because read-only screens already show prices; Phase 7 completes the full role matrix.

### Phase 1 — Schema + seed data
- **Scope:** scaffold (create-next-app 16.3.6 in a temp folder, then copy in — it refuses a folder that already contains PLAN.md/CLAUDE.md; keep `@AGENTS.md` on line 1 of the merged CLAUDE.md); exact dependency pins; `.gitattributes`, `.gitignore` (`!.env.example`, `data/*`), `.env.example`; `src/lib/env.ts`, `log.ts`, `time.ts`; Drizzle schema, migrations, custom FTS5 migration + triggers; `src/db/classification.ts`; the full `seed-data/` folder (all 90 cards, 8 transcripts, 25 setup sheets, parts/quotes generator with anchors, expertise matrix, taxonomy, demo anchors, Ray's scripted answers); loader + zod schemas + `seed:check`; deterministic reset; `seed.lock.json`; coverage `compute.ts`; FTS query sanitizer; Vitest harness.
- **Exit criteria:** row counts match the brief; `npm run seed` < 3 s and identical hash twice; Ray is the only SPOF (Ti, thin-wall) and the golden before/after numbers hold using the scripted cards; all anchors exist; similar-jobs invariant and variance clustering pass; FTS sanitizer tests pass; `tests/architecture.test.ts` skeleton in place.
- **How to test:** `npm ci && npm run seed && npm test`; open `seed-data/` in an editor, break a card on purpose, run `npm run seed:check` and read the error.

### Phase 2 — Read-only screens
- **Scope:** app shell, tokens, local fonts, fictional banner; header provider badge (reads config only); persona cookie + pricing gate; `/risk` (heat map, metric toggle, cell sheet, baseline), `/library` + card page, `/people` + profile, `/machines` + machine page (read-only) + print label + label sheet, `/jobs` + job page; classification badges; shadcn components.
- **Exit criteria:** `next build` shows `ƒ` (dynamic) for every DB route; no hydration warnings; axe clean (no serious); no horizontal scroll at 1280/820/390; label PDF is 4×2 in.
- **How to test:** `npm run build && npm start`, click through; switch persona to Marv (machinist) and see "Hidden for Machinist role" on price columns; `npx playwright test routes-smoke print`.

### Phase 3 — Provider abstraction, classification, routing policy, audit log
- **Scope:** `runAI()` gateway and pipeline; Anthropic, Bedrock and Ollama adapters; `policy/*` incl. entity detection and GovCloud allowlist checks; **redaction core** + stream restorer; `ReplayTransport` + smoke cassettes; `ai_audit_log` / `event_log`, `/audit` (filters, detail, export); `/settings` mode switch; `/api/health`, `/api/health/warm`, `/api/ai/preview` (dry run, UI in Phase 7); lint rules + architecture, secret-hygiene and no-egress tests. Bedrock is tested against a stubbed transport (or live if you have access).
- **Exit criteria:** policy, redaction, parity and no-leak tests pass; `/settings` → **Send test prompt** produces a tokenized `REPLAY` audit row in DEMO_MODE and a live row when a key is present; the header badge tracks the mode; Local mode with Ollama stopped shows "Unreachable" and fails cleanly (no cloud fallback).
- **How to test:** as above with and without `ANTHROPIC_API_KEY`; with Ollama running, set Local mode and send the test prompt; open the audit row.

### Phase 4 — Ask the Shop
- **Scope:** retriever (FTS + tags + synonyms + entity boosts, budgeted context), similar-jobs scorer, answer prompt with `[S#]` citations validated against sent sources, streaming UI with citation chips, withheld/blocked notices, routing chip, history + Re-run, "Ask the Shop about this job", offline fallback; cassettes `step3.ask.cloud` / `step3.ask.local` (v1, seeded cards only); E2E for step 3 and the 6c blocked path.
- **Exit criteria:** the demo question returns exactly J-A02/A03/A04 and "1 withheld" in Cloud; J-A10 question blocked in Cloud with nothing sent; citations never reference unsent records; passes with no egress.
- **How to test:** in DEMO_MODE ask the demo question in Cloud, then Local; ask about J-A10 in Cloud; compare the three audit rows.

### Phase 5 — Interviewer + card extraction + approval flow
- **Scope:** state machine, probe bank, tracker, phrasing + novelty check + template fallback; consent gate; speech-engine resolver, speech chip, Simulated dictation; Quote Reasoning Log mode + variance review; extraction + traceability gate; review/approve/request-changes; `/interview/*`, `/review`; coverage recompute + delta; cassettes `step2.*`, **re-recorded `step3.*`** (now citing KC-091…094); `demo:record`.
- **Exit criteria:** the scripted session yields exactly 3 follow-ups and 4 gate-passing cards; approval moves coverage by the golden deltas; vendor-cloud speech is blocked for the customer-confidential session; live mode (with a key) follows the same move sequence.
- **How to test:** in DEMO_MODE run step 2 with chips, approve, open `/risk`; try the mic in Chrome (on-device vs blocked); run a Quote Reasoning Log on Q-A12.

### Phase 6 — Document generator + training
- **Scope:** `/documents/*` (generate from cards, citations, status stepper, send for review, approve, versioning, assembled fallback), print view with watermark/banners; training (quiz generation from approved cards, deterministic grading for choice/rank, live-only free-text grading with "unclear", progress matrix); machine-page capture (photo pipeline + voice notes → review queue); cassette `step4.doc.cloud` (+ optional training cassettes).
- **Exit criteria:** step 4 runs as scripted; print PDF shows the watermark until approval; a quiz generated from KC-091 grades correctly; an uploaded photo has no EXIF and is deleted by reset.
- **How to test:** DEMO_MODE step 4 → switch to Ray → approve → print preview; take QZ-02 as Devin; upload a photo on `/machines/m-dmu50` from a phone or desktop.

### Phase 7 — Redaction preview, roles, Privacy & Deployment page
- **Scope:** "What will be sent" panel on every AI entry point (suspects + "Redact this"); full role matrix and persona polish; `/privacy` (matrix from policy, deployment options, redaction and speech explainers, quoted vendor statements, disclaimers, full export, full delete); consent/speech/audit events surfaced; E2E for step 6.
- **Exit criteria:** preview payload is byte-identical to the audited payload (hash match); Privacy matrix snapshot equals the policy test snapshot; full delete leaves zero rows while the server runs and Reset recovers; role-projection test passes for every task.
- **How to test:** open the preview, send, compare with the audit detail; export → delete → reset.

### Phase 8 — Demo mode, scripted path, polish
- **Scope:** `/demo` presenter page, preflight, step prepares + fast-forward, HUD, shortcuts, dual screen; delta animation and loading/empty states; production CSP (`connect-src 'self'`); `demo-path` and `demo-idempotency` E2E; `demo:verify`, `demo:check`; CI matrix; `docs/DEMO-RUNBOOK.md` (day-before and hour-before checklists: update Chrome/Ollama the day before, pre-pull the model, install the on-device speech pack, `npm run demo`, test mic) and `docs/SME-REVIEW.md` (what an SME must review).
- **Exit criteria:** `npm run demo:check` green on Ubuntu and Windows; reset < 2 s; full path with zero egress; a timed 12–14 minute dry run done.
- **How to test:** `npm run demo:check`; disconnect the network and run the whole demo from `/demo` using only keyboard shortcuts.

---

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Native module install fails on Windows | better-sqlite3 **12.11.1** pinned (prebuilt download from GitHub, no compiler); same Node major for install and demo (`npm rebuild better-sqlite3` after switching); libsql fallback documented; `demo:check` on the Windows machine |
| Production build serves stale seeded data | `await connection()` in every DB read; `demo:check` fails on static DB routes; E2E runs against the production build |
| Hydration mismatches / clock drift | UTC + `en-US` formatting; no `Date.now()`/`Math.random()` in render or seed; fixed `DEMO_TODAY`; E2E in a non-UTC timezone |
| Web Speech fails (offline, permission, noise, 8 s no-speech timeout, cloud engine) | Simulated dictation and chips; on-device check + "Install on-device speech" + "Test mic" in preflight; typing always works |
| Ollama cold/slow (20–35 s on a CPU laptop) or reloads | Replay by default in DEMO_MODE; warm at boot and on mode switch with identical options; `think:false`; fixed `num_ctx`; `keep_alive 60m`; Ready/Warming badge |
| Cassette drift after prompt/seed edits | Exact-hash first, scenario second; `demo:verify` fails CI on any degradation; preflight cassette check |
| Presenter goes off-script | Normalized matching, chips and `n` key, labelled offline fallbacks, "Restore scripted replies" |
| Steps run out of order / repeated | Step prepares, fast-forward, fixed-ID upserts, ~100 ms reset |
| Small local model makes wrong JSON or invented citations | Small flat schemas, enums (incl. an enum of allowed source keys), zod + one retry, traceability gate, citation filter |
| Brand-new model and SDK (both released 2026-09-28) | Exact pins; DEMO_MODE never depends on them; record cassettes only after a smoke test |
| Overclaiming compliance in a sales setting | Copy rules in CLAUDE.md; "designed to support"; dated regulatory drawer; persistent fictional banner |
| Fictional names collide with real companies/people | Collision check before external demos; names live only in `seed-data/` |
| Domain content isn't machinist-plausible | SME review of `seed-data/` (incl. cassettes) before any customer demo; setup sheets avoid speeds/feeds; quirks written as unit history |
| Tablet on plain-HTTP LAN has no microphone | Voice moments on the laptop; optional tablet segment via mkcert + a travel router with a fixed IP; `PUBLIC_BASE_URL` for QR codes |
| Windows specifics (OneDrive folders, file locks, cmd.exe scripts, CRLF) | Repo outside OneDrive; reset inside the DB; scripts as `.mts`, no shell-specific npm scripts; LF enforced |
| Container limits for this build session | `ui.shadcn.com` and `cdn.playwright.dev` are blocked here: allowlist `ui.shadcn.com` or vendor component sources from GitHub; Playwright uses the preinstalled Chromium via `executablePath` |

---

## 15. Seams for out-of-scope items

| Out of scope | Seam |
|---|---|
| SSO / real auth | `IdentityProvider.getActor()` with `AUTH_MODE=demo` (cookie) today; an OIDC provider maps group claims to roles later. Nothing reads the cookie directly. Per-person `export_access` flag reserved for "US person" gating |
| Multi-tenant | `Actor.tenantId`; audit, event, token and settings tables carry `tenant_id` (default `ridgeline`); dictionary cache keyed by tenant |
| ERP / Paperless Parts | `ExternalRecordSource` importer interface that must assign a classification; unmapped imports default to **export_controlled** and "unreviewed" (fail closed); imported names feed the redaction dictionary |
| Vector search | `Retriever` interface (FTS5 today). Policy filtering happens after retrieval, so any retriever is safe. **Embedding calls are egress** and must go through `runAI()` as `task: 'embed'` under the same clearance rules |
| Local speech-to-text | `SttProvider.transcribe(wav16kMono)` (whisper.cpp server first; Ollama audio later). Audio held in memory only; `audio_received` / `audio_deleted` events audited — this is where "raw audio is deleted after transcription" becomes true |
| More providers (Vertex, etc.) | New adapter + `TargetClass` + matrix column; nothing else changes |
| Production deployment | Not built; the custom HTTPS server script is demo-only |

---

## 16. Assumptions to confirm

Grouped by how much they change the build. Reply with the numbers you disagree with; everything else proceeds as written.

**Changes behavior you'll see in the demo**
1. **Owner persona** "Dana Whitcomb (Owner/GM)" exists as a 9th persona but is not a knowledge holder on the heat map.
2. **Ray approves the four cards at the end of step 2** (only approved cards feed Ask the Shop, Training and coverage; drafts show as hatched "pending").
3. **Maya** (not a machinist) generates the setup sheet in step 4, and **any persona can switch AI mode or reset while `DEMO_MODE=true`** (owner-only otherwise).
4. **"Raw audio is deleted after transcription" is replaced** by engine-specific honest copy ("ShopMemory never receives or stores audio"); vendor-cloud speech is blocked for customer-confidential and export-controlled sessions and in Local mode; the scripted interview uses Simulated dictation or Chrome's on-device speech.
5. A visible **`REPLAY`** tag stays on in DEMO_MODE and audit rows record replays.
6. Step 3 shows a small **"1 related job withheld"** notice (foreshadowing step 6). Alternative: tweak J-A06 so step 3 is clean.
7. The scripted story: Ray's critical incident is **J-A03, a job Maya quoted during Ray's leave that ran +54 %**.

**Policy and privacy**
8. `customer_confidential` may go to cloud providers **with mandatory redaction** (switchable to deny).
9. export_controlled: local Ollama or GovCloud endpoints on an **exact-hostname allowlist** (default: the two FIPS runtime hosts); the adapter doesn't auto-switch to FIPS.
10. **Prices, margins and customer contacts are never sent to any model**; quoted/actual hours are visible to all roles.
11. Local (Ollama) audit rows store the payload **redacted for storage**, with render-time Reveal.
12. Job and quote numbers are tokenized along with customers, people and part numbers; the shop's own name is not.
13. Anthropic's beta server-side refusal fallback stays **off** (the model is pinned; the audit records the served model anyway).

**Data and content**
14. Proposed **fictional names** for the other 6 people, the owner, and 5 customers ([§7.2](#72-the-fictional-cast-assumption--names-to-be-collision-checked-before-external-use)) — and a name-collision check before external demos.
15. Machine models for the unnamed machines: **Citizen Cincom L20** (Swiss), **ZEISS CONTURA** (CMM), **Mitsubishi Electric MV2400R** (wire EDM), Mazak INTEGREX i-200, Okuma GENOS M560-V.
16. Customer mix: 2 aerospace, 1 medical, 1 semiconductor, 2 defense (defense parts/quotes/jobs are export_controlled by default).
17. `DEMO_TODAY` fixed at **2026-09-15**; the header shows the demo date.
18. Setup sheets cite **CAM program numbers** instead of speeds and feeds.
19. Coverage model constants (K = 4, weights, urgency curve) as a labelled **estimate**.
20. All seed content (and the interview script numbers such as 0.040 in, 35 %, 0.020 in, 10×) is placeholder wording drafted by Claude; **an SME reviews `seed-data/` before any customer demo.**

**Build and tooling**
21. `src/` layout; Node 24 LTS; better-sqlite3 **12.11.1** (needs github.com reachable during `npm install` on your machine).
22. Two phase-order deviations: redaction core in Phase 3, minimal persona/pricing gate in Phase 2.
23. Machine-page photo/voice capture is built in Phase 6.
24. **GitHub Actions** CI matrix (Ubuntu + Windows) running `demo:check` — OK to add a workflow file?
25. The demo runs in **Chrome desktop at `http://localhost`**; a tablet segment is optional (mkcert + travel router).
26. For this cloud build session: allowlist **`ui.shadcn.com`** in the environment's network settings so the shadcn CLI works (otherwise component sources are copied from the shadcn GitHub repo).

---

## 17. Questions before Phase 1

1. **Build/demo machine:** Windows or Ubuntu? How much RAM? GPU (model and VRAM, or none)? Is Ollama installed (version)? → I'll recommend the local model and give expected speed. Reference table for a typical Ask-the-Shop request (~1,500-token prompt, ~300-token answer, warm model, `think:false`; estimates ±50 %, to be measured on your hardware):

   | Hardware | Suggested model | Expected total time |
   |---|---|---|
   | CPU only, 16 GB (recent Ryzen 7 / Core Ultra 7) | `qwen3.5:4b` (3.4 GB) or `granite4.1:3b` (2.1 GB) | ~20–35 s / ~16–23 s |
   | 8 GB RAM, CPU only | `granite4.1:3b` or `llama3.2:3b` | ~20–30 s |
   | NVIDIA 4 GB (RTX 3050 laptop) | `qwen3.5:2b` / `granite4.1:3b` fully on GPU | ~5–7 s |
   | NVIDIA 8 GB (RTX 4060/4070 laptop) | `qwen3.5:9b` if 100 % on GPU (else `qwen3.5:4b`) | ~9–11 s (~5 s) |
   | NVIDIA 12–16 GB | `gemma4:12b` or stay on `qwen3.5:9b` | ~4–5 s |
   | Apple M-series (reference) | `qwen3.5:4b` / `qwen3.5:9b` | ~13–15 s |

   Add 2–10 s for a cold model load. AMD/Intel integrated GPUs are ignored by Ollama by default (CPU speed).
2. **Default mode** the demo opens in: cloud, local, or hybrid? (Recommendation: **cloud**, because step 6 switches to local for effect; hybrid is available as an optional 6d.)
3. **API access:** Do you have an Anthropic API key? An AWS account with Bedrock model access (commercial region, and/or GovCloud)? If not, the Bedrock adapter is built and tested against a stub, and cassettes are hand-authored until a key is available.
4. **Name:** keep "ShopMemory", or use a different name?
5. Plus the assumptions in [§16](#16-assumptions-to-confirm).

---

## 18. Sources

Verified during research on 2026-09-28 (some vendor pages were reachable only via their GitHub sources or search excerpts; those are marked in the research notes).

- Next.js 16.3 docs bundled in `next@16.3.6` (`node_modules/next/dist/docs/`), incl. the v16 upgrade guide and `connection()`.
- Tailwind CSS v4 docs (tailwindlabs/tailwindcss.com repo); shadcn/ui v4 docs and registry (shadcn-ui/ui repo).
- Anthropic: models overview, Sonnet 5.5 migration guide, structured outputs, Claude in Amazon Bedrock, API and data retention (platform.claude.com); Public Sector FAQ (support.claude.com); Commercial Terms (anthropic.com/legal/commercial-terms); `@anthropic-ai/sdk` 0.129.0 and `@anthropic-ai/bedrock-sdk` 0.34.0 source.
- AWS: aws-samples/anthropic-on-aws getting-started notebooks (Opus 5.5, Sonnet 5.5, Fable 5.1); Claude Code Bedrock docs (GovCloud `us-gov.` prefix); GovCloud ITAR and Bedrock pages (search excerpts — **confirm on your account**).
- Ollama v0.34.4 source and docs (github.com/ollama/ollama): API, structured outputs, thinking defaults, context length, cloud models, Windows/Linux install; llama.cpp and community benchmarks for the performance table.
- better-sqlite3 issues #1503/#1516, npm metadata and local install tests; drizzle-orm/drizzle-kit 0.45.3/0.31.11 package contents; libsql-js issues.
- Web Speech: MDN content and browser-compat-data, the Web Speech API spec and on-device explainer, Chromium and WebKit sources; WCAG 2.2 (2.5.5, 2.5.8, 1.4.3, 1.4.6, 1.4.11); Apple HIG; Android accessibility guidance.
- Methodology: Flanagan 1954 (CIT); Klein, Calderwood & MacGregor 1989 and Hoffman, Crandall & Shadbolt 1998 (CDM); Militello & Hutton 1998 (ACTA); Rugg & McGeorge 1995 (laddering); AHRQ Teach-Back (Tool 5); Loftus & Palmer 1974; Klein & Borders 2016 (ShadowBox).
- Regulatory background (for copy only, not legal advice): eCFR 22 CFR 120–130 (ITAR), 15 CFR 730–774 (EAR), 32 CFR 170 (CMMC), DFARS 252.204-7012, NARA CUI Registry, DoD CIO CMMC updates.

---

## 19. Progress log

| Phase | Date | Summary | How to test |
|---|---|---|---|
| 0 — Plan | 2026-09-28 | PLAN.md and CLAUDE.md written from six research tracks and three design drafts; waiting on questions in §17 | Read §11 (demo), §13 (phases), §16–17 (assumptions, questions) |
