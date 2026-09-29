# Floorwise — Build Plan

> **Status:** Phase 1 in progress. Questions in [§17](#17-questions-before-phase-1) answered on 2026-09-29 (see *Decisions*). Product name: **Floorwise** (the repository keeps the name ShopMemory).
>
> **What this is:** a scripted, reliable **sales demo** for CNC / precision machine shops. It captures the tacit know-how of senior people (quoting judgment, setups, machine quirks, customer requirements) and makes it usable by newer employees, with privacy and deployment flexibility that ITAR/CUI shops can see. **All data is fictional.**
>
> Every version number, model ID and vendor statement below was researched on **2026-09-28**, and the plan was then reviewed by five independent reviewers (brief coverage, consistency and arithmetic, demo reliability, privacy correctness, real-world name collisions). Anything marked *ASSUMPTION* is a decision you can overrule; they are collected in [§16](#16-assumptions-to-confirm).

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
- [Appendix A — Golden-test inputs](#appendix-a--golden-test-inputs)

---

## 1. Goals, non-goals, principles

**Goals**
- An ~11-minute scripted demo (six steps, plus ~2 minutes of slack; [§11](#11-demo-mode-and-the-scripted-path)) that works every time, with or without network or API keys.
- Seven working modules: Knowledge Risk dashboard, AI Interviewer (plus Quote Reasoning Log), Knowledge Library, Ask the Shop, Document Generator, Machine pages, Training.
- A privacy and deployment layer a prospect can *see*: classification on every record, a single routing policy, redaction with a "What will be sent" preview, an audit log, roles, consent, and cloud / local / hybrid modes.
- Installs cleanly with `npm install` on Windows 10/11 and Ubuntu 22.04/24.04 without C++ build tools.

**Non-goals (seams only, [§15](#15-seams-for-out-of-scope-items))**: real authentication/SSO, multi-tenant hosting, ERP / Paperless Parts integrations, vector search, production deployment.

**Principles**
1. **The AI is the interviewer; the shop is the expert.** Code and prompts contain *method* (Critical Decision Method, ACTA knowledge audit, laddering, teach-back), never machining facts. Every domain fact lives in `seed-data/` (fictional, for SME review) or comes from the person being interviewed. The interviewer is mechanically prevented from introducing words or numbers the expert didn't say ([§8.2](#82-ai-interviewer-and-quote-reasoning-log)).
2. **One chokepoint for AI.** Every model call goes through `runAI()`. Nothing else imports a provider SDK. Classification, routing, redaction, preview and audit can't be skipped by a feature.
3. **Demo mode changes only the transport.** Cached responses flow through the same routing, redaction, restoration, validation and audit code as live calls.
4. **Deterministic by construction.** Fixed seed, fixed `DEMO_TODAY`, a demo clock for domain dates, stable IDs, UTC formatting. Reset restores the exact same state in well under 2 seconds.
5. **Honest copy.** The app never claims to be ITAR/CMMC/FedRAMP compliant, never says "audio deleted" when it never had the audio, labels replayed AI answers as replays, and labels hand-written replays as "scripted (not model output)".

---

## 2. Decisions at a glance

| Area | Decision | Why (short) |
|---|---|---|
| Runtime | **Node 24 LTS**; engines `^22.13.0 \|\| ^24.0.0 \|\| ^26.0.0` (even majors only) | Node 24 is Active LTS (maintained to Apr 2028). Odd majors (23, 25) have no better-sqlite3 prebuilt binary |
| Framework | **Next.js 16.3.6** App Router, TypeScript 5.9, React 19.2 (as installed by create-next-app), Turbopack | Current stable. TS 7 and ESLint 10 break `eslint-config-next` today |
| Layout | `src/` directory, alias `@/*` → `./src/*` | Keeps SME-editable `seed-data/` and tooling at the root |
| Styling | **Tailwind CSS 4.3** (CSS-first `@theme`), **shadcn/ui CLI 4.21** (Radix base) | Brief. No `tailwind.config.js` in v4 |
| DB driver | **better-sqlite3 pinned to exactly `12.11.1`** + drizzle-orm 0.45.3 + drizzle-kit 0.31.11 | Downloads a prebuilt binary (no compiler) for Node 22/24/26 on Windows and Ubuntu (verified); FTS5 included; the sync API makes the atomic reset trivial. **Not 13.0.3**: it currently runs `node-gyp` on lockfile installs (upstream issue #1516). Offline install: keep npm's prebuild cache or vendor the release tarballs. (`@libsql/client` is *not* a drop-in fallback: it is async-only.) |
| Search | SQLite **FTS5** (bm25) + tag/synonym/entity boosts; no vector DB | Brief; deterministic; no extra services |
| Cloud LLM | `@anthropic-ai/sdk` 0.129.0, `ANTHROPIC_MODEL` default **`claude-sonnet-5-5`** (verified valid ID) | Brief |
| Bedrock | `@anthropic-ai/bedrock-sdk` 0.34.0, `BEDROCK_ENDPOINT=runtime` default (`mantle` optional); `AWS_REGION` and `BEDROCK_MODEL_ID` **required, no defaults** | Shares request and stream types with the Anthropic adapter; the runtime client otherwise silently defaults to us-east-1 |
| Local LLM | Ollama ≥ 0.34.4 via native `/api/chat` (plain `fetch`), default **`OLLAMA_MODEL=qwen3.5:4b`**, `think:false`, `num_ctx` 8192 | Fits a 16 GB laptop without a GPU; final pick after you answer Q1 |
| Structured output | JSON schema where the provider supports it, **always** zod-validated in code with one repair retry | Bedrock (Sonnet 5.5) and small Ollama models don't guarantee schema adherence |
| Voice | Browser Web Speech API behind a **speech-engine policy**: on-device recognition (Chrome) or typing by default; vendor-cloud speech off unless the owner enables it; "Simulated dictation" for the demo | Chrome's default engine sends audio to Google, and audio can't be redacted ([§4.9](#49-consent-and-voice)) |
| Tests | Vitest 5 (+ vite 8), Playwright 1.63, one `npm run demo:check` gate | Protects the scripted path on both OSes |
| Fonts | `geist` npm package via `next/font/local` | Builds and runs fully offline |
| QR | `qrcode` 1.5.4 → server-rendered SVG | Deterministic, no client JS |

---

## 3. Architecture

### 3.1 Big picture

```
 Browser (Chrome desktop / tablet)
   │  pages (React Server Components)          NDJSON streams          Server Actions (mutations)
   ▼                                              ▲                          │
 ┌──────────────────────────────── Next.js 16 server (Node runtime, bound to 127.0.0.1) ─────────────┐
 │  src/app/(app)/*  pages ──► src/lib/data/*  (role-aware reads; every read calls connection())   │
 │  src/app/api/ai/[task] ──► runAI()  ◄── the ONLY path to a model                                  │
 │        runAI: actor → role projection → retrieval (FTS5) → classify (+ suspicion signals) →      │
 │               policy.decide → withheld notice → assemble → redact (cloud) → [preview returns] →  │
 │               audit write-ahead → TRANSPORT → restore tokens → validate/cite → audit finalize    │
 │                                     │                                                             │
 │                    ┌────────────────┼──────────────────────┐                                      │
 │                    ▼                ▼                      ▼                                      │
 │          Anthropic adapter   Bedrock adapter        Ollama adapter        ReplayTransport         │
 │          (explicit baseURL)  (commercial/GovCloud)  (127.0.0.1:11434)     (DEMO_MODE cassettes)   │
 │                                                                                                   │
 │  better-sqlite3 (one connection per process, WAL, secure_delete) ──► data/floorwise.db (+ FTS5)  │
 └───────────────────────────────────────────────────────────────────────────────────────────────────┘
        ▲ npm run seed / Reset demo: one synchronous transaction, deterministic reinsert from seed-data/
```

### 3.2 Repository layout

```
ShopMemory/            (repository; the product is named Floorwise)
  PLAN.md  CLAUDE.md  AGENTS.md*  README.md  .env.example  .gitattributes  .gitignore
  next.config.ts  drizzle.config.ts  eslint.config.mjs  vitest.config.mts  playwright.config.ts
  tsconfig.json  postcss.config.mjs  components.json            (* AGENTS.md is generated by create-next-app)
  seed-data/            ALL domain content, SME-editable (YAML / CSV / Markdown), NAMES.yaml, demo cassettes
  drizzle/              generated migrations + custom FTS5 migration
  data/                 runtime DB, seed bundle, uploads, audit archive (gitignored; data/.gitkeep committed)
  scripts/              *.mts run with tsx: seed, seed-check, seed-lock, demo, demo-record, demo-verify,
                        demo-check, e2e-server, serve-https; scripts/lib/out.ts (the only console writer for scripts)
  tests/                Vitest unit/integration tests
  e2e/                  Playwright specs + no-egress preload
  docs/                 DEMO-RUNBOOK.md, SME-REVIEW.md (Phase 8)
  src/
    app/
      (app)/            app shell + pages (risk, library, ask, interview, documents, machines, people, jobs,
                        training, audit, privacy, settings, review, demo)
      api/              ai/[task], ai/preview, health, health/warm, audit/export, export, uploads
      actions/          Server Actions (persona, ai-routing, reset, approvals, reviews, consent, delete)
    components/         ui/ (shadcn), risk/, interview/, ask/, documents/, machines/, privacy/, common/
    db/                 schema/*.ts, client.ts (no server-only), reset.ts, classification.ts, fts.ts
    server/             db.ts, ai.ts — `import 'server-only'` wrappers used by the app
    lib/
      env.ts log.ts errors.ts time.ts (getDemoToday, demo clock, monthsBetween, UTC formatters)
      auth/             identity.ts, roles.ts, field-policy.ts, persona-cookie.ts (HMAC-signed)
      data/             role-aware data access (cards, jobs, people, machines, documents, audit…)
      retrieval/        fts-query.ts (sanitizer), synonyms.ts, retriever.ts, similar-jobs.ts, query-features.ts
      coverage/         compute.ts, params.ts
      policy/           matrix.ts, targets.ts, decide.ts, notices.ts, entity-detect.ts, covered-models.ts
      redaction/        dictionary.ts, patterns.ts (the one token grammar), redact.ts, stream-restorer.ts
      ai/               types.ts, gateway.ts, pipeline.ts, transport.ts, structured.ts, citations.ts,
                        tasks/*, providers/{anthropic,bedrock,ollama}.ts, replay/*
      audit/            ai-audit.ts, events.ts, query.ts, export.ts
      interview/        plans.ts, machine.ts, probes.ts, tracker.ts, novelty.ts (+ data/english-allowlist.txt),
                        numbers.ts (spoken-number normalizer), traceability.ts, candidates.ts
      speech/           policy.ts (pure, shared), engine.client.ts
      demo/             steps.ts, preflight.ts, fast-forward.ts
      seed/             load.ts, schemas.ts (zod), prng.ts (mulberry32), generate.ts, bundle.ts
```

### 3.3 Conventions that shape the architecture
- **Reads** are React Server Components calling `src/lib/data/*` functions that take the current `actor`, call `await connection()` (so pages are never prerendered with stale data), and return role-projected objects.
- **Mutations** are Server Actions wrapped in `withSafeErrors()` that start with `requireActor()` + `assertCan(...)` (Server Actions are reachable by direct POST).
- **AI calls and downloads** are route handlers (`/api/ai/[task]` streams NDJSON; `/api/audit/export`, `/api/export`). Server Actions run one at a time and cap bodies at 1 MB, so they stay short. User text travels in POST bodies, never in URLs (dev-server logs record URLs).
- `cacheComponents` stays **off**; no `use cache` on DB data.
- The DB module and the gateway core don't import `server-only` (it throws under `tsx` scripts); the app imports them through `src/server/*` wrappers that do. Scripts read configuration through `src/lib/env.ts` too.

---

## 4. AI gateway and privacy layer

### 4.1 Provider abstraction

```ts
// src/lib/ai/types.ts (abridged)
type ProviderKind = 'anthropic' | 'bedrock' | 'ollama';
type TargetClass  = 'anthropic' | 'bedrock_commercial' | 'bedrock_govcloud' | 'ollama_local';
type AIMode       = 'cloud' | 'local' | 'hybrid';

interface ProviderDescriptor {
  kind; targetClass; isCloud; model; host;          // host = hostname of the exact baseURL passed to the client
  region?; endpointMode?: 'runtime'|'mantle'; fips?;
  crossRegion?: 'global' | 'geo' | 'none';          // from the Bedrock inference-profile prefix (global. / us. / none)
  coveredModel?: boolean;                           // model requires 30-day retention (see below)
  available; verified: 'live-probe' | 'config-only-demo';
}

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
| Anthropic (`providers/anthropic.ts`) | Lazy client (DEMO_MODE needs no key). **Always pass an explicit `baseURL`** (default `https://api.anthropic.com`); the descriptor's host comes from that same value. A `logger` that routes into `log.ts` with `logLevel: 'warn'` (at `ANTHROPIC_LOG=debug` the SDK would log request bodies). `maxRetries: 2`, timeout. Effort via `output_config.effort` (`low` for interviewer phrasing, `medium` elsewhere). JSON via `output_config.format` with a **hand-written** JSON schema (`jsonSchemaOutputFormat(schema, { transform: false })`, because the SDK's zod helper silently drops `enum`). Check `stop_reason === 'refusal'`. Leave `max_tokens` headroom for adaptive thinking. | Send `temperature` / `top_p` / `top_k`, forced `tool_choice` (`any`/`tool`), assistant prefill, or `thinking: {type:'disabled'}` — each returns HTTP 400 on Sonnet 5.5. Combine structured output with the Citations feature (400). |
| Bedrock (`providers/bedrock.ts`) | `AnthropicBedrock` (runtime, default) or `AnthropicBedrockMantle` (`BEDROCK_ENDPOINT=mantle`). Require `AWS_REGION` + `BEDROCK_MODEL_ID` and **fail closed** without them. Always pass an explicit `baseURL`: `BEDROCK_BASE_URL` if set (FIPS/VPC; the SDK ignores `AWS_USE_FIPS_ENDPOINT`), else the regional default. Standard AWS credential chain (profile/SSO, env keys, or `AWS_BEARER_TOKEN_BEDROCK`). Prompt-JSON + zod (`nativeJsonSchema: false`). Derive `crossRegion` from the model-ID prefix. | Hardcode model IDs. Assume structured outputs (Sonnet 5.5 on Bedrock returns 400). Same sampling/tool_choice rules as above. |
| Ollama (`providers/ollama.ts`) | Native `POST /api/chat` with plain `fetch` (`redirect: 'error'`) and NDJSON parsing. **Always** `think: false`, identical `options` on every call (`num_ctx` from `OLLAMA_NUM_CTX`, `temperature: 0`, `num_predict` cap), `keep_alive: '60m'` (longer during a demo session), `format: z.toJSONSchema(...)` for JSON tasks, `truncate: false` outside production. Refuse models whose `/api/show` reports a non-empty `remote_host` (Ollama "cloud" tags). Record `load_duration` / `eval_count` timings in the audit row. | Use the OpenAI-compatible `/v1` (can't set `num_ctx` per request). Omit `think` (thinking defaults **on** and makes CPU answers take minutes). Change options between calls (forces a model reload). |

- **SDK environment variables are neutralised.** Both SDKs read their own env vars (`ANTHROPIC_BASE_URL`, `ANTHROPIC_BEDROCK_BASE_URL`, `ANTHROPIC_BEDROCK_MANTLE_BASE_URL`), which are common on machines that run Claude Code or an LLM gateway. Passing an explicit `baseURL` overrides them; `env.ts` also logs a boot warning (names only) when they are set, so the host shown in the header, checked by the policy and written to the audit is always where traffic actually goes.
- **Bedrock model IDs are not hardcoded.** `.env.example` points to AWS "Supported inference profiles", Anthropic "Claude in Amazon Bedrock" and the AWS GovCloud (US) Bedrock page. **The AWS documentation pages were unreachable during research**, so all Bedrock IDs are unconfirmed: Anthropic's docs list IDs such as `anthropic.claude-sonnet-5-5` (Mantle), and AWS's Sonnet 5.5 sample notebook and the bedrock-sdk README list the runtime profile `global.anthropic.claude-sonnet-5-5`; GovCloud uses the `us-gov.` prefix. **Sonnet 5.5 has no confirmed GovCloud availability**, so a GovCloud demo would use whatever model AWS lists for GovCloud on your account (`aws bedrock list-inference-profiles --region us-gov-west-1`).
- **Global cross-region profiles** can process requests in commercial regions worldwide, not just `AWS_REGION`. The header shows "global cross-region" for such models, the Privacy page explains it, a `us.` profile is recommended where one exists, and `CUSTOMER_CONFIDENTIAL_GLOBAL_PROFILE=deny` keeps customer-confidential data off global profiles.
- **Covered models** (Fable 5.1, Mythos 5.1, Fable 5, Mythos 5 and their Bedrock IDs; `policy/covered-models.ts`) require 30-day retention (AWS human-review mode on Bedrock; not available under zero data retention on the first-party API). Preflight, Settings and the Privacy page say so, and export_controlled records are denied to a covered model unless `COVERED_MODEL_EC=allow`.

### 4.2 The chokepoint: `runAI()`

```ts
runAI(req: AIRequest, opts: { dryRun: true }): Promise<AIPreview>;              // "What will be sent"
runAI(req: AIRequest, opts?: { previewToken?: string; signal?: AbortSignal }): AIRun;  // real call
// AIRequest carries: task, feature, actor, input text/turns, pinned RecordRefs, retrieval query, sessionId /
// threadId, consentId, excludeAboveClearance? (hybrid escape hatch only), scenarioHint (demo matching only).
// Callers pass record *references*; the gateway loads bodies and classifications from the DB itself.
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
| P0 | Context | Actor from the signed persona cookie; routing settings; cached provider health; task allowed for this role; valid consent for interview/extraction/quote-log tasks, and the current target class matches the consented one |
| P1 | Role projection | Records pass through `projectForRole(entity, role, 'llm')`. Prompt builders receive `LlmProjection<T>` types with no pricing or contact fields. Records the role can't see are dropped silently (not reported as "withheld", so their existence isn't revealed) |
| P2 | Retrieval | FTS5 + tags + synonyms + entity boosts over role-visible, approved records; the task's context budget is chosen *ignoring classification* (Ask: top 8 cards + top 4 similar jobs). That budgeted set is what the request "touches" |
| P3 | Classify | **Floor** = max of (a) dictionary entities in the user's text (naming an export-controlled job or part makes the question itself export-controlled), (b) the session/thread classification, (c) pinned records. **Suspicion signals** (deterministic, pre-send) mark the request `suspected_controlled`: (1) a *distinctive numeric core* of an export-controlled part/job number — ≥ 4 digits, unique to one export-controlled record, and not in a stoplist of material/spec/machine numbers (6061, 7075, 718, 9102, …); the generator avoids cores that collide with the stoplist; (2) a *near-miss* (edit distance exactly 1, ≥ 7 chars) of a customer whose part floor is export_controlled — exact name hits are handled by the floor. (3) In Cloud mode, if the rank-1 hit or ≥ 50 % of the budgeted set is above the target's clearance, the request is held. Maya's question and Ray's scripted turns trigger none of these (tested) |
| P4 | Decide | `policy.decide()` ([§4.4](#44-routing-policy)) → target, sent vs **withheld = budgeted records not cleared for the target** (no backfill, so the context stays predictable), or **blocked** |
| P5 | Notice | Withheld/blocked/held message for the first `meta` event |
| P6 | Assemble | Sources get per-request keys `S1…Sn` (DB IDs never reach the provider). Task prompt built with a `promptVersion` from projections only (`src/lib/ai/tasks/**` may not import `@/db` or `@/lib/data`). Prompt builders never include runtime timestamps. Ollama token budget enforced |
| P7 | Redact | Only when the target is cloud — **including GovCloud**. Existing literal `[[…]]` sequences in any input are escaped first; then **every string in the `ProviderRequest`** (system, messages, `output.jsonSchema`) is redacted |
| P8 | Freeze | `payloadHash = sha256(canonical redacted payload)`; for local targets the hash covers the *redacted-for-storage* rendering (the same bytes the audit stores). The preview also returns `previewToken = sha256(payloadHash \| targetClass \| host \| model)`. **Preview returns here.** A real call whose `previewToken` no longer matches (payload *or* destination changed, e.g. someone switched Local → Cloud) is rejected and the preview re-opens showing the new destination |
| R1 | Audit write-ahead | Row inserted with `outcome='pending'`. Blocked/held decisions write a complete row with nothing sent and stop |
| R2 | Transport | Live adapter, **or `ReplayTransport` in DEMO_MODE — the only step that differs** |
| R3 | Restore | `StreamRestorer` swaps tokens back using only *this request's* token map; safe across chunk boundaries |
| R4 | Post-process | Citations `[S#]` kept only if actually sent (others stripped and counted; zero valid citations → "unverified" banner); zod validation + one repair retry (child audit row); refusal handling; outputs inherit `max(sent classifications, floor)`; task hooks (card traceability gate, quiz traceability check) |
| R5 | Audit finalize | Redacted response, tokens, latency, outcome, served model. A SQLite trigger blocks updates after completion |
| R6 | Emit | text → result → done; client disconnect aborts the provider call |

**Enforcement:** ESLint `no-restricted-imports` (provider SDKs only inside `src/lib/ai/providers/*`; `transport`/`pipeline`/`replay` internal to `src/lib/ai`; tasks can't import the DB), `no-console` everywhere except `src/lib/log.ts` and `scripts/lib/out.ts`, `no-restricted-properties` on `process.env` (only `src/lib/env.ts` and `*.config.ts`), plus `tests/architecture.test.ts` that greps for the same things and also forbids `@opentelemetry/*`, `@sentry/*` and `onRequestError` exports (telemetry is egress). `next build` no longer runs lint, so the architecture test is required.

### 4.3 Data classification

Four levels, ranked: `general < internal < customer_confidential < export_controlled`. Every card, job, part, quote, transcript (interview + turns), document, quiz, photo, capture, machine event, Ask thread and quote-reasoning log has `classification`, plus `classification_source` (`derived` | `override_up` | `override_down`) and a required reason for overrides. One module (`src/db/classification.ts`) computes floors.

**Floor = max(linked records, source session, entities detected in the record's own text).** The content scan runs the same entity detector as P3 over text fields (card title/statement/rationale/cues/actions/common_mistake, document body, transcript turns, quote-log answers), so a card that *mentions* an export-controlled job inherits export_controlled even without a link. An interview is **raised automatically** (with an event) when a turn mentions an entity above its level.

| Record | Floor | Default | Notes |
|---|---|---|---|
| customer | — | `customer_confidential` | Each customer also has a `part_classification_floor` (defense customers: `export_controlled`). Customer *names* stay customer_confidential; naming a defense customer is not by itself export-controlled |
| part | max(customer's part floor, `export_control ∈ {ear_controlled, itar}` → export_controlled) | = floor | Lowering below the customer floor: owner + reason only |
| quote / job | the part | = floor | |
| interview (transcript) | max(linked quote/job/part/customer, level chosen at consent, content) | = floor, at least `internal` | Hidden manual-entry sessions (provenance for hand-entered cards) take each turn's classification from its card |
| knowledge card | max(source interview, customer/part/job/quote links, content) — machine, material and person links are reference entities and don't raise a card's floor | max(floor, `internal`) | `general` allowed only when the floor is `general` (no customer/part/job/quote links or mentions), set in seed or by the owner |
| document / quiz | max of source cards (at pinned versions) | = floor | |
| photo / capture | max(linked records); with no job selected, max of jobs in process on that machine in the last 30 days | = floor, at least `internal` | A photo can show a controlled part even if metadata is stripped |

- **Recomputation only raises.** When a source is lowered, dependents are flagged "may be over-classified: review" and keep their level until the owner lowers each one with a reason.
- People, personas, machines and the shop profile are implicitly `internal`; materials and process topics `general`.
- Badge tooltip: *"These labels control routing inside this app. They are not official CUI markings or export-classification determinations. If a record contains CUI (including Controlled Technical Information or covered defense information), label it export_controlled here so it only reaches the local model or an allowlisted GovCloud endpoint."*

### 4.4 Routing policy

A single config object in `src/lib/policy/matrix.ts` is the source of truth; the Privacy page matrix and the header clearance dots render from it.

| Classification ↓ / Target → | Anthropic API | Bedrock (commercial region) | Bedrock GovCloud (allowlisted host) | Ollama (this computer / allowlisted on-prem host) |
|---|---|---|---|---|
| general | ✅ redacted | ✅ redacted | ✅ redacted | ✅ |
| internal | ✅ redacted | ✅ redacted | ✅ redacted | ✅ |
| customer_confidential | ✅ redacted *(ASSUMPTION; `CUSTOMER_CONFIDENTIAL_CLOUD=deny` makes it local/GovCloud-only)* | ✅ redacted *(global profiles deniable)* | ✅ redacted | ✅ |
| export_controlled | ❌ | ❌ | ✅ redacted *(not to covered models by default)* | ✅ |

- Redaction on cloud calls is **always on** and not configurable.
- **Pricing fields and customer contacts never reach any model** (field rule, [§4.8](#48-roles)); currency amounts and rates in free text are tokenized on cloud calls ([§4.5](#45-redaction)).
- **GovCloud target** only if *all* hold: region ∈ {`us-gov-west-1`, `us-gov-east-1`}; the host of the explicit `baseURL` (lower-cased, exact match) is in `GOVCLOUD_ENDPOINT_ALLOWLIST` (default: the two `bedrock-runtime-fips.<region>.amazonaws.com` hosts); the host contains the region; `https:` with no path/userinfo; model ID prefix `us-gov.` (runtime) or `anthropic.` (mantle). Otherwise it's treated as commercial, and Settings says which check failed.
- **Ollama counts as local** only if `OLLAMA_BASE_URL` is loopback, or is in `OLLAMA_HOST_ALLOWLIST` **and** uses `https:` (or `OLLAMA_ALLOW_PLAINTEXT_LAN=true`, shown as "on-prem · unencrypted"), and the model has no `remote_host`. "Nothing leaves this computer" is shown only for loopback.

**`decide()`** (pure function):

```
floor = max(requestText entities, session/thread, pinned);  suspicion signals from P3
local mode : target = local;  unavailable → blocked('local_unavailable')
cloud mode : target = cloud;  floor not cleared → blocked('request_not_cleared')   // nothing sent, no transport call
             suspected_controlled / retrieval signal → held('looks_controlled')      // audited "It isn't — send anyway"
                                                                                     //   offered only if no detector hit
hybrid     : need = max(floor, classifications of the budgeted context set)
             need = export_controlled → local (GovCloud only if HYBRID_EC_TARGET=govcloud)
             else cloud cleared for need → cloud;  else local available → local
             else blocked('local_unavailable_controlled')        // FAIL CLOSED: never falls back to cloud
sent = budgeted records cleared for target;  withheld = the rest (no backfill);  redact = target.isCloud
```

- **DEMO_MODE availability:** with `DEMO_MODE=true` and `DEMO_LIVE_LOCAL=false`, provider availability comes from configuration (`verified: 'config-only-demo'`) and `ReplayTransport` serves the call. The fail-closed "Unreachable" behaviour applies in live mode, or when `DEMO_LIVE_LOCAL=true`.
- **Hybrid escape hatch.** Hybrid with Ollama down is refused. **If and only if the request floor is cleared for the cloud target**, the notice offers "Ask without the N controlled records". The button posts `{ task, input, excludeAboveClearance: true }` — never a client-supplied ID list. The server re-runs P0–P8 in full (recomputing the floor, blocking again if needed), drops records not cleared for the cloud target, and writes its own audit row (`decision='user_excluded_controlled'`). This is the only per-request routing input, and it can only narrow what is sent.
- Mode and provider are global and server-side.
- **Similar-jobs panel rule:** one scorer ([§8.4](#84-ask-the-shop-ask)) serves both the panel and the Ask context. The panel shows the **top 3 jobs cleared for the active target**, plus a collapsed row "1 more similar job not sent to {provider} (export-controlled) · shown to you" listing the role-visible jobs that were withheld.

**User-facing notices** (`policy/notices.ts`; stored in the audit as `notice_key` + record IDs, rendered at view time):
- *Withheld:* "1 related job was withheld from this answer. It is labeled export-controlled, and Cloud mode (Anthropic API · claude-sonnet-5-5) isn't cleared for export-controlled data, so it was not sent. Switch to Local or Hybrid to include it." + expandable list.
- *Blocked (the question itself is controlled):* "Not sent — withheld. This question refers to job RJ-26-0310, which is labeled export-controlled. Export-controlled data can go only to the local model or an allowlisted AWS GovCloud endpoint. Nothing was sent to Anthropic. [Switch to Local] [Show matching records]"
- *Held (looks controlled):* "Not sent yet. This question looks like it's about export-controlled work (it matches records you can see that are labeled export-controlled). [Switch to Local] [It isn't — send anyway]"
- *Hybrid, local down:* "Not sent. This request includes export-controlled records, which must go to the local model, but Ollama at 127.0.0.1:11434 isn't responding. Floorwise never sends controlled data to the cloud as a fallback."
- Search panels are local DB queries (not AI calls). Records not sent to the AI carry a lock chip: "Shown to you · not sent to {provider}".

### 4.5 Redaction

**Dictionary** built from the DB (cached, version-bumped on writes and reset):

| Source | Token |
|---|---|
| customer names + aliases (case-insensitive) | `[[CUSTOMER_xxxx]]` |
| people and persona labels (incl. the owner): full name and last name (≥ 4 chars, case-insensitive), first name/nickname (capitalized, case-sensitive); each surface form gets its own variant so restoration reproduces the exact form replaced | `[[PERSON_xxxx]]` full · `[[PERSON_xxxx_F]]` first · `[[PERSON_xxxx_L]]` last |
| part numbers (separators optional, trailing revision allowed: `AV-2231-07`, `AV223107`, `AV-2231-07C`) | `[[PART_xxxx]]` |
| job and quote numbers (they cross-reference customer POs) | `[[JOB_xxxx]]`, `[[QUOTE_xxxx]]` |
| customer contacts (never sent anyway) | `[[CONTACT_xxxx]]` |
| regex: part-number-like strings not in the DB; emails; phones; **currency amounts and rates** (`$1,800`, `$165/hr`, "165 an hour") | `[[PN_xxxx]]`, `[[EMAIL_xxxx]]`, `[[PHONE_xxxx]]`, `[[AMOUNT_xxxx]]` (persisted in `redaction_tokens`) |

- **Token grammar** is defined once in `redaction/patterns.ts`: `\[\[(CUSTOMER|PERSON|PART|JOB|QUOTE|CONTACT|PN|EMAIL|PHONE|AMOUNT)_[0-9A-Z]{4}(?:_[FL])?\]\]`. The 4-character code is Crockford base32 of `HMAC-SHA256(SEED, kind|entityId)` with deterministic collision resolution: stable across resets (so cassettes keep working) but carrying no ID structure, counts or anchor status.
- One compiled alternation, **longest match first** ("Ray Delgado" before "Ray"), Unicode-aware boundaries (`(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])`, handles "Aerovance's"), NFC-normalized input, and a stoplist of domain compounds that never match person names ("X-Ray", "Gamma Ray"). Two people or contacts sharing a first name get an ambiguity token that restores to the first name only. Lowercase first names ("ask ray") appear as preview *suspects*, not silent misses.
- **Not redacted, on purpose:** materials, machine makes/models, process terms, tolerances, hours, spec numbers (AS9102, AMS, MIL…), the shop's own name. That's the know-how the model needs; the brief lists customers, part numbers and people.
- **Restoration** (`StreamRestorer`): buffers a trailing partial `[[…` across chunks, restores only tokens in *this request's* map (unknown → `[unknown]`), validates `[S#]` citations in the same pass. Unit-tested by splitting every token at every offset.
- **Limitations, shown in the preview and on the Privacy page:** "Text you type or dictate is sent as written; the detector only knows the names and numbers in the database." Also: misspellings and speech errors, indirect identifiers ("the jet-engine customer in Wichita"), and the technical content itself. For export-controlled work **routing is the control; redaction only reduces exposure.** Stable tokens let a provider correlate `[[CUSTOMER_…]]` across calls; the Privacy page states that trade-off.

### 4.6 "What will be sent" preview

A sheet opened from the Send button in Ask the Shop, Document Generator, Quote Log and Training. It is the **same `runAI()` with `dryRun: true`**, so the preview is byte-identical to what is sent. It shows destination (provider · model · host · region · cross-region · mode), classification chips, sent/withheld records with reasons, the exact `ProviderRequest` JSON with tokens highlighted (signal-orange outline, ink text), a token legend that resolves only tokens produced from *this* request, filtered by the viewer's role, suspects with a one-click "Redact this" (adds an alias), and **"Send exactly this"** (passes the `previewToken`, so a changed payload or destination re-opens the preview instead of sending). For local targets the header reads "Local: not redacted" (plus "never leaves this computer" only when the host is loopback). The **interviewer** shows a "Show last payload" link after each turn plus an optional "Preview before each send" toggle, so the conversation isn't interrupted every turn (*ASSUMPTION*).

### 4.7 Audit log

Two tables: `ai_audit_log` (every AI call, including blocked and held ones) and `event_log` (consent, persona switches, settings changes, card/document transitions, speech sessions and blocks, exports, deletes, resets, fast-forwards).

- **`ai_audit_log` columns:** timestamps (real time), request/parent IDs and attempt, **actor IDs only** (person, persona, role — names are resolved at view time), feature, task, mode, decision, provider kind, target class, configured and served model, endpoint host, region, cross-region, isCloud, transport (`live` | `demo_replay_exact` | `demo_replay_scenario` | `demo_fallback` | `none`), cassette provenance, max classification, classifications included, record IDs sent, records withheld (+ reason), `notice_key` + params, redaction token count and `tokens_used`, **redacted user input, redacted request payload, payload hash, payload stored form, redacted response**, prompt version, token usage, latency/TTFT, stop reason, outcome, safe error code, citation counts, policy version, app version. `event_log.details_json` holds IDs and enums only.
- **What is guaranteed (worded honestly):** audit and event tables store model inputs and outputs only after dictionary and pattern redaction. Cloud rows store exactly the redacted payload that was sent. **Local (Ollama) rows store the payload redacted-for-storage**, labelled "sent: unredacted (local) · stored: redacted". Text that isn't in the dictionary is stored as written. Product records (cards, documents, Ask threads, transcripts) are stored in the clear by design, because they *are* the product.
- **Reveal** re-hydrates at render time only the tokens listed in that row's own `tokens_used` map (tokens the redactor produced from that request), filtered by the viewer's role — so typing a literal `[[CONTACT_…]]` reveals nothing. The owner can Reveal any row; every other role can Reveal its own rows, for fields that role may see.
- **Integrity:** write-ahead then one finalize; a trigger aborts later updates. Only Reset demo and Full delete remove rows; both write an event. **Reset archives rows with `transport='live'`** to `data/audit-archive/` before deleting. (Seam: hash chain + "Verify".)
- **Viewer `/audit`:** filters (date, persona, role, feature, provider, model, mode, decision, classification, replay, outcome, free text — the search text is run through the redactor before matching, so searching "Aerovance" finds tokenized rows), detail drawer (Sent · Response · Policy · Reveal · Retry chain), an "Include activity events" toggle for `event_log`.
- **Export** `POST /api/audit/export` (format and filters in the body): **every role exports the rows it can see** (owner: all). CSV formula-injection guard, `Cache-Control: private, no-store`, filename carries the highest classification included, each export writes an event.

### 4.8 Roles

Demo personas: **Owner** (Dana Whitcomb, owner/GM; persona-only — no `people` row, not a knowledge holder; *ASSUMPTION*), **Ray** (quoter; approvals), **Maya** (quoter), **Marv** (machinist), **Devin** (trainee). An "Act as…" menu can derive a persona for any seeded person. Cookie `fw_persona` is httpOnly, SameSite=Lax and **HMAC-signed with a per-boot secret**; the role is read from the DB, never from the cookie.

| Field / capability | owner | quoter | machinist | trainee | Sent to an LLM? |
|---|---|---|---|---|---|
| Prices, unit price, margins, shop rates, material cost, risk adders | ✓ | ✓ | hidden | hidden | **never** |
| Quoted vs actual hours, setup/cycle times | ✓ | ✓ | ✓ | ✓ | yes |
| Win/loss and loss reason | ✓ | ✓ | hidden | hidden | only if the role can see it |
| Customer names and documented quirks | ✓ | ✓ | ✓ | ✓ (*ASSUMPTION: needed on the floor*) | yes (tokenized for cloud) |
| Customer contacts and commercial terms | ✓ | ✓ | hidden | hidden | **never** |
| Planned departure dates, the departure factor in risk explanations, the "departing within 24 months" KPI | ✓ | ✓ | hidden | hidden | no |
| Audit log (view / Reveal / export) | all rows | own rows | own rows | own rows | — |
| Full export, full delete | ✓ | – | – | – | — |
| Change AI mode/provider, Reset demo | ✓ (**any persona when `DEMO_OPEN_CONTROLS=true`** — *ASSUMPTION*, so step 6 needs no persona switch) | | | | — |
| Approve cards | as contributor, or "on behalf" with logged reason | as contributor | as contributor | as contributor | — |
| Approve documents | ✓ | if assigned reviewer | if assigned reviewer | – | — |
| Start interview / Quote Reasoning Log | any subject / ✓ | self / ✓ | self / – | – / – | — |
| Generate documents | ✓ | ✓ | ✓ | – | — |

- Hidden fields render a visible pill ("Hidden for Machinist role") so the demo can point at it. Enforcement is server-side in three places: data access functions, every action/route handler, and the gateway's role projection. `tests/role-projection.test.ts` asserts that payloads for every role contain no pricing field names, no untokenized `$` amounts and no contact tokens.
- **Every persona can open export-controlled records in this demo.** The Privacy page says so: a real deployment must limit them to authorized U.S. persons (seam: per-person `export_access`, [§15](#15-seams-for-out-of-scope-items)).
- **Network exposure:** `npm run demo` binds `next start -H 127.0.0.1`. The optional tablet segment uses `scripts/serve-https.mts` on the LAN, protected by a presenter PIN (`DEMO_PIN`) that is required for Reset, Full delete, Full export and audit export from non-loopback clients. Preflight warns when the server is bound to a non-loopback interface.

### 4.9 Consent and voice

**Consent.** Interviews and quote logs can't start until the subject (or the owner "on behalf", naming the subject) ticks a consent box. `consent_records` stores who, when, text version, SHA-256 of the exact text shown, the speech engine disclosed, and **the AI destination at consent time** (mode, target class, endpoint host). The consent text says where answers go ("Your answers are sent to the Anthropic API with names replaced by tokens" / "…to the local model on this computer" / "…to an allowlisted AWS GovCloud endpoint"). `runAI()` refuses interview/extraction/quote-log tasks without valid consent, or when the current target class differs from the consented one (the UI asks for re-consent). Withdrawal copy is exact: *"Deletes the transcript and unapproved drafts. Approved cards, the AI-call audit log (names tokenized) and any retention by the AI provider under its terms are not affected."*

**The brief's "raw audio is deleted after transcription" can't be stated truthfully with the Web Speech API**: Floorwise never receives the audio at all, and the browser vendor might (Chrome's default engine sends audio to Google; Safari may use Apple servers and the page can't tell; Chrome 139+ offers on-device recognition via `processLocally`, `SpeechRecognition.available()` and `install()`; Android Chrome has no on-device mode). So the copy is engine-specific, shown in a chip next to every mic:

| Engine | Chip copy |
|---|---|
| Chrome on-device | "Voice: on this device. Audio never leaves this computer. Floorwise saves only the text you approve." |
| Vendor cloud (only if the owner enabled it) | "Voice: Google (or Microsoft/Apple) speech service. Your browser sends this audio to that service to turn it into text. Floorwise never receives or stores audio. Don't dictate customer names, part numbers or export-controlled details." |
| Blocked | Reason-specific, e.g. "Voice is off because this browser can't do on-device speech and cloud speech is turned off" · "…because this interview is customer-confidential" · "…because Local mode is on" |
| Simulated (demo) | "Simulated dictation (demo): plays the scripted answer; no microphone used." |

**Speech policy** (`src/lib/speech/policy.ts`, pure): on-device recognition is always allowed; **vendor-cloud speech is off by default** (`VOICE_VENDOR_CLOUD=off`) everywhere, including machine pages; when the owner turns it on, it is allowed only for general/internal sessions in Cloud mode. Never a silent fallback from `processLocally=true` to cloud; recognition stops immediately if the session is reclassified; the `phrases` boost list is set only when `processLocally=true` (a phrase list of customer names would otherwise go to the vendor). Speech sessions and blocks are logged (engine, duration, character count — never transcript text). The "audio deleted after transcription" sentence is reserved for the future local speech-to-text seam ([§15](#15-seams-for-out-of-scope-items)).

Voice requires a secure context: `http://localhost` is fine; a tablet hitting `http://192.168.x.x` gets no microphone. The scripted voice moments run in Chrome on the laptop.

### 4.10 Secret and payload hygiene
- `src/lib/env.ts`: zod-validated env parsed once at boot (`instrumentation.ts` `register()` only — no exporters); conditional rules (e.g. `LLM_PROVIDER=bedrock` requires `AWS_REGION` + `BEDROCK_MODEL_ID`); boot log prints which variables are *set*, never values; warns when SDK base-URL variables are present (they are overridden). The only place `process.env` is read, including by scripts.
- `src/lib/log.ts`: the only place `console.*` is allowed in app code (`scripts/lib/out.ts` for scripts, which prints tokenized text only). Flat primitive fields; drops keys matching `prompt|payload|messages|content|text|body|transcript|key|secret|token|authorization|password|cookie`; truncates strings; scrubs `sk-ant-…`, AWS key IDs/secrets, `Bearer …`. SDK loggers are routed here.
- **Errors never carry payloads:** every route handler and Server Action is wrapped in `withSafeErrors()` (rethrows only `AIError { code, safeMessage }`), so Next.js's own error logging and the dev overlay never see raw errors. Model JSON is parsed in `try/catch` that discards `e.message` (V8 embeds input snippets); FTS errors are caught before they can echo user text.
- `NEXT_TELEMETRY_DISABLED=1` is set by every script wrapper and in `.env.example`; never set `OLLAMA_DEBUG_LOG_REQUESTS`; setup docs recommend `OLLAMA_NO_CLOUD=1`.
- `tests/secret-hygiene.test.ts` builds **real** Anthropic and Bedrock clients with an injected `fetch` stub (success, HTTP 500, malformed JSON containing a canary) under `ANTHROPIC_LOG=debug`, plus the full scripted replay path. It spies on stdout/stderr/console and asserts no canary key, no canary phrase, no dictionary name (including the owner) and no prompt fragment appears, and that `ai_audit_log` and `event_log` contain no dictionary names.

### 4.11 Settings, header badge, preflight

**In-app setting** `ai_routing = { mode: 'cloud'|'local'|'hybrid', cloudProvider: 'anthropic'|'bedrock' }` (Server Action `setAiRouting`, logged to `event_log`). `/settings` and the header badge offer a mode switch and a cloud-provider picker; options whose credentials/config are missing are disabled with the reason. **Precedence:** `AI_SETTINGS_LOCKED=true` → env only; else the in-app setting if set; else env (`LLM_PROVIDER` + `AI_MODE`); else cloud/Anthropic. Model IDs change only via env. **Reset demo clears the in-app setting**, so the env default applies again.

**Header badge (always visible; collapses to icon + short label on phones):** mode pill (CLOUD / LOCAL / HYBRID), provider line (`Anthropic API · claude-sonnet-5-5`; `Amazon Bedrock · us-east-1 · global cross-region`; `Amazon Bedrock · us-gov-west-1 · FIPS · allowlisted`; `Ollama · qwen3.5:4b · this computer · Ready`), four clearance dots (G/I/CC/EC), a `REPLAY` tag in DEMO_MODE (signal-orange fill, **ink** text; "REPLAY · scripted" for hand-authored cassettes), a health dot linking to Privacy & Deployment. Every AI result also carries a per-request "Routed to …" chip (Hybrid uses two providers).

**Preflight** `GET /api/health` (+ `?deep=1`): Anthropic key present / reachable (deep: `models.retrieve`, no shop data); Bedrock region, endpoint, host, FIPS, cross-region, allowlist checks, credential source; covered-model notes; Ollama version ≥ 0.34.4, model pulled, `remote_host` empty, thinking values, GPU share, context length, warm. `POST /api/health/warm` pre-loads Ollama with identical options — at boot, on switching to local/hybrid, and **also in DEMO_MODE when `DEMO_LIVE_LOCAL=true`**. Configuration errors for the demo: `DEMO_MODE` with `AI_SETTINGS_LOCKED=true` or `CUSTOMER_CONFIDENTIAL_CLOUD=deny` fails preflight unless a matching script variant exists.

### 4.12 `.env.example` (committed; `.gitignore` has `.env*` and `!.env.example`)

```bash
LLM_PROVIDER=anthropic              # anthropic | bedrock | ollama
AI_MODE=                            # cloud | local | hybrid (default: local if LLM_PROVIDER=ollama, else cloud)
HYBRID_CLOUD_PROVIDER=anthropic     # cloud side of hybrid when LLM_PROVIDER=ollama
HYBRID_EC_TARGET=local              # local | govcloud  (where hybrid sends export_controlled)
AI_SETTINGS_LOCKED=false
CUSTOMER_CONFIDENTIAL_CLOUD=allow   # allow | deny
CUSTOMER_CONFIDENTIAL_GLOBAL_PROFILE=allow   # allow | deny (Bedrock global cross-region profiles)
COVERED_MODEL_EC=deny               # allow | deny (export_controlled to 30-day-retention models)
VOICE_VENDOR_CLOUD=off              # off | on (browser cloud speech; on = general/internal sessions only)
DEMO_MODE=true
DEMO_OPEN_CONTROLS=true             # any persona may switch mode/provider and reset (demo convenience)
DEMO_MISS=offline                   # offline | live   (what DEMO_MODE does on a cache miss)
DEMO_REPLAY_SPEED=realistic         # realistic | fast | instant
DEMO_LIVE_LOCAL=false               # true = Local mode calls the real Ollama even in DEMO_MODE (runtime toggle on /demo)
DEMO_PIN=                           # required for destructive/export actions from non-loopback clients
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5-5
AWS_REGION=                         # REQUIRED for bedrock (no silent us-east-1)
BEDROCK_ENDPOINT=runtime            # runtime | mantle
BEDROCK_MODEL_ID=                   # REQUIRED. Confirm current IDs on your account (do not guess):
#   aws bedrock list-inference-profiles --region <region>
#   https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html
#   https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock
#   https://docs.aws.amazon.com/govcloud-us/latest/UserGuide/govcloud-bedrock.html
BEDROCK_BASE_URL=                   # FIPS/VPC override, e.g. https://bedrock-runtime-fips.us-gov-west-1.amazonaws.com
GOVCLOUD_ENDPOINT_ALLOWLIST=bedrock-runtime-fips.us-gov-west-1.amazonaws.com,bedrock-runtime-fips.us-gov-east-1.amazonaws.com
# AWS auth: AWS_PROFILE (incl. SSO) | AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_SESSION_TOKEN | AWS_BEARER_TOKEN_BEDROCK
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:4b
OLLAMA_NUM_CTX=8192
OLLAMA_HOST_ALLOWLIST=              # extra on-prem hosts treated as local (https required unless the next line is true)
OLLAMA_ALLOW_PLAINTEXT_LAN=false
PUBLIC_BASE_URL=http://localhost:3000   # what machine QR codes encode (use the laptop's LAN URL for a tablet)
FLOORWISE_DB=main                  # main | e2e (selects one of two static DB paths)
AUTH_MODE=demo                      # demo (signed persona cookie); seam for a future oidc provider
AI_TIMEOUT_MS=60000
NEXT_TELEMETRY_DISABLED=1
```

---

## 5. Data model

### 5.1 Conventions
- SQLite via Drizzle; migrations with `drizzle-kit generate` + `migrate` (**never `push`**, which would drop the FTS tables; `tablesFilter: ['!*_fts*']`).
- One synchronous connection per process cached on `globalThis`; `journal_mode=WAL`, `busy timeout 5000`, `foreign_keys=ON`, `synchronous=NORMAL`, `secure_delete=ON`. Transactions must be synchronous (better-sqlite3 throws on async callbacks).
- DB path: `FLOORWISE_DB` (read via `env.ts`) selects one of two **static** literals — `path.join(process.cwd(), 'data', 'floorwise.db')` or `…'e2e.db'` — so Turbopack doesn't trace the whole project (verify in Phase 1).
- Text IDs, never random UUIDs in seed data. **People, customers and parts use opaque codes** (`PER-01`, `CUS-01`, `PRT-A01`) so a name slug can never ride past the redactor; machines/materials use readable slugs (`m-dmu50`, `mat-ti64`). Printed QR codes encode `/machines/<id>`, so machine IDs are permanent.
- **Two clocks.** Domain dates (seeded dates, and runtime approvals, card `created_on`, document dates, consent display) use the **demo clock**: `DEMO_TODAY`'s date plus the real time of day. Only `ai_audit_log`, `event_log` and session timestamps use real time. KPI windows use the demo clock.
- Dates `YYYY-MM-DD`, timestamps ISO-8601 UTC; `real` for hours and money; JSON columns typed via `$type<T>()`; enums declared once in `src/db/schema/enums.ts`; DB `CHECK` on every classification column. No birth dates or ages.

### 5.2 Tables (41 + 2 FTS5 virtual tables)

**Shop, people, personas (3)**

| Table | Key columns |
|---|---|
| `shop_profile` (1 row) | name, employee_count 30, certifications `["AS9100D (fictional)"]`, **demo_today** `2026-09-15`, seed, seed_bundle_hash, fictional_notice |
| `people` (8) | id `PER-01…08`, full_name, display_name, job_title, department, app_role, cohort (veteran/new_hire), hire_date, prior_experience_years, planned_departure_date, departure_kind, is_knowledge_holder, bio_md, redaction_aliases[], sort_order |
| `personas` (5) | id `P-OWNER` / `P-PER-01`…, label, role, person_id (NULL for owner), redaction_aliases[] (owner), is_default_for_role, show_in_switcher |

**Assets and customers (5)**

| Table | Key columns |
|---|---|
| `machines` (8) | id `m-vf4`…, asset_tag `RP-M01`…, name, make, model, kind, year_installed, acquired (new/used), status, capabilities[], unit_history_md (this unit's history only) |
| `machine_events` | id, machine_id, occurred_on, kind (issue/repair/pm/crash/alarm/upgrade), summary, job_id?, person_id?, classification |
| `materials` (7) | id `mat-6061`…, name, short_name, family, aliases[] (feed search synonyms) |
| `customers` (6) | id `CUS-01…06`, name, industry, customer_since, is_new_customer, part_classification_floor, quality_requirements_md, redaction_aliases[], part_number_pattern, classification |
| `customer_accounts` | **role-hidden** (owner/quoter): contact_name (fictional), contact_email (`@example.com`), payment_terms, annual_spend_usd, pricing_notes_md |

**Parts, quotes, jobs (5)**

| Table | Key columns |
|---|---|
| `parts` (60) | id `PRT-A01` (anchor) / `PRT-G17` (generated) / `PRT-I01` (internal), customer_id?, part_number, revision, description, family, material_id, features[] (thin_wall, five_axis, tight_tolerance…), min_wall_in, max_wall_height_in, tightest_tol_in, complexity 1–5, export_control (none/ear99/ear_controlled/itar — demo label, not a determination), is_anchor, classification |
| `quotes` (120) | id `Q-A01` / `Q-G001`, quote_number, part_id, customer_id, quoted_on, quoted_by_person_id, qty, primary/secondary machine, quoted_setup_hours, quoted_cycle_minutes, **quoted_hours**, lead_time_days, outcome (won/lost/no_bid/pending), lost_reason, judgment_drivers[], quoter_notes_md, search_title/text/tags (**never contain prices**), classification |
| `quote_financials` | **role-hidden** (separate table, so non-cleared queries never join it): shop_rate, material_cost, outside_processing, risk_adder_hours, scrap_allowance_pct, unit_price, total_price, target_margin_pct |
| `jobs` (70 won + 4 internal) | id `J-A02`, job_number (`RJ-yy-nnnn`), quote_id?, part_id, status, started_on, shipped_on, lead_person_id, actual_machine_id, actual setup/run/**actual_hours**, variance_pct, scrap_qty, ncr_count, on_time, debrief_md, classification |
| `quote_reasoning_logs` | quote_id, interview_id, person_id, main_driver, machine_rationale, hours_rationale, risk_priced_in, risk_bucket (hours/setup/scrap_allowance/inspection/outside_processing/other), what_would_change, junior_would_miss, confidence_1to5, variance_review_md, classification |

**Taxonomy and expertise (3)**

| Table | Key columns |
|---|---|
| `topics` (28 heat-map rows) | id `t-thin-wall` / `t-mat-ti64` / `t-m-dmu50` / `t-cus-01`, category (process/machine/material/customer), label, FK to the matching entity |
| `tags` (~40) | id, label, topic_id?, synonyms[] |
| `person_topic_expertise` | (person, topic) → tacit_level 0–3, assessed_by (sme_seed/owner/self), note |

**Knowledge cards (5)**

| Table | Key columns |
|---|---|
| `knowledge_cards` | id `KC-001…090` seeded, **`KC-091…094` reserved for the scripted interview**, `KC-101+` runtime; version, supersedes_id, type (quoting_rule / setup_tip / machine_quirk / customer_quirk / inspection_gotcha / failure_story), status (draft / pending_review / approved / rejected / superseded), title, statement, rationale, common_mistake, applies_when[], does_not_apply_when[], cues[], actions[], thresholds[] (`{quantity, comparator, value, value_max, unit, verbatim}`), open_questions[], expert_confidence (always/usually/sometimes/not_sure/not_stated), **source_person_id** (credited by name), source_kind, source_interview_id, created_by, approved_by, approved_at (real), approved_on (demo clock), approval_mode (self/on_behalf), review_notes, search_text, search_tags, script_key, classification |
| `card_links` | card → exactly one of job / quote / part / machine / material / customer / person (CHECK), mention (the expert's words), link_basis (session_context / mentioned_candidate / seed) |
| `card_topics` | card ↔ topic (≤ 3 per card; drives coverage) |
| `card_tags` | card ↔ tag |
| `card_evidence` | card → interview turn (must be an **expert** turn), start_char, end_char, quote (exact substring) — every card has ≥ 1; `confidence_evidence` flag marks the span supporting a stated confidence |

**Interviews, transcripts, consent (3)**

| Table | Key columns |
|---|---|
| `interviews` | id `INT-01…08`, **`INT-LIVE-RAY` reserved**, `INT-M-PER-0n` (hidden manual-entry sessions), title, mode (full_interview / quote_reasoning_log / manual_entry), plan (`generic` / `quote_anchor`), expert_person_id, run_by_persona_id, topic_id, context quote/job/part/customer, status, phase, tracker_state (json), speech_engine, `audio_retained` (CHECK = 0), script_key, off_script flag, classification |
| `interview_turns` | id `<interview>-T001`, seq, speaker (interviewer/expert/system), phase, move (INCIDENT, NOVICE_GAP, TEACH_BACK, CLARIFY_NUMBER, ASK_EXCEPTION…), text, text_source (typed/voice/simulated/template/llm/seed), classification |
| `consent_records` | interview_id, person_id, consent_text_version, consent_text_sha256, speech_engine_disclosed, ai_mode, target_class, endpoint_host, granted, granted_at, recorded_by_persona_id, mode (self/on_behalf), revoked_at |

**Documents, training (8)**

| Table | Key columns |
|---|---|
| `documents` | id `DOC-SS-01…25`, **`DOC-SS-LIVE` reserved**, `DOC-101+`; kind (setup_sheet / work_instruction / onboarding_checklist), title, status (draft / expert_review / approved / superseded), version, machine/part/job/for_person, reviewer_person_id, generated_by (seed/ai/manual/assembled), body (json `DocBody`: sections → lines, each with cited card IDs), body_md, program_refs[] (setup sheets cite CAM program numbers, not speeds/feeds), approval fields, script_key, classification |
| `document_cards` | document ↔ card at a pinned card_version, section, sort |
| `quizzes`, `quiz_questions`, `quiz_question_cards` | quiz status (draft / approved), item_type (apply / boundary / spot_cue / novice_trap / rank), scenario, choices, answer_key, rubric (criteria with card_id + evidence quote), primary_card_id, generated_by (seed/ai/assembled), classification |
| `quiz_attempts`, `quiz_answers`, `training_progress` | attempts, per-criterion grades (correct/partial/incorrect/**unclear**), graded_by (code/llm/seed), mastery per (trainee, card) |

**Ask the Shop and captures (3)**

| Table | Key columns |
|---|---|
| `ask_threads` | id, actor_person_id, mode at creation, classification (max over turns), created_at |
| `ask_messages` | thread_id, seq, role (user/assistant), text (local only; the audit keeps the redacted copy), pinned refs, sources (S# → record map), audit_id, classification |
| `captures` | kind (voice/note/photo), machine_id, job_id?, text, media_asset_id?, status (pending_review/approved/rejected), reviewer_person_id, classification |

**Privacy and system (6)**

| Table | Key columns |
|---|---|
| `ai_audit_log`, `event_log` | see [§4.7](#47-audit-log) |
| `redaction_tokens` | token, kind, entity_id?, real_value (**never logged, never routable**), scope, created_at — for regex hits and free names; entity tokens are computed from the HMAC rule |
| `app_settings` | key → json value (`ai_routing`, `demo.epoch`, …) |
| `media_assets` | photos only (no audio, ever): file path under `data/uploads/`, sha256, size, links, classification |
| `coverage_snapshots` | baseline written at seed so the Risk Map can show deltas since reset |

### 5.3 Full-text search
- Custom migration `drizzle/0001_fts.sql` creates `cards_fts(card_id UNINDEXED, title, body, tags)` and `quotes_fts(quote_id UNINDEXED, title, body, tags)` with `tokenize='porter unicode61 remove_diacritics 2'`, kept in sync by `AFTER INSERT/DELETE/UPDATE OF search_*` triggers; `rebuildFts()` runs at the end of every reset.
- **User text is always sanitized before `MATCH`** — the demo question itself (`thin-wall`) and `Ti-6Al-4V` throw `no such column` if passed raw (verified). Tokenize to letters/digits, drop stopwords and 1-char tokens, quote each, join with OR; expand synonyms (`ti` → titanium, 6al4v…) from `seed-data/taxonomy/search-synonyms.yaml`, material aliases and tag synonyms.
- Ranking `bm25(cards_fts, 0, 10, 1, 5)` plus tag/entity boosts; results joined back to base tables filtered by `status='approved'` and role visibility. The withheld notice counts only the **budgeted** records not cleared for the target (P4), never the whole excluded match set.

---

## 6. Knowledge risk: taxonomy, coverage and risk math

**Topics (28 rows):** 7 processes (thin-wall & low-rigidity parts; quoting & estimating judgment; 5-axis setups & workholding; tight tolerance & thermal control; first article (AS9102) & CMM inspection; heat treat, finishing & outside processing; CAM programming & toolpath strategy), 8 machines, 7 materials, 6 customers. **Holders:** the 8 people. Trainee training progress is a separate "knowledge transfer" metric; it never makes a trainee a holder.

**Inputs:** `E(p,t)` = SME-seeded tacit level 0–3 (0 none · 1 working · 2 independent, can teach basics · 3 deep, the go-to person); approved cards credited to `p` and tagged with `t`. Only **approved** cards count; drafts show as a hatched "pending" increment.

```
w(c)        = TYPE_WEIGHT[type] × CONF_WEIGHT[confidence]
              TYPE_WEIGHT: quoting_rule, failure_story 1.0; others 0.8
              CONF_WEIGHT: always/usually 1.0, sometimes/not_stated 0.75, not_sure 0.5;
                           failure_story always 1.0 (stories are events, not rules)
C(p,t)      = Σ w(c) over approved cards by p tagged t           f(p,t) = E=0 ? 0 : min(1, C / (K·E)),  K = 4
m(p)        = whole months DEMO_TODAY → planned departure        U(p) = no date ? 0.25 : clamp(1 − (m−12)/48, 0.25, 1)
y(p)        = years at Ridgeline                                  T(p) = 0.6 + 0.4·min(1, y/30)
B(p,t)      = best backup level among others                     D(p,t) = 1 − 0.6·min(1, B/E)
risk(p,t)   = round(100 × (E/3) × (1 − f) × U × T × D)            0–100; bands: high ≥ 50 · elevated 35–49 · watch 20–34 · low < 20
Coverage(t) = 100 × Σ_p min(E, C/K) / Σ_p E                        (expertise-weighted captured share)
SPOF(t)     = the p with E = 3, B ≤ 1, E/ΣE > 0.5 and f < 0.5
Person "deep coverage" = captured share over the topics where E(p,t) = 3  ← the "coverage score" demo step 5 points to
```

Constants live in `src/lib/coverage/params.ts`; one `monthsBetween()` is used for both display and `m(p)`. The UI labels scores "estimate" and shows the inputs on click (the departure factor is hidden from machinist and trainee roles). It is a transparent heuristic, not a validated instrument.

**Seeded matrix** (full 28 × 8 table in [Appendix A](#appendix-a--golden-test-inputs) and `seed-data/expertise-matrix.csv`): Ray is level 3 on titanium, thin-wall, quoting, Inconel 718 and Aerovance. Titanium and thin-wall are the only level-3 cells with a > 50 % share and **only level-1 backups**, so the SPOF rule flags exactly two cells — **Ray × Titanium and Ray × Thin-wall**. Every other level-3 cell (including Ray × Quoting, where Tomás is level 2) has a level-2 backup. With retirement in 20 months (U = 0.83), no non-Ray cell can exceed 25.

**Golden numbers** (verified by script from Appendix A):

| | Before step 2 | After Ray approves KC-091…094 |
|---|---|---|
| Ray × Titanium risk | **57 (High)** — E 3, f 15 % | **41 (Elevated)** — f 38 % |
| Ray × Thin-wall risk | **57 (High)** | **41 (Elevated)** |
| Ray × Quoting risk | 30 (Watch) | 26 (Watch) |
| Titanium topic coverage | **14.0** | **28.0 (+14.0)** |
| Thin-wall topic coverage | **13.0** | **27.0 (+14.0)** |
| Ray deep coverage | **18.2 %** | **32.2 % (+14.0)** |
| Ray's top risk | Ti / thin-wall (57) | Inconel 718 (46) → "Suggested next interview" |

Step-5 talking point: *"Ray's new rule mentions Inconel 718, but it's filed under thin-wall, titanium and quoting, so the Inconel row hasn't moved yet — his Inconel setup and inspection knowledge is the next interview."* Golden tests assert these numbers, the SPOF set before and after, and that pending cards never change coverage. If an SME edit breaks them, `seed:check` reports a **demo invariant** error naming the cell.

---

## 7. Seed data

### 7.1 Folder (one place for all domain content)

```
seed-data/
  README.md                    how to edit, ID rules, "run npm run seed:check", field glossary
  NAMES.yaml                   every fictional company/person/part-number prefix + collision-check date and result
  shop.yaml                    shop profile, DEMO_TODAY 2026-09-15, SEED, fictional notice
  people.yaml  personas.yaml  machines.yaml (+ machine events)  materials.yaml
  customers.yaml               6 customers, each with quirks + role-hidden `account:` block
  expertise-matrix.csv         28 topics × 8 people, levels 0–3 (opens in Excel; BOM and ';' tolerated; instructions in README.md)
  taxonomy/                    topics.yaml, tags.yaml, search-synonyms.yaml
  parts/                       anchors.yaml (12 demo parts), internal.yaml (4), families.yaml (generator templates → 44, plus each customer's quote total)
  quotes/                      anchors.yaml (14 quotes + anchor jobs, pricing, debriefs), internal-work-orders.yaml, quote-model.yaml
  cards/                       90 cards, one YAML file per contributor (PER-01-ray-delgado.yaml …)
  interviews/                  8 transcripts, Markdown + frontmatter, ~30–45 turns each (## T001 expert …)
  quote-logs/                  3 short Quote Reasoning Logs
  documents/setup-sheets/      25 setup sheets, Markdown + frontmatter (DocBody sections)
  training/                    quizzes.yaml, attempts.yaml (Phase 6)
  audit/history.yaml           ~20 historical audit rows (Phase 3; tokenized; includes withheld and blocked examples)
  demo/                        anchors.yaml (manifest + invariants), ray-live-interview.yaml (scripted answers,
                               expected cards with pinned type/confidence/topics/links)
  demo-cache/                  replay cassettes (tokenized YAML with provenance), see §11.4
```

`.gitattributes` forces LF for `seed-data/**`, and the loader normalizes CRLF→LF and Unicode NFC (e.g. "Tomás"); otherwise a Windows checkout would shift evidence offsets and change hashes.

### 7.2 The fictional cast (*ASSUMPTION*)

| ID | Name | Role (app_role) | Hired (tenure at DEMO_TODAY) | Planned departure |
|---|---|---|---|---|
| PER-01 | **Ray Delgado** | Lead Quoter / Estimator (quoter) — ran the first 5-axis for 12 years before moving to quoting | 1995-06-05 (31.3 y) | **retirement 2028-05-15 (20 months)** |
| PER-02 | Marv Tollefson | 5-Axis Lead (machinist) | 2000-08-14 (26.1 y) | — |
| PER-03 | Linda Marchetti | Quality Manager (machinist) — owns AS9102 and the CMM | 2004-03-01 (22.5 y) | retirement 2029-11-15 (38 mo) |
| PER-04 | Tomás Ibarra | Lathe Lead (machinist) — Swiss, mill-turn, Inconel rings; quotes turned work | 1999-01-11 (27.7 y) | retirement 2031-01-15 (52 mo) |
| PER-05 | **Maya Chen** | Quoter (quoter) | 2026-01-12 (8 mo) | — |
| PER-06 | Devin Okafor | Setup Machinist (trainee) | 2026-03-09 (6 mo) | — |
| PER-07 | Priya Raman | CMM Inspector (trainee) | 2025-10-13 (11 mo) | — |
| PER-08 | Jonah Pruitt | CAM Programmer (machinist) | 2025-07-14 (14 mo) | — |
| P-OWNER | Dana Whitcomb | Owner / GM (owner) — persona-only, not a knowledge holder | — | — |

A web check found no prominent real person in manufacturing/aerospace/defense/quality with any of these names.

**Customers** (part-number patterns feed the redactor and validator):

| ID | Name | Industry | Parts / quotes | Part floor | Pattern |
|---|---|---|---|---|---|
| CUS-01 | **Aerovance** *(brief; see Q4 — a real AS9120B aerospace parts distributor is named AeroVance)* | aerospace — aerostructure brackets and fittings | 14 / 32 | customer_confidential | `AV-####-##` |
| CUS-02 | Halvorsen Flight Controls | aerospace — actuation housings | 9 / 20 | customer_confidential | `HFC-#####` |
| CUS-03 | Sutrella Surgical *(was "Lumacor", a real coating product)* | medical — 316L instruments, PEEK | 8 / 16 | customer_confidential | `SUR-###-###` |
| CUS-04 | Quantrel Semiconductor Equipment | semiconductor — 6061 chamber parts, PEEK insulators | 9 / 20 | customer_confidential | `QRL-######` *(not `QSE-`, a real connector series)* |
| CUS-05 | Graymoor Defense Systems | defense — 17-4 manifolds, 7075 housings | 9 / 20 | **export_controlled** | `GDS-####-###` |
| CUS-06 | Velmont Guidance Systems *(was "Stellan", one letter from a real defense company)* | defense & space — Ti and In718 housings; new customer (Nov 2025) | 7 / 12 | **export_controlled** | `VLM-#####` |

Every fictional name and prefix is recorded in `seed-data/NAMES.yaml` with its check date and result; `seed:check` fails if a customer or shop name is missing from it. The shop name "Ridgeline Precision" (brief) also collides with real CNC businesses — see Q4. Until you decide, both brief-mandated names are always shown with "(fictional)".

**Machines** (*ASSUMPTION for the unnamed models*): Haas VF-4 (`m-vf4`, bought used 2011), Haas ST-20, DMG MORI DMU 50, Okuma GENOS M560-V, Mazak INTEGREX i-200, **Citizen Cincom L20** (Swiss), **ZEISS CONTURA** (bridge CMM), **Mitsubishi Electric MV2400R** (wire EDM). Two `machine_quirk` cards per machine, always written as *this unit's* history (asset tag, dates, what we saw, what we do) — never a manufacturer or model-wide claim; `seed:check` lints for defect/recall language.

**Materials:** 6061-T6, 7075-T651, 17-4 PH, 316/316L, Ti-6Al-4V (Grade 5), Inconel 718, PEEK — with aliases for search.

### 7.3 Counts and mix

| Records | Count | Classification mix (general / internal / cust. conf. / export ctrl.) |
|---|---|---|
| Parts | 60 (12 anchor + 44 generated + 4 internal) | 0 / 4 / 41 / **15** |
| Quotes | 120 (won 70, lost 42, no-bid 5, pending 3) | 0 / 0 / 90 / **30** (Graymoor 18, Velmont 12) |
| Jobs | 74 (66 complete with actuals, 4 in process, 4 internal) | 0 / 4 / ≈52 / **≈18** (follows which generated export-controlled quotes are won; the Phase 1a seed gives 53 / 17) |
| Knowledge cards | 90 (quoting_rule 18, setup_tip 20, machine_quirk 16, customer_quirk 14, inspection_gotcha 12, failure_story 10; approved 80, pending_review 6, draft 2, rejected 2) | 14 / 38 / 26 / **12** (the 14 general cards are machine quirks with no customer/part/job/quote link or mention) |
| Setup sheets | 25 (approved 20, expert_review 3, draft 2) | 0 / 10 / 10 / **5** |
| Interview transcripts | 8 (Ray ×2, Marv ×2, Linda ×2, Tomás ×2; ~32 cards carry real evidence spans) | 0 / 3 / 3 / **2** |

- Card link rules (`seed:check`, applied to seeded cards **and** to the expected scripted cards in `ray-live-interview.yaml`): every quoting_rule, setup_tip, failure_story and inspection_gotcha links at least one job or quote; every setup_tip and machine_quirk links a machine; every customer_quirk links a customer. Generic cards without a job are allowed only for customer_quirk and machine_quirk (*ASSUMPTION*).
- Ray deliberately has **no** titanium or thin-wall interview yet — his Ti cards come from "the binder" (hand-entered). That's what makes the live interview meaningful.
- The 2 non-export-controlled Graymoor quotes both belong to PRT-A09 (pinned).

### 7.4 Quoted-vs-actual variance (clusters where judgment matters)
Each won job: `v = μ + σ·z` with `μ = base + Σ driver means`, drivers = thin_wall, titanium, inconel, five_axis, tight_tolerance, new_customer, first_article; jobs **quoted by Ray** get `μ × 0.35`, `σ × 0.6` (he prices the judgment in). Clamp to [−25 %, +90 %]; round actuals to 0.5 h. Expected: routine jobs ≈ ±5 %; thin-wall Ti not quoted by Ray ≈ +20 %; the same work quoted by Ray ≈ +7 %. `seed:check` prints the table and **fails if judgment-heavy non-Ray variance is under 2.5× the routine mean.** Generator knobs (setup hours by machine kind, cycle minutes by family, material time factors, shop rates, win odds) live in `seed-data/quotes/quote-model.yaml` as SME-reviewable starting points.

### 7.5 Determinism and validation
- **Clock:** `DEMO_TODAY = 2026-09-15T12:00:00Z` from `shop.yaml`; seeded dates are relative to it; tenure/retirement/risk math and KPI windows use `getDemoToday()`; domain records created at runtime use the demo clock ([§5.1](#51-conventions)). The header shows "Demo date: Sep 15, 2026".
- **PRNG:** mulberry32 with a **per-record sub-seed** `fnv1a32("${SEED}|${recordId}|${stream}")`, so editing one record never reshuffles others. Display uses `en-US` + `timeZone: 'UTC'`; canonical JSON for hashes.
- **`npm run seed:check`** (safe while the server runs; touches no DB): zod schema per file with `file:line` errors in plain English; cross-file checks — unique IDs, FKs resolve, part numbers match the customer pattern, evidence quotes are exact substrings of an expert turn, **numeric claims match the evidence after spoken-number normalization** (same code as the traceability gate, [§8.2](#82-ai-interviewer-and-quote-reasoning-log)), card link rules, ≤ 3 topics per card, classification ≥ derived floor (including entities mentioned in text), reserved IDs absent, anchors present with pinned values, golden coverage invariants, similar-jobs invariant, variance clustering, names present in `NAMES.yaml`. Warnings: count drift, machine-quirk wording, numeric speeds/feeds in setup sheets, `$` amounts in card/transcript text. On success it writes `data/seed-bundle.json` — the last *valid* bundle, which the Reset button replays, so a half-edited YAML file can't break a reset in front of a prospect.
- **`npm run seed:lock`** rewrites `seed-data/seed.lock.json` after a successful check; commit it with any intentional seed edit (the determinism test and preflight compare against it and name this command when it's stale).

### 7.6 Demo-critical anchors (pinned in `seed-data/demo/anchors.yaml`)

| ID | What | Used in step |
|---|---|---|
| PER-01 Ray, PER-05 Maya, CUS-01 Aerovance | cast | all |
| PRT-A01 / **Q-A01** | Aerovance `AV-2231-07` rev C "Bracket, fuel line support", Ti-6Al-4V, **min wall 0.035 in**, wall height 1.60 in, 5-axis, first article. **The recent quote Ray is interviewed about:** qty 24, quoted by Ray 2026-09-11, 58.0 h, pending, primary machine DMU 50 | 2, 4 |
| **J-A02** | Similar job 1 — Aerovance Ti sensor-mount bracket, Ray: quoted 32.0 h, actual 33.5 h (+4.7 %) | 3 |
| **J-A03** | Similar job 2, **the job that went sideways** — Aerovance Ti **duct support bracket**, April 2026, qty 12, quoted by **Maya during Ray's leave**: 27.0 h → 41.5 h (+53.7 %), 4 scrapped (walls moved after unclamping), 1 NCR. Pinned mention: "duct support bracket in April" → J-A03 | 2, 3 |
| **J-A04** | Similar job 3 — Aerovance Ti harness-clip bracket, Ray: 44.0 h → 42.5 h (−3.4 %) | 3 |
| J-A06 | Velmont Ti thin-wall housing, `itar`, **export_controlled** — ranked **4th** for Maya's question, so it is the one withheld job in step 3 and is included in the local re-run | 3, 6 |
| **J-A10** | **The export-controlled job for step 6c** — job RJ-26-0310, Graymoor `GDS-4410-120` hydraulic manifold, 17-4 PH, `itar`: 96.0 h → 118.5 h (+23 %), linked to two export-controlled cards | 6 |
| J-A09 | Graymoor commercial spare (PRT-A09, exactly 2 quotes), classification overridden **down** with a logged reason | — (Privacy page example) |
| KC-001…012 | Ray's existing cards (KC-001…003 on Ti / thin-wall / Aerovance approved; KC-011/012 pending review) | 1, 3 |
| **KC-091…094, INT-LIVE-RAY, DOC-SS-LIVE** | Reserved IDs created only by records with `script_key='demo:ray-live'`; restarting the scripted interview deletes and recreates them and cascades to anything referencing them (document links, quiz items, training progress, Ask sources) | 2–5 |
| DOC-SS-05 | An approved DMU 50 setup sheet | — (machine page reference) |

**Retrieval invariants:** from Phase 1 (`seed:check`), for Maya's question the similar-jobs scorer ranks J-A02, J-A03, J-A04 at 1–3 and J-A06 at 4 over all role-visible completed jobs. From Phase 4 (when the retriever exists), the budgeted Ask context (8 cards + 4 jobs) contains exactly one export_controlled record (J-A06) and no export_controlled card. The generator's `reserved_combinations` keep other Aerovance thin-wall Ti brackets out of the data.

### 7.7 Reset (`npm run seed` and the in-app **Reset demo**)
One synchronous `IMMEDIATE` transaction shared by both: archive `transport='live'` audit rows, delete all rows child→parent, reset `sqlite_sequence`, reinsert the bundle parent→child in chunks (FTS refilled by triggers, then `rebuildFts()`), clear the in-app `ai_routing` setting, write coverage baselines, write a `demo_reset` event, then `wal_checkpoint(TRUNCATE)`. WAL + 5 s busy timeout make it safe while `next dev`/`next start` holds the DB (research measured 5,000 rows in ~13 ms under 40 concurrent reads, with readers seeing all-old or all-new). `demo.epoch` increments so in-flight AI streams skip their final writes. Uploaded photos not in the bundle are removed after commit. **Never delete the `.db` file while a server runs** (Linux keeps writing the deleted copy; Windows refuses); `npm run db:nuke` requires the server stopped and says so.

---

## 8. Core modules

### 8.1 Knowledge Risk dashboard (`/risk`)
- Heat map: topics (rows) × the 8 holders (columns, sorted by risk contribution so Ray is first). **Rows default to "highest risk first"** (so both High rows sit at the top at 1280×720), with a category-grouping toggle and category tabs; compact rows when the viewport is ≤ 800 px tall. **Cell fill = `risk(p,t)`** on a single-hue sequential ramp with the number printed; a view toggle switches the cell metric to **Expertise** (tacit level) or **Captured %**. Right-hand columns: topic Coverage (bar) and topic Risk band chip with a "Single point of failure" flag.
- Column headers: name, tenure, and (owner/quoter only) a "⌛ Retires in 20 mo" chip.
- KPI row: topics at high risk; single points of failure (for owner/quoter the tile adds the holder and departure, e.g. "2 — both Ray Delgado, retiring in 20 months"); holders departing within 24 months (owner/quoter only); cards approved in the last 30 demo-days.
- Click / Enter on a cell opens a sheet: explanation ("Ray holds deep titanium knowledge · 2 approved cards · 15 % captured"), the inputs behind the score (departure factor hidden for machinist/trainee), approved cards, pending drafts count, **Interview Ray**, **Open in Library**.
- Delta mode vs the seeded baseline: changed cells get an orange ring and a **signed delta of the active metric** (e.g. `−16` risk); the Coverage column and person deep coverage show `+14`. Numbers count up (900 ms; `prefers-reduced-motion` respected); Before/Now toggle.

### 8.2 AI Interviewer and Quote Reasoning Log

**Architecture — code picks the move, the model only phrases it.**
1. After each expert turn, a **tracker** call (structured output) updates per-rule slots: condition, exception, rationale, cue, action, number, novice error, confidence — **every slot value must be a verbatim expert span** (validated like evidence). It also flags vague terms ("thin", "a lot"), judgment markers ("went sideways", "gut"), contradictions, sensitive mentions, and expert signals (done / asks the AI for the answer / stop).
2. A deterministic TypeScript **plan** decides the next move:
   - `quote_anchor` plan (quote-anchored sessions, including the scripted one): **anchor** (Quote Log Q1 template built from the quote record) → **INCIDENT** → **NOVICE_GAP** → **TEACH_BACK** → wrap, with a follow-up budget of 3; slot moves are deferred to the teach-back correction.
   - `generic` plan: consent → scope → task map (ACTA) → INCIDENT (CDM sweep 1) → timeline (sweep 2) → deepen (sweep 3 + knowledge audit + laddering; ≤ 3 decision points) → what-if (sweep 4) → NOVICE_GAP → **TEACH_BACK (mandatory before extraction)** → wrap. Inside phases, first match wins: CLARIFY_NUMBER → ASK_WHY (ladder up) → ASK_CONDITION → ASK_EXCEPTION → ASK_HOW_TELL (ladder down) → SURFACE_CONFLICT (neutral) → PROBE_MARKER → next unused knowledge-audit probe (noticing, job smarts, anomalies, equipment difficulties, past & future, big picture, self-monitoring, improvising). End conditions: phases done, budget (≈ 30 expert turns), saturation (3 turns with nothing new), or the expert stops.
   - Guardrails in both plans: stop → wrap; "asks the AI for the answer" → "I don't know your shop — what would you do?"; a P3 floor above the provider's clearance pauses the session and re-routes. The tracker's own sensitive-mention output is after-the-fact (it has already been sent): it raises the session classification for later calls and writes a `possible_controlled_content_sent` event.
3. An **interviewer** call phrases the move as one open question (≤ 30 words, not yes/no, not double-barreled, no praise or technical agreement, reuses the expert's words, no presupposition). The **lexical-novelty check** (`interview/novelty.ts`) takes the question's content tokens (stopwords removed, lemmatized with an irregular-verb map), and rejects any token not found in: prior turns, the serialized record fields actually in the prompt (including feature tags such as `thin_wall`), the move's probe template, or a general-English allowlist shipped as data (`src/lib/interview/data/english-allowlist.txt`, no domain terms). After two failures the template is used verbatim. Teach-back is a template filled from slot values, so it can only use the expert's words; the one allowed transform is lemma-level re-inflection of a span ("priced in" → "price in"), which the novelty check verifies.

**Teach-back** is the reversed AHRQ pattern: the AI states *"When {conditions}, {action}, because {rationale} — except when {exception}. What did I get wrong or leave out?"* and the expert corrects it.

**Quote Reasoning Log** (~3 minutes after a quote is saved; ≤ 2 clarifiers total): main driver · why this machine · where the hours came from · what risk was priced in and where it went (hours / setup / scrap allowance / inspection / outside processing) · what would change the price · what a newer quoter would miss · confidence 1–5. When actuals land, a one-question variance review ("Actual came in at 41.5 h vs 27 h quoted — was it the risk you priced in?").

**Extraction.** Before `card_extract`, a deterministic **candidate-records** step resolves records the expert mentions (e.g. "the duct support bracket in April" → the session customer's job whose part description and month match → J-A03) and sends them as `S#` sources. Extractor output (zod schema → JSON schema) includes title, type, statement, applies_when, does_not_apply_when, rationale, cues, actions, common_mistake, thresholds (verbatim + normalized, e.g. "forty thou" → 0.040 in), expert_confidence, links (as `S#` keys), topics (from the taxonomy enum), tags, evidence spans, open questions.

**Traceability gate** (server-side; rejects, doesn't warn):
- Every card has ≥ 1 evidence span that is an exact substring of an **expert** turn; `threshold.verbatim` is an exact substring.
- **Numeric claims** are extracted from title, statement, actions and conditions — skipping digits inside dictionary entities, material names, machine names and record IDs (`Ti-6Al-4V`, `Inconel 718`, `AV-2231-07`) — and each must equal a normalized number in the cited evidence. `interview/numbers.ts` normalizes spoken forms: number words, "N thou" → N/1000 in, "N percent" → N %, "N of the M" → N/M, "N times" → N×, "N hours" → N h.
- **Links** are allowed only if the record is session context (the anchored quote, its part, customer and primary machine) or its mention is an exact expert-turn substring **and** the record was sent as a candidate source.
- **Topics** must be supported: a material topic needs a material mention in the card or the material of a linked job/part/quote; a customer topic needs a customer link; a machine topic needs a machine link (session context counts for both); a process topic needs a mapped tag or the session topic; at most 3.
- A confidence other than `not_stated` needs an evidence span that states it.
- Card extraction is **never** scenario-replayed in DEMO_MODE ([§11.1](#111-replay-design-demo_modetrue)).

**Approval.** Cards are drafts until the **source expert** approves (owner may approve "on behalf" with a logged reason; the card shows it). Editing an approved card creates a new version back in review. Only approved cards feed Ask the Shop, Training and coverage.

### 8.3 Knowledge Library (`/library`)
FTS search with facets (type, machine, material, customer, contributor, status, classification). Card page: statement, applies/doesn't apply, thresholds (verbatim next to normalized), evidence quotes linked to the transcript turn, links to person / job / machine, **"Contributed by Ray Delgado"** credit, version history, status timeline. Drafts carry "Draft — awaiting {name}".

### 8.4 Ask the Shop (`/ask`)
- **Chat threads:** each follow-up re-runs retrieval; the thread's floor = max(prior turns' floors, new text); prior assistant turns are re-sent redacted; the thread badge shows the highest classification. "Re-run" re-asks a question as a new thread under the current mode.
- **Retrieval:** FTS + tags + synonyms + entity boosts; budgeted context = top 8 approved cards + top 4 similar jobs (classification-blind); withheld = budgeted records not cleared (no backfill).
- **Similar-jobs scorer** (`retrieval/similar-jobs.ts`, pure; built in Phase 1 so its invariant can be checked early): completed jobs only; query features come from pinned records, or are parsed from the question (`query-features.ts`: entity detection → customer, material, features, part family); weighted overlap on customer, material, features, family and wall/complexity bands. The **panel** shows the top 3 jobs cleared for the active target with quoted vs actual bars and variance, plus the collapsed "not sent" row ([§4.4](#44-routing-policy)).
- Answer streamed with inline citation chips `[Ray Delgado · KC-091]` (hover: card summary and approval date). Withheld/blocked/held notices, routing chip, "Create setup sheet from these cards". Deterministic offline fallback when there's no model: "Most relevant approved cards" with citations, clearly labelled.

### 8.5 Document Generator (`/documents`)
Setup sheets, work instructions and onboarding checklists generated from selected approved cards (plus part/machine records). Every line cites its card(s); classification = max of sources. Status flow **draft → expert review → approved** (reviewer can send back); the reviewer defaults to the source expert of the majority of cited cards. Deterministic "assembled from cards (no AI)" fallback. Print view: classification banner top and bottom, "DRAFT — NOT APPROVED FOR PRODUCTION" watermark until approved, numbered citation footnotes, approval block, fictional footer. Setup sheets reference CAM program numbers rather than stating speeds and feeds (*ASSUMPTION*).

### 8.6 Machine pages (`/machines/[id]`)
Mobile-first: quirks (this unit's), common setups (setup sheets + setup tips), recent issues (last 90 demo-days of events and failure stories), captures, QR code. Sticky bottom capture bar — **Photo**, **Voice note**, **Note** — with 88 px buttons. The capture sheet asks "Which job is this?" (defaulting to the job in process on that machine) and sets the classification ([§4.3](#43-data-classification)). Photos: `<input type=file accept="image/jpeg,image/png" capture="environment">` → client resize to 1600 px JPEG → route handler → server `sharp().rotate().resize().jpeg()` (strips EXIF/GPS) → `data/uploads/`, served through an authorized route with `Cache-Control: private, no-store` (not `next/image`, whose cache would survive "full delete"), never sent to a model in v1. Voice notes follow the speech policy (on-device or typing by default). Captures go to the expert's review queue; they aren't cards until approved. Printable 4 × 2 in QR label per machine and an 8-up label sheet; QR encodes `${PUBLIC_BASE_URL}/machines/<id>`.

### 8.7 Training (`/training`)
Quizzes generated **only from approved cards**, filling a card's conditions with seed records passed as pinned references: *apply*, *boundary* (an exception holds → "rule doesn't apply"), *spot the cue*, *novice trap* (distractor = the card's common mistake), *rank* (ShadowBox-style). A **quiz traceability check** maps every factual token in an item and its answer key to card fields or seed records; quiz sets go draft → approved by the source expert. A deterministic fallback builds apply/boundary/novice-trap items straight from card fields (used on a DEMO_MODE cache miss). Multiple-choice and rank items are graded by code; free-text grading (live mode) returns met / not met / **unclear** per criterion — "unclear" never counts against the trainee and goes to an "Ask Ray" queue. Mastery = correct on 2 distinct scenarios including a boundary item. Progress matrix (trainee × card) for the owner; each trainee sees their own progress. Feedback quotes the card: "From Ray Delgado's card…".

### 8.8 Privacy & Deployment (`/privacy`)
Active mode explained in plain words; the classification × provider matrix rendered from `policy/matrix.ts`; deployment options (Anthropic API, Bedrock commercial incl. what "global cross-region" means, Bedrock GovCloud allowlisted, local Ollama, hybrid) with a simple diagram; redaction explainer with its limitations; speech policy; CUI labelling guidance; covered-model retention notes; "every persona can view export-controlled records in this demo; a real deployment must limit them to authorized U.S. persons"; "Reset demo erases the demo audit log (live-call rows are archived first)"; **Full export** (streamed SQLite online backup + JSON dump + uploads, owner only, `no-store`, warns that it contains real names from the token table) and **Full delete** (typed confirmation; delete in place → `VACUUM` → `wal_checkpoint(TRUNCATE)` → purge uploads and any staging, while the server keeps running; then offer Reset demo).

**Copy rules and vendor statements**
- Lead: *"Floorwise is designed to support shops that handle controlled information: you label records, a policy decides which AI provider may see them, and every AI call is logged. Using Floorwise does not by itself make a shop ITAR, EAR, DFARS or CMMC compliant. Floorwise is demo software and has not been assessed for ITAR, CMMC, FedRAMP or NIST SP 800-171."*
- Never "ITAR compliant", "CMMC ready", "FedRAMP authorized", "guarantees", or "data never leaves" unless technically true in the current mode.
- Verified quotes, each with its link and "last reviewed 2026-09-28": Anthropic API retention page — "Retained data is never used for model training without your express permission."; Anthropic Commercial Terms — "Anthropic may not train models on Customer Content from Services." Inside the **GovCloud card only**: Anthropic Public Sector FAQ — "ITAR data can only be processed in Claude via AWS Bedrock, which is IL5 accredited." immediately followed by the same FAQ's "FedRAMP and DoD Impact Levels are certifications for cloud services (IaaS, PaaS, SaaS). AI models are software components, not cloud services…" and *"Which Claude models are authorized for your workload in AWS GovCloud (US) is set by AWS; check AWS's FedRAMP services-in-scope list. Claude Sonnet 5.5 was not confirmed in GovCloud as of 2026-09-28."*
- No first-party retention number is stated (sources conflict); link to Anthropic's privacy center instead.
- Regulatory status goes only in a dated "Learn more" drawer: *"Reported 2026-07-13: DoD suspended CMMC Phase 2 pending a Task Force review (last checked 2026-09-28; see dodcio.defense.gov)."* — re-checked on the day-before runbook.

---

## 9. Screens and routes

App shell (`src/app/(app)/layout.tsx`): non-dismissable fictional banner · header (logo, "Ridgeline Precision (fictional)", provider badge, persona switcher, presenter button) · sidebar (icon rail < 1200 px, bottom tab bar < 640 px) · toaster · presenter HUD (DEMO_MODE).

| Route | Purpose | Roles |
|---|---|---|
| `/` → `/risk` | Knowledge Risk heat map, KPIs, cell sheet, delta mode | all |
| `/people`, `/people/[id]` | Holders, tenure, departure (role-gated), topics held, cards, deep coverage | all |
| `/jobs`, `/jobs/[id]` | Quotes and jobs, quoted vs actual, variance, win/loss, reasoning log, **"Ask the Shop about this job"** (pins the job) | all; prices owner/quoter |
| `/machines`, `/machines/[id]`, `/machines/[id]/print`, `/machines/labels` | Machine pages, capture, QR labels | all; capture machinist+ |
| `/library`, `/library/[cardId]` | Knowledge Library | all |
| `/interview`, `/interview/new`, `/interview/[id]`, `/interview/[id]/review` | Interviews, Quote Reasoning Log, consent gate, method tracker, review & approve | owner, quoter, machinist; review = source expert |
| `/review` | "My reviews" inbox (cards, documents, captures, quiz sets) | all |
| `/ask` | Ask the Shop (threads) | all |
| `/documents`, `/documents/new`, `/documents/[id]`, `/documents/[id]/print` | Document Generator | generate: owner/quoter/machinist |
| `/training`, `/training/[quizId]`, `/training/progress` | Quizzes and progress | all (own progress); progress matrix owner |
| `/audit` | Audit log viewer + export | owner all; others own rows |
| `/privacy` | Privacy & Deployment | view all; full export/delete owner |
| `/settings` | Mode and cloud-provider picker, provider details (no secrets), **Send test prompt**, Ollama health / warm, Bedrock allowlist status, `PUBLIC_BASE_URL` | owner (any persona with `DEMO_OPEN_CONTROLS`) |
| `/demo` | Presenter page: script, preflight, Reset, `DEMO_LIVE_LOCAL` toggle, shortcuts, cassette log | DEMO_MODE |

Route handlers: `POST /api/ai/[task]`, `POST /api/ai/preview`, `GET /api/health`, `POST /api/health/warm`, `POST /api/audit/export`, `GET /api/export`, `POST /api/uploads`, `GET /api/uploads/[id]`. Server Actions (every mutation is one, role-checked inside): `setPersona`, `setAiRouting`, `setDemoLiveLocal`, `resetDemo`, `prepareDemoStep`, `restoreScriptedReplies`, `recordConsent`, `withdrawConsent`, `approveCards`, `requestCardChanges`, `editCard`, `overrideClassification`, `addRedactionAlias`, `sendDocumentForReview`, `returnDocument`, `approveDocument`, `reviewCapture`, `approveQuizSet`, `submitQuizAttempt`, `fullDelete`.

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
- `ReplayTransport` receives the identical `ProviderRequest` + target descriptor a live adapter would; everything before and after it is the same code.
- **Replay key** = `(task, targetClass, promptVersion, payloadHash)`. Host and model are *not* part of the key (they are cassette and audit metadata), so a different `OLLAMA_MODEL` or base URL doesn't break the demo; a replay recorded on a different model is labelled "recorded on {model}".
- **Lookup order:** (1) exact key; (2) scenario match — interview tracker/phrase tasks by `(scenario, turnIndex, task)`, ask/doc tasks by scenario + Jaccard ≥ 0.6 on the **tokenized**, normalized question — allowed **only when every cited source fingerprint in the cassette is in the current sent set**; (3) Bedrock may use an Anthropic entry (labelled), but **cloud and local entries never stand in for each other**; (4) miss → deterministic offline fallback (Ask: top approved cards with citations; interviewer: probe-bank template; documents: assembled from cards; quizzes: assembled from card fields), labelled on screen and audited as `demo_fallback`. **Card extraction is never scenario-replayed** — only exact matches, else "off-script" (below). `DEMO_MISS=live` calls the provider instead if credentials exist.
- **Cassettes are stored tokenized** (canonical questions too; no cassette contains a seed name) with `provenance: recorded | hand_authored`. Hand-authored entries show **"REPLAY · scripted (not model output)"** in the header and audit, and `demo:verify` warns while any remain in the scripted path. Cloud replays stream the tokenized text so restoration is exercised; local replays are de-tokenized inside the transport to emulate what a live Ollama returns.
- **Latency:** simulated streaming at `DEMO_REPLAY_SPEED` (realistic ≈ 700 ms TTFT for cloud), **capped** at ≤ 2 s for structured tasks and ≤ 8 s total for local answers regardless of recorded timings.
- **Honesty:** the header shows `REPLAY`; audit rows record the transport and provenance; the Ollama badge reads "(not contacted: replay)" unless `DEMO_LIVE_LOCAL=true`.
- **Tools:** `npm run demo:record -- --step 3 --target anthropic|ollama` drives the scripted step through `runAI()` with a live transport (the target is applied as the global mode, so `decide()` still runs) and writes/diffs the cassette in tokenized form. `--author` runs P0–P8 with no transport and writes a skeleton (payload hash, `S#` → record table, rendered redacted prompt) for hand-authoring. `--rekey` recomputes hashes and remaps `S#` keys by fingerprint after seed or prompt edits (failing if a cited source disappeared). `npm run demo:verify` (from Phase 3) replays every cassette in a manifest that each phase extends, under the no-egress preload, and asserts each resolves `demo_replay_exact`; from Phase 6 the manifest covers the whole scripted path.
- **Off-script interview:** in `INT-LIVE-RAY` under DEMO_MODE, if an expert turn differs from the scripted reply (e.g. the real microphone was used), the session is marked off-script, extraction is disabled with "Replies differ from the demo script — extraction needs Live mode", and **Restore scripted replies** is offered. Live voice in the demo is for showing the chip and policy only.
- **Missing prerequisites:** if `/ask` receives the scripted question in DEMO_MODE while KC-091…094 don't exist yet, the HUD blocks with "Step 2 hasn't run — fast-forward it?" instead of replaying an answer grounded in cards that weren't sent.

### 11.2 The six steps

**Pre-demo:** stop any running server, then `npm run demo` (seed → build → `next start -H 127.0.0.1`) or **Reset demo**; `/demo` preflight all green; Chrome desktop at `http://localhost:3000`; persona Owner; mode **Cloud** (the only default that runs this script unchanged — see Q2); DEMO_MODE on. Target: ~11 minutes plus ~2 minutes of slack; **cut first** if short on time: 4b, 6b's panel walk-through, 6c's "Re-run in Local", 6d.

**Step 1 — Risk Map (~1.5 min · Owner · Cloud).** `/risk` opens with Ray's column first: "Ray Delgado · 31 yrs · ⌛ Retires in 20 mo". The Titanium and Thin-wall rows sit at the top (highest risk first) with **High** and a single-point-of-failure flag; KPI tile: "Single points of failure: 2 — both Ray Delgado, retiring in 20 months". Click *Titanium × Ray* (57): the sheet explains why. In DEMO_MODE, the **Interview Ray** button on either Ray × Titanium or Ray × Thin-wall opens the pinned session `INT-LIVE-RAY` (topic `t-thin-wall`, title "Thin-wall titanium quoting", both fixed). No AI call.

**Step 2 — Live interview with Ray (~3 min · persona switches to Ray · Cloud).** "This interview is with Ray Delgado. Switch persona?" → consent gate (engine- and destination-specific copy) → session anchored on **Q-A01**, `quote_anchor` plan. The presenter clicks suggested-reply chips (or presses `n`; optional **Simulated dictation** shows the voice path). The side **Method tracker** fills with Ray's own words — the visual proof that the AI supplies the method and Ray supplies the facts. *Wording and numbers are placeholders for SME review.*

| Turn | Speaker | Text | Move |
|---|---|---|---|
| T0 | AI (template from the quote record) | "Thanks, Ray. You quoted the AV-2231-07 fuel line bracket for Aerovance on Sep 11 at 58 hours for 24 pieces. In one sentence, what drove that number the most?" | anchor |
| R1 | Ray | "The walls. Anything under forty thou in titanium moves on you, so I padded the finish passes, split it into two ops, and priced in a spare blank." | |
| **F1** | AI (phrased, novelty-checked) | "You said titanium under forty thou 'moves on you.' Walk me through the last job where that actually happened." | **INCIDENT** |
| R2 | Ray | "The duct support bracket in April, while I was out. One clamping, rough and finish. When they unclamped, the walls sprang about four thou and four of the twelve failed profile on the CMM. Aerovance won't take rework without their MRB signing off, so we scrapped them. Now I rough, leave twenty thou, unclamp and let it sit, then finish in soft jaws with light passes. Every time now." | |
| **F2** | AI (phrased) | "When a newer quoter picks up a bracket like this, what are they most likely to get wrong?" | **NOVICE_GAP** |
| R3 | Ray | "They take the cycle time the software gives them and stop there. On thin Ti the finish passes run a lot slower, so I add thirty-five percent to finishing. And Aerovance always wants a full first article on every new revision — about three more hours of CMM time and paperwork." | |
| **F3** | AI (template filled from verbatim slots) | "Let me say it back as a rule: anything under forty thou in titanium — add thirty-five percent to finishing, split it into two ops, leave twenty thou, and price in a spare blank, because when they unclamped, the walls sprang. What did I get wrong or leave out?" | **TEACH_BACK** |
| R4 | Ray | "Close. Under forty thou and taller than about ten times the wall — a short thin wall is fine. Same on Inconel 718. On 6061 I don't bother. That one's always." | |
| T5 | AI (template) | "Got it — I've added the height limit, Inconel 718 and the 6061 exception. I'll draft cards for you to review." | wrap |

**Draft cards** (≈ 2 s) → four cards, each passing the traceability gate (pinned in `seed-data/demo/ray-live-interview.yaml`):

| Card | Type · confidence | Title | Key content (evidence) | Topics / links |
|---|---|---|---|---|
| **KC-091** | quoting_rule · always (R4) | "Thin-wall Ti / Inconel 718: add 35% to finishing, two ops, spare blank" | applies when Ti-6Al-4V or Inconel 718, wall < 0.040 in ("under forty thou"), taller than ~10× the wall; not for 6061 or short thin walls; +35 % finishing ("thirty-five percent"), two ops, one spare blank (R1, R3, R4) | quoting, thin-wall, Ti · Q-A01 |
| **KC-092** | setup_tip · always (R2 "Every time now") | "Thin Ti walls: rough, leave 0.020 in, unclamp and rest, finish in soft jaws" | leave 0.020 in ("twenty thou"), unclamp and let it sit, soft jaws, light passes (R2) | thin-wall, Ti, DMU 50 · m-dmu50 + Q-A01 (session context) |
| **KC-093** | customer_quirk · always (R3 "always wants") | "Aerovance: full first article on every new revision (~3 h CMM + paperwork); no rework without their MRB" | ~3 h per new revision ("about three more hours"); scrap, don't rework, without MRB sign-off (R2, R3) | Aerovance, FAI/CMM · CUS-01 |
| **KC-094** | failure_story | "Duct support bracket in April: walls sprang about 0.004 in after unclamping; 4 of 12 scrapped" | "about four thou", "four of the twelve" (R2) | thin-wall (session topic), Ti (J-A03's material), Aerovance · J-A03 (mentioned candidate) + CUS-01 (session context) |

Ray clicks **Approve all 4** (*ASSUMPTION: approval happens here, while Ray is the active persona* — otherwise steps 3 and 5 can't use them). Toast: "4 cards approved — credited to Ray Delgado". AI calls: tracker ×4, phrasing ×2, extraction ×1 = 7 audited calls.

**Step 3 — Maya asks the shop (~2 min · Maya · Cloud).** Persona → **Maya Chen · Quoter · 8 months** → Ask the Shop → *"How do we quote thin-wall Ti brackets for Aerovance?"* (optionally open **What will be sent**: customer and person tokens highlighted; destination Anthropic API). The answer streams with citations to KC-091…094 and Ray's older cards; **Similar past jobs** shows J-A02, J-A03, J-A04 with quoted vs actual, plus a collapsed "1 more similar job not sent to Anthropic API (export-controlled)"; the notice reads "1 related job was withheld…".

**Step 4 — Setup sheet routed to Ray (~1.5 min · Maya).** "Create setup sheet from these cards" prefills part PRT-A01, machine m-dmu50, cards KC-091…094 + KC-002, reviewer Ray → `DOC-SS-LIVE` streams section by section with citation chips; badge **CUSTOMER CONFIDENTIAL** (inherited); **Send for expert review**. Stepper: Draft ✓ → **Expert review · waiting on Ray Delgado** → Approved. Optional 4b: switch to Ray → `/review` → Approve → the print preview's DRAFT watermark disappears → switch back to Maya.

**Step 5 — Risk Map moved (~1 min · Maya).** `/risk` opens in delta mode: Ray × Titanium 57 → **41** (`−16`), High → Elevated; Titanium coverage 14 → **28** (`+14`); Ray's deep coverage 18 % → **32 %**; "Suggested next interview" moves to Inconel 718 (talking point in [§6](#6-knowledge-risk-taxonomy-coverage-and-risk-math)). No AI call.

**Step 6 — Privacy moment (~2 min · Maya; the step prepare sets the persona).**
- **6a Audit:** `/audit` → Maya's Ask row: "Ask the Shop · Maya Chen · Anthropic API · claude-sonnet-5-5 · customer_confidential · 1 withheld · REPLAY". The detail shows the exact redacted payload — no "Aerovance", "Ray Delgado" or "AV-2231-07" anywhere — plus records sent/withheld and why; Maya can Reveal her own row. **Export CSV** (her own rows). Optional: switch to Owner to show that the owner sees every row, then switch back to Maya.
- **6b Local:** badge → **Local** (badge reads "Ollama · qwen3.5:4b · this computer (not contacted: replay)" unless live local is on) → **Re-run** Maya's question. The answer is plainer and now also draws on **J-A06** (the export-controlled Velmont housing, +36 %); no withheld notice; the preview reads "Local: not redacted · never leaves this computer"; new audit row "Ollama · sent: unredacted (local) · stored: redacted".
- **6c Blocked:** badge → **Cloud** → open job **J-A10** (EXPORT CONTROLLED banner) → **Ask the Shop about this job** (or type its job number RJ-26-0310 or part number GDS-4410-120). **Nothing streams**: "Not sent — withheld. This question refers to job RJ-26-0310, which is labeled export-controlled… Nothing was sent to Anthropic." The audit shows a blocked row with no transport call. (*ASSUMPTION: a full block, because the question itself names export-controlled data; step 3 already showed partial withholding.*) Optional: **Re-run in Local**; optional 6d: Hybrid auto-routes it local.

### 11.3 Presenter page, reset, idempotency
- `/demo`: six step cards (Go → prepares persona/mode and navigates; talking points; expected result; fallback line), preflight with Re-run, Reset demo (shows elapsed ms; target < 2 s, expected ~100 ms), `DEMO_LIVE_LOCAL` toggle with "Use recorded local answer" fallback if Ollama isn't Ready in 10 s, cassette log (hit / positional / miss / blocked / off-script), shortcuts. Optional dual-screen control via `BroadcastChannel`.
- **Every step is idempotent and can run out of order** (step prepares and fast-forward land in Phase 5): step 2 "restart" deletes `INT-LIVE-RAY`, KC-091…094, DOC-SS-LIVE and everything referencing them; steps 3–5 fast-forward the canonical interview if it hasn't run by **replaying the `step2.*` cassettes through the same card-building code** (so fast-forwarded cards are byte-identical to extracted ones), writing a `demo_fast_forward` event — never fake AI rows; step 6 replays step 3 through the gateway if no Ask row exists yet.
- Shortcuts (presenter mode only, ignored in inputs): `g 1…6` go to step, `g d` demo page, `n` next suggested reply/question, `p` persona, `m` mode, `h` HUD, `Shift+R` reset, `PageDown` next action (clicker), `?` help.
- Preflight checks: native module + FTS5, migrations, seed hash vs lock, anchors present, cassettes valid, exact-hitting and provenance, traceability of scripted cards, DEMO_MODE config conflicts, providers (live only), Ollama warm when `DEMO_LIVE_LOCAL`, on-device speech available + mic permission (**Test mic** before the audience is watching), Chrome ≥ 139, viewport ≥ 1280, bound to loopback, telemetry disabled, no external requests since load, uploads dir.

### 11.4 Cassette inventory (10 required)

| Cassette | Step | Task | Target class |
|---|---|---|---|
| `step2.track.1` … `.4` | 2 | interview_track | anthropic |
| `step2.phrase.F1`, `step2.phrase.F2` | 2 | interview_phrase | anthropic |
| `step2.extract` | 2 | card_extract | anthropic |
| `step3.ask.cloud` | 3 | ask_shop | anthropic |
| `step3.ask.local` | 6b | ask_shop | ollama_local |
| `step4.doc.cloud` | 4 | doc_generate | anthropic |

Also required from Phase 3: `smoke.cloud` (the Settings "Send test prompt"). Optional: `step6c.ask.local`, `smoke.local`, training generation/grading. The step-6c cloud question needs **no** cassette: it is blocked before the transport, and a test asserts the replay lookup is never called.

---

## 12. Testing and quality gates

**Vitest** (node environment):
- **Policy:** table-driven over every classification × target (incl. unlisted GovCloud host, SDK base-URL env vars set, Ollama `remote_host`, non-loopback plaintext host, covered model, global profile); hybrid EC → local; escape hatch (pinned export-controlled record + hybrid + Ollama down → no button; a forged POST is still blocked); snapshot shared with the Privacy page.
- **Entity detection and suspicion:** pinned J-A10, typed `RJ-26-0310`, typed `GDS-4410-120` → blocked in Cloud; "the 4410 manifold" and "Graymor" (near-miss) → held; typed "Graymoor" alone → customer_confidential floor and sent (unless the retrieval signal fires); Maya's question → customer_confidential and **not** held; T0/R1–R4 trigger no suspicion signal.
- **Preview token:** preview in Local, switch to Cloud, press "Send exactly this" → rejected and the preview re-opens with the new destination.
- **Classification from content:** an internal card whose statement contains `GDS-4410-120` becomes export_controlled and is withheld in Cloud; recomputation never lowers.
- **Redaction:** round-trip with surface-form variants; stream restorer fuzzed at every split; "X-Ray" not a person; literal `[[CONTACT_…]]` typed by a trainee reveals nothing; the whole `ProviderRequest` (incl. `jsonSchema`) is walked; amounts tokenized.
- **Traceability gate:** KC-091…094 pass against R1–R4 with exactly their Appendix A topics and their §11.2 links; an invented "0.030 in", an unmentioned machine link or an unsupported topic is rejected; digits inside `Ti-6Al-4V` / `Inconel 718` / `AV-2231-07` are ignored.
- **Interview:** the `quote_anchor` plan fed the `step2.track.*` outputs yields exactly INCIDENT, NOVICE_GAP, TEACH_BACK, WRAP; the teach-back template fed the `step2.track.3` slots renders exactly F3; the novelty check passes the exact T0, F1, F2, F3, T5 text and rejects a question that introduces "chatter".
- **Replay:** the key is unchanged when `OLLAMA_MODEL` or base URLs change; scenario replay refused when a cited fingerprint wasn't sent; gateway parity (each scripted step with a stub live transport vs replay → identical decision, payload hash and audit rows except `transport`).
- **Also:** coverage goldens (Appendix A); seed determinism (reset into `:memory:` twice → canonical dump hash = `seed.lock.json`; counts match the brief; CRLF normalized); FTS sanitizer (demo question, `Ti-6Al-4V`, quotes, `*`, `NEAR`, empty); cassettes (parse, exact-hit, no seed names, citations ⊆ sent); role projection for every role; secret hygiene ([§4.10](#410-secret-and-payload-hygiene)); architecture rules; date formatting (fixed locale/UTC) and demo clock.

**Playwright** (1.63, Chromium, against a production build in a **separate `distDir`** on port 3100 with `data/e2e.db`, timezone deliberately non-UTC): `demo-path` (steps 1–6 serially: both SPOF rows visible without scrolling at 1280×720; exactly 3 follow-ups; 4 cards of the right types; similar jobs exactly J-A02/A03/A04 + one "not sent" row; "1 withheld"; audit payload matches the token grammar and contains no seed names; Export CSV works as Maya; blocked row in 6c); `demo-idempotency` (step 3 straight after reset → fast-forward prompt; step 2 restart; step 6 twice; reverse order; reset < 2 s with hash = lock); `routes-smoke` (every route at 1280/820/390: 200, no console errors, no hydration warnings, no horizontal scroll); `print` (label PDF 288×144 pt; watermark before approval); `a11y` (axe: no serious/critical). **No-egress guard:** a Node preload (`--require e2e/no-egress.cjs`) blocks every non-loopback socket/DNS lookup and logs attempts (also flags any connection to port 11434 in replay), and the browser fixture aborts any non-local request; `afterAll` asserts both counts are zero. Telemetry is disabled in all spawned processes.

**Gates:** `npm run check` = eslint + `tsc --noEmit` + vitest. `npm run demo:check` = environment (even Node major, native module, FTS5) → check → `next build` into its own `distDir` (**fails if any DB-backed route is static `○`**; refuses to run while port 3000 is serving) → Playwright suite → reset + preflight summary (target < 6 min). Proposed CI: GitHub Actions matrix `ubuntu-latest` × `windows-latest` on Node 24 running `demo:check` (*ASSUMPTION*; otherwise run it once on the demo machine).

---

## 13. Phase breakdown

Order: **1 → 2 → 3 → 4 → 5 → 6 → 7 → 8**, strictly. Each phase ends with a commit, a push to the working branch, an entry in the [Progress log](#19-progress-log), and a summary to you of what changed and how to test it. Each AI phase ships its own cassettes and E2E spec, so Phase 8 joins finished pieces rather than doing a big-bang integration.

**Three deliberate deviations from the brief's phase list (*ASSUMPTION*):**
1. The **redaction core moves to Phase 3** alongside the gateway, because Phase 4 makes the first cloud calls and the brief says "before any cloud call". Phase 7 still adds the "What will be sent" panel.
2. A **minimal persona cookie and pricing gate land in Phase 2**, because read-only screens already show prices. Phase 7 completes the full role matrix.
3. The **replay transport, cassettes and `demo:verify` start in Phase 3**, so every AI phase is demoable offline and protected by tests. Phase 8 adds the presenter page, preflight, step prepares polish and the end-to-end verification.

### Phase 1 — Schema + seed data (two commits: 1a, 1b)
- **1a scope (engine + demo-critical content):** scaffold (create-next-app 16.3.6 in a temp folder, then copy in — it refuses a folder that already contains PLAN.md/CLAUDE.md; keep `@AGENTS.md` on line 1 of the merged CLAUDE.md); exact dependency pins; `.gitattributes`, `.gitignore` (`!.env.example`, `data/*`), `.env.example`; `src/lib/env.ts`, `log.ts`, `time.ts`; Drizzle schema, migrations, custom FTS5 migration + triggers; `src/lib/policy/entity-detect.ts` (pure, built from the seed dictionary); `src/db/classification.ts` (incl. content scan); loader + zod schemas + `seed:check` + `seed:lock`; deterministic reset; generator for parts/quotes/jobs; coverage `compute.ts`; similar-jobs scorer + query features; spoken-number normalizer and the pure traceability checks (`interview/traceability.ts`: evidence, numeric claims, links by session context or pinned mention, topics, confidence — shared by `seed:check` and, later, the live gate); FTS query sanitizer; **demo-critical content in full**: shop, people, personas, machines, materials, customers (+ `NAMES.yaml`), taxonomy, expertise matrix, all anchors, all of Ray's cards and his two transcripts, every Ti/thin-wall card, `ray-live-interview.yaml`; Vitest harness; `tests/architecture.test.ts` skeleton; GitHub Actions CI on Ubuntu + Windows (`npm ci`, `npm run check`, `npm run seed`). Count shortfalls are warnings until 1b.
- **1b scope (bulk content):** the remaining cards (to 90), the other six transcripts, the 25 setup sheets (DocBody format as specified in §5.2), 3 quote-reasoning logs, machine events — all passing `seed:check`. (Seeded quizzes/attempts move to Phase 6; audit history to Phase 3.)
- **Exit criteria:** row counts match the brief; `npm run seed` < 3 s and an identical hash twice; Ray is the only SPOF (Ti, thin-wall) and the golden numbers hold with the pinned scripted cards; the traceability checks pass KC-091…094 (from `ray-live-interview.yaml`) against R1–R4; similar-jobs ranking invariant and variance clustering pass; FTS sanitizer tests pass; no Turbopack whole-project tracing warning from the DB path switch.
- **How to test:** `npm ci && npm run seed && npm test`; open `seed-data/` in an editor, break a card on purpose, run `npm run seed:check` and read the error.

### Phase 2 — Read-only screens
- **Scope:** app shell, tokens, local fonts, fictional banner; header provider badge (reads config only); signed persona cookie + pricing/departure gate; `/risk` (heat map, risk-first sort, metric toggle, cell sheet, baseline), `/library` + card page, `/people` + profile, `/machines` + machine page (read-only) + print label + label sheet, `/jobs` + job page; classification badges; shadcn components.
- **Exit criteria:** `next build` shows `ƒ` (dynamic) for every DB route; no hydration warnings; axe clean (no serious); no horizontal scroll at 1280/820/390; both SPOF rows visible at 1280×720; label PDF is 4×2 in.
- **How to test:** `npm run build && npm start`, click through; switch persona to Marv (machinist) and see "Hidden for Machinist role" on price and departure fields; `npx playwright test routes-smoke print`.

### Phase 3 — Provider abstraction, classification, routing policy, audit log
- **Scope:** `runAI()` gateway and pipeline (P3 wiring of the Phase 1 entity detector, suspicion signals, escape hatch, held decisions, preview token); Anthropic, Bedrock and Ollama adapters (explicit base URLs, safe loggers); `policy/*` (matrix, decide, notices, GovCloud allowlist, covered models, cross-region); **redaction core** + stream restorer + literal-token escaping; `ReplayTransport` + replay key + smoke cassettes + `demo:record --author/--rekey` + `demo:verify`; `ai_audit_log` / `event_log` + seeded audit history, `/audit` (filters, detail, Reveal, per-role export); `/settings` mode and provider picker (`setAiRouting`); `/api/health`, `/api/health/warm`, `/api/ai/preview` (dry run; UI in Phase 7); `withSafeErrors`; lint rules + architecture, secret-hygiene and no-egress tests. Bedrock is tested against an injected-fetch stub (or live if you have access).
- **Exit criteria:** policy, redaction, parity and hygiene tests pass; `/settings` → **Send test prompt** produces a tokenized `REPLAY` audit row in DEMO_MODE and a live row when a key is present; switching Anthropic → Bedrock in-app updates the header and the audit rows; with `DEMO_MODE=false` (or `DEMO_LIVE_LOCAL=true`), Local mode with Ollama stopped shows "Unreachable" and fails cleanly (no cloud fallback).
- **How to test:** as above with and without `ANTHROPIC_API_KEY`; with Ollama running, set Local mode and send the test prompt; open the audit row and try Reveal as Owner vs Maya.

### Phase 4 — Ask the Shop
- **Scope:** retriever (FTS + tags + synonyms + entity boosts, budgeted context), similar-jobs panel, answer prompt with `[S#]` citations validated against sent sources, streaming UI with citation chips, threads, withheld/blocked/held notices, routing chip, Re-run, "Ask the Shop about this job", offline fallback; cassettes `step3.ask.cloud` / `step3.ask.local` (v1, seeded cards only); retrieval invariants; E2E for step 3 and the 6c blocked path.
- **Exit criteria:** the demo question returns J-A02/A03/A04 plus one "not sent" job (J-A06) in Cloud; J-A10 is blocked in Cloud with nothing sent; citations never reference unsent records; `demo:verify` exact-hits; passes with no egress.
- **How to test:** in DEMO_MODE ask the demo question in Cloud, then Local; ask about J-A10 in Cloud; compare the three audit rows.

### Phase 5 — Interviewer + card extraction + approval flow
- **Scope:** plans (`quote_anchor`, `generic`), probe bank, tracker (verbatim slots), phrasing + novelty check + template fallback; consent gate (destination + speech engine; re-consent on target change); speech-engine resolver, speech chip, Simulated dictation, off-script handling; Quote Reasoning Log mode + variance review; candidate-record resolution + extraction + the live traceability gate (wiring the Phase 1 checks); review / approve / request changes; `/interview/*`, `/review`; coverage recompute + delta; **step prepares and fast-forward**, with a minimal missing-prerequisite banner on `/ask` that calls `prepareDemoStep` (the HUD version comes in Phase 8); cassettes `step2.*` and **re-recorded `step3.*`** (now citing KC-091…094).
- **Exit criteria:** the scripted session yields exactly 3 follow-ups and 4 gate-passing cards; approval moves coverage by the golden deltas; step 3 straight after reset fast-forwards and still exact-hits; vendor-cloud speech is blocked by default; live mode (with a key) follows the same plan.
- **How to test:** in DEMO_MODE run step 2 with chips, approve, open `/risk`; try the mic in Chrome (on-device vs blocked); run a Quote Reasoning Log on Q-A12; reset and jump straight to step 3.

### Phase 6 — Document generator + training
- **Scope:** `/documents/*` (generate from cards, citations, status stepper, send for review, approve, versioning, assembled fallback), print view with watermark/banners; training (quiz generation from approved cards with traceability check and quiz-set approval, deterministic fallback and grading for choice/rank, live-only free-text grading with "unclear", progress matrix) + seeded quizzes/attempts; machine-page capture (photo pipeline + voice/text notes → review queue, capture classification); cassette `step4.doc.cloud` (+ optional training cassettes).
- **Exit criteria:** step 4 runs as scripted; print PDF shows the watermark until approval; a quiz generated from KC-091 grades correctly; an uploaded photo has no EXIF and is deleted by reset.
- **How to test:** DEMO_MODE step 4 → switch to Ray → approve → print preview; take the "Thin-wall basics" quiz as Devin; upload a photo on `/machines/m-dmu50`.

### Phase 7 — Redaction preview, roles, Privacy & Deployment page
- **Scope:** "What will be sent" panel on every AI entry point (interviewer: post-send view + optional pre-send toggle), suspects + "Redact this"; full role matrix and persona polish; `/privacy` (matrix from policy, deployment options, redaction/speech/CUI explainers, quoted vendor statements with context, disclaimers, full export, full delete); consent/speech events surfaced; E2E for step 6.
- **Exit criteria:** preview payload is byte-identical to the audited payload (hash match); Privacy matrix snapshot equals the policy test snapshot; full delete leaves zero rows (no recoverable residue) while the server runs and Reset recovers; role-projection test passes for every task and role.
- **How to test:** open the preview, send, compare with the audit detail; export → delete → reset.

### Phase 8 — Demo mode, scripted path, polish
- **Scope:** `/demo` presenter page, preflight, HUD, shortcuts, dual screen, `DEMO_LIVE_LOCAL` runtime toggle and warm-up; delta animation and loading/empty states; production CSP (`connect-src 'self'`); loopback binding + presenter PIN + `serve-https` for the optional tablet segment; `demo-path` and `demo-idempotency` E2E; `demo:check`; CI extended to run `demo:check`; `docs/DEMO-RUNBOOK.md` (day-before and hour-before checklists: update Chrome/Ollama the day before, pre-pull the model, install the on-device speech pack, re-check the regulatory drawer, stop the server, `npm run demo`, test mic) and `docs/SME-REVIEW.md` (what an SME must review, and that edits to demo-retrieved records need `demo:record --rekey` + `demo:verify`).
- **Exit criteria:** `npm run demo:check` green on Ubuntu and Windows; reset < 2 s; full path with zero egress; a timed dry run within ~11 minutes.
- **How to test:** `npm run demo:check`; disconnect the network and run the whole demo from `/demo` using only keyboard shortcuts.

---

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Native module install fails on Windows | better-sqlite3 **12.11.1** pinned (prebuilt download from GitHub for Node 22/24/26, no compiler); even Node majors only; same Node major for install and demo (`npm rebuild better-sqlite3` after switching); offline install via npm's prebuild cache or vendored tarballs; `demo:check` on the Windows machine |
| Production build serves stale seeded data | `await connection()` in every DB read; `demo:check` fails on static DB routes; E2E runs against the production build |
| Hydration mismatches / clock drift | UTC + `en-US` formatting; no `Date.now()`/`Math.random()` in render or seed; fixed `DEMO_TODAY` + demo clock; E2E in a non-UTC timezone |
| Scripted cards rejected by our own safeguards | Spoken-number normalizer shared by gate and seed:check; link rule with session context and candidate records; unit tests on the exact scripted text |
| Web Speech fails (offline, permission, noise, 8 s no-speech timeout, cloud engine) | Simulated dictation and chips; on-device check + "Install on-device speech" + "Test mic" in preflight; typing always works; off-script detection protects extraction |
| Ollama cold/slow (20–35 s on a CPU laptop) or reloads | Replay by default in DEMO_MODE; warm at boot, on mode switch and when `DEMO_LIVE_LOCAL` is on; identical options; `think:false`; fixed `num_ctx`; long keep-alive; "Use recorded local answer" fallback |
| Cassette drift after prompt/seed edits | Exact key first; `demo:verify` from Phase 3; `--rekey` tool; preflight cassette check |
| Hand-authored cassettes mistaken for model output | Provenance field; "REPLAY · scripted (not model output)" label; `demo:verify` warning |
| Presenter goes off-script | Chips and `n` key, labelled offline fallbacks, off-script state + "Restore scripted replies", fast-forward prompt |
| Steps run out of order / repeated | Step prepares, fast-forward via the same code path, fixed-ID upserts with cascades, ~100 ms reset |
| Small local model makes wrong JSON or invented citations | Small flat schemas, enums (incl. allowed `S#` keys), zod + one retry, traceability gate, citation filter |
| Brand-new model and SDK (both released 2026-09-28) | Exact pins; DEMO_MODE never depends on them; record cassettes only after a smoke test |
| Someone on the venue Wi-Fi takes over the demo server | Loopback binding; HMAC-signed persona cookie; presenter PIN for destructive/export actions from the LAN |
| Overclaiming compliance in a sales setting | Copy rules in CLAUDE.md; "designed to support"; quotes shown with their context; dated regulatory drawer; persistent fictional banner |
| Fictional names collide with real companies | Web check recorded in `NAMES.yaml`; three names already replaced; brief-mandated names flagged in Q4 and shown with "(fictional)" |
| Domain content isn't machinist-plausible | SME review of `seed-data/` (incl. cassettes) before any customer demo; setup sheets avoid speeds/feeds; quirks written as unit history |
| Tablet on plain-HTTP LAN has no microphone | Voice moments on the laptop; optional tablet segment via mkcert + a travel router with a fixed IP; `PUBLIC_BASE_URL` for QR codes |
| Windows specifics (OneDrive folders, file locks, cmd.exe scripts, CRLF) | Repo outside OneDrive; reset inside the DB; scripts as `.mts`; LF enforced; `demo:check` builds into its own `distDir` |
| Container limits for this build session | `ui.shadcn.com`, `cdn.playwright.dev`, `ollama.com`, `nextjs.org`, `docs.aws.amazon.com` are blocked here: allowlist `ui.shadcn.com` (or vendor component sources from GitHub); Playwright uses the preinstalled Chromium via `executablePath`; Next docs come from `node_modules/next/dist/docs` |

---

## 15. Seams for out-of-scope items

| Out of scope | Seam |
|---|---|
| SSO / real auth | `IdentityProvider.getActor()` with `AUTH_MODE=demo` (signed cookie) today; an OIDC provider maps group claims to roles later. Nothing reads the cookie directly. Per-person `export_access` flag reserved for "authorized U.S. person" gating of export-controlled records |
| Multi-tenant | `Actor.tenantId`; audit, event, token and settings tables carry `tenant_id` (default `ridgeline`); dictionary cache keyed by tenant |
| ERP / Paperless Parts | `ExternalRecordSource` importer interface that must assign a classification; unmapped imports default to **export_controlled** and "unreviewed" (fail closed); imported names feed the redaction dictionary |
| Vector search | `Retriever` interface (FTS5 today). Policy filtering happens after retrieval, so any *local* retriever is safe; a hosted retriever, embedding service or vector store is itself egress and must go through `runAI()` (`task: 'embed'`) under the same clearance rules |
| Local speech-to-text | `SttProvider.transcribe(wav16kMono)` (whisper.cpp server first; Ollama audio later). Audio held in memory only; `audio_received` / `audio_deleted` events audited — this is where "raw audio is deleted after transcription" becomes true |
| More providers (Vertex, etc.) | New adapter + `TargetClass` + matrix column; nothing else changes |
| Production deployment | Not built; the HTTPS server script is demo-only |

---

## 16. Assumptions to confirm

Reply with the numbers you disagree with; everything else proceeds as written.

**What you'll see in the demo**
1. **Owner persona** "Dana Whitcomb (Owner/GM)" exists as a persona only (no `people` row), so the heat map has 8 holders + 1 owner persona.
2. **Ray approves the four cards at the end of step 2** (only approved cards feed Ask the Shop, Training and coverage; drafts show as hatched "pending").
3. **Maya** generates the setup sheet in step 4, and **any persona can switch AI mode/provider or reset while `DEMO_OPEN_CONTROLS=true`** (owner-only otherwise). Every role can export its own audit rows.
4. **"Raw audio is deleted after transcription" is replaced** by engine-specific honest copy ("Floorwise never receives or stores audio"). **Vendor-cloud speech is off by default** (on-device Chrome speech or typing only); the scripted interview uses Simulated dictation or on-device speech.
5. A visible **`REPLAY`** tag stays on in DEMO_MODE; hand-written cassettes say "scripted (not model output)" until real recordings replace them.
6. The demo **pins the interview's move order** (incident → novice gap → teach-back) and follow-up budget; only the wording comes from the model. Unscripted interviews use the adaptive policy.
7. Step 3 shows **"1 related job withheld"** (J-A06) as a preview of step 6; step 6c shows a **full block** rather than a partial answer.
8. The scripted story: Ray's critical incident is **J-A03, a job Maya quoted during Ray's leave that ran +54 %**.
9. The interviewer shows the payload **after** each turn (with an optional preview-before-send toggle); every other AI entry point offers a "What will be sent" preview before sending.

**Policy and privacy**
10. `customer_confidential` may go to cloud providers **with mandatory redaction** (switchable to deny). If your prospects' customer data includes CUI, the guidance is to label it export_controlled.
11. export_controlled: local Ollama or GovCloud endpoints on an **exact-hostname allowlist** (default: the two FIPS runtime hosts); the adapter doesn't auto-switch to FIPS; covered (30-day retention) models are excluded by default. **Hybrid sends export_controlled to local** unless `HYBRID_EC_TARGET=govcloud`.
12. **Pricing fields and customer contacts are never sent to any model**; typed or spoken amounts are tokenized on cloud calls; quoted/actual hours are visible to all roles; **machinists and trainees see customer names and quirks** (needed on the floor), but not contacts, terms, win/loss or departure dates.
13. Local (Ollama) audit rows store the payload **redacted for storage**, with render-time Reveal limited to that row's own tokens.
14. Job and quote numbers are tokenized along with customers, people and part numbers; the shop's own name is not. Tokens are HMAC codes (e.g. `[[CUSTOMER_7QK2]]`), not derived from visible IDs.
15. Defense customer **names** stay customer_confidential; their parts/quotes/jobs are export_controlled.
16. Anthropic's beta server-side refusal fallback stays **off** (the model is pinned; the audit records the served model anyway).
17. The demo server binds to **localhost**; the tablet segment (optional) uses HTTPS + a presenter PIN.

**Data and content**
18. Fictional names in [§7.2](#72-the-fictional-cast-assumption) (6 people, the owner, 5 non-brief customers), with Lumacor → **Sutrella Surgical** and Stellan → **Velmont Guidance Systems** already changed after the collision check.
19. Machine models for the unnamed machines: **Citizen Cincom L20** (Swiss), **ZEISS CONTURA** (CMM), **Mitsubishi Electric MV2400R** (wire EDM), Mazak INTEGREX i-200, Okuma GENOS M560-V.
20. Customer mix: 2 aerospace, 1 medical, 1 semiconductor, 2 defense.
21. `DEMO_TODAY` fixed at **2026-09-15**; domain dates created during the demo use the demo clock; the header shows the demo date.
22. Setup sheets cite **CAM program numbers** instead of speeds and feeds; customer and machine quirk cards may lack a job link.
23. Coverage model constants (K = 4, weights incl. failure stories at full weight, urgency curve) as a labelled **estimate**.
24. All seed content (and the interview script numbers such as 0.040 in, 35 %, 0.020 in, 10×) is placeholder wording drafted by Claude; **an SME reviews `seed-data/` before any customer demo.**
25. **Bedrock model IDs are unconfirmed** (AWS docs were unreachable during research); `BEDROCK_MODEL_ID` stays required with no default.

**Build and tooling**
26. `src/` layout; Node 24 LTS (even majors only); better-sqlite3 **12.11.1** (needs github.com reachable during `npm install` on your machine, or a vendored binary).
27. Three phase-order deviations ([§13](#13-phase-breakdown)): redaction core in Phase 3, minimal persona/pricing gate in Phase 2, replay transport and `demo:verify` from Phase 3. Phase 1 lands as two commits (1a engine + demo content, 1b bulk content).
28. Machine-page photo/voice capture is built in Phase 6.
29. **GitHub Actions** CI matrix (Ubuntu + Windows) running `demo:check` — OK to add a workflow file?
30. The demo runs in **Chrome desktop at `http://localhost`**; a tablet segment is optional (mkcert + travel router).
31. Each phase is pushed to the working branch (`claude/shopmemory-demo-brief-bhujcu`) when committed.
32. For this cloud build session: allowlist **`ui.shadcn.com`** in the environment's network settings so the shadcn CLI works (otherwise component sources are copied from the shadcn GitHub repo).

---

## 17. Questions before Phase 1

**Decisions (answered 2026-09-29):**
- **Machine:** Windows, and a slow laptop → the demo stays on closed (cloud) models. Local mode in step 6 **replays** a recorded local answer (`DEMO_LIVE_LOCAL=false` on this machine; the badge says "not contacted: replay"). With no Ollama available, the local cassettes start **hand-authored and labelled "REPLAY · scripted (not model output)"**; they can be re-recorded later on any machine with Ollama (`npm run demo:record -- --target ollama`). The Ollama adapter is still built and tested against a mock server. `OLLAMA_MODEL` keeps its `qwen3.5:4b` default for anyone who runs local mode live.
- **Default mode:** cloud.
- **API access:** Anthropic API key available (needed from Phase 3 to record real cloud cassettes — either as an environment secret in the cloud build environment or by running `demo:record` on the Windows machine). **No AWS/Bedrock access** → the Bedrock adapter is built and tested against an injected-fetch stub only; `BEDROCK_MODEL_ID` stays required with no default.
- **Names:** product **Floorwise**. No replacement was chosen for "Ridgeline Precision" or "Aerovance", so the brief's names stay and are always shown with "(fictional)" (renaming is cheap until cassettes are recorded in Phase 4).
- **Assumptions in §16:** all accepted.
- **Windows:** because the build and demo machine is Windows, the GitHub Actions matrix (Ubuntu + Windows) starts in Phase 1 so the native module, scripts and seed are exercised on Windows from the first commit.

The original questions, kept for reference:


1. **Build/demo machine:** Windows or Ubuntu? CPU model (e.g. Ryzen 7 7840HS, Core i7-1165G7)? How much RAM? GPU (model and VRAM, or none)? Is Ollama installed (version)? → I'll recommend the local model and give expected speed. Reference table for a typical Ask-the-Shop request (~1,500-token prompt, ~300-token answer, warm model, `think:false`; estimates ±50 % from public benchmarks, to be measured on your hardware):

   | Hardware | Suggested model | Expected total time |
   |---|---|---|
   | CPU only, 16 GB (recent Ryzen 7 / Core Ultra 7) | `qwen3.5:4b` (3.4 GB) or `granite4.1:3b` (2.1 GB) | ~20–35 s / ~16–23 s |
   | 8 GB RAM, CPU only | `granite4.1:3b` or `llama3.2:3b` | ~20–30 s |
   | NVIDIA 4 GB (RTX 3050 laptop) | `qwen3.5:2b` / `granite4.1:3b` fully on GPU | ~5–7 s |
   | NVIDIA 8 GB (RTX 4060/4070 laptop) | `qwen3.5:9b` if 100 % on GPU (else `qwen3.5:4b`) | ~9–11 s (~5 s) |
   | NVIDIA 12–16 GB | `gemma4:12b` or stay on `qwen3.5:9b` | ~4–5 s |
   | Apple M-series (reference) | `qwen3.5:4b` / `qwen3.5:9b` | ~13–15 s |

   Add 2–10 s for a cold model load. AMD/Intel integrated GPUs are ignored by Ollama by default (CPU speed). In DEMO_MODE, local answers are replayed unless you turn on live local, so a slow laptop only matters for live local runs.
2. **Default mode** the demo opens in: cloud, local, or hybrid? **Cloud is the only default that runs the six-step script unchanged** (step 3's redacted cloud payload and withheld notice feed step 6a, and step 6b's switch to local is the reveal). Hybrid would send step 3 to the local model (its context includes the export-controlled J-A06); local makes 6b a no-op. Either is possible, but needs a script variant and extra cassettes.
3. **API access:** Do you have an Anthropic API key? An AWS account with Bedrock model access (commercial region, and/or GovCloud)? If you have Bedrock, please run `aws bedrock list-inference-profiles --region <your-region>` (and `--region us-gov-west-1` if applicable) and paste the Claude entries, since the AWS docs were unreachable from here. Without access, the Bedrock adapter is built and tested against a stub, and cassettes are hand-authored (labelled "scripted") until a key is available.
4. **Names:**
   - **Product:** keep "ShopMemory"? `shopmemory.com` belongs to an electronic-components distributor (different industry, medium risk), and "ShopMemo"/"ShopMind" are existing AI tools. Alternatives with no product found in a web search: *ShopLore*, *Spindlewise*, *Floorwise*. (A USPTO and domain check is still needed before external use.)
   - **Shop:** "Ridgeline Precision" (from the brief) matches several real CNC businesses, including an AS9100-aligned aerospace/defense shop with 5-axis, Ti/Inconel and CMM work. Keep it (always shown as "(fictional)"), or use *Fenwright Precision* / *Brindlecroft Precision* / *Ashcombe Precision*?
   - **Aerospace customer:** "Aerovance" (from the brief) matches AeroVance Solutions Inc., a real AS9120B aerospace parts distributor. Keep it (with a "(fictional customer)" chip), or use *Altovane* / *Corvanta* / *Skyrell*?
   - Decide before Phase 1: the names end up in seed data, cassettes and token hashes.
5. Plus the assumptions in [§16](#16-assumptions-to-confirm).

---

## 18. Sources

Verified during research on 2026-09-28 (some vendor pages were reachable only via their GitHub sources or search excerpts; those are marked in the research notes).

- Next.js 16.3 docs bundled in `next@16.3.6` (`node_modules/next/dist/docs/`), incl. the v16 upgrade guide and `connection()`.
- Tailwind CSS v4 docs (tailwindlabs/tailwindcss.com repo); shadcn/ui v4 docs and registry (shadcn-ui/ui repo).
- Anthropic: models overview, Sonnet 5.5 migration guide, structured outputs, Claude in Amazon Bedrock, API and data retention (platform.claude.com); Public Sector FAQ (support.claude.com); Commercial Terms (anthropic.com/legal/commercial-terms); `@anthropic-ai/sdk` 0.129.0 and `@anthropic-ai/bedrock-sdk` 0.34.0 source.
- AWS: aws-samples/anthropic-on-aws getting-started notebooks (Opus 5.5, Sonnet 5.5, Fable 5.1); Claude Code Bedrock docs (GovCloud `us-gov.` prefix); GovCloud ITAR and Bedrock pages (search excerpts only — **confirm on your account**).
- Ollama v0.34.4 source and docs (github.com/ollama/ollama): API, structured outputs, thinking defaults, context length, cloud models, Windows/Linux install; llama.cpp and community benchmarks for the performance table.
- better-sqlite3 issues #1503/#1516, npm metadata, GitHub release assets and local install tests; drizzle-orm/drizzle-kit 0.45.3/0.31.11 package contents; libsql-js issues.
- Web Speech: MDN content and browser-compat-data, the Web Speech API spec and on-device explainer, Chromium and WebKit sources; WCAG 2.2 (2.5.5, 2.5.8, 1.4.3, 1.4.6, 1.4.11); Apple HIG; Android accessibility guidance.
- Methodology: Flanagan 1954 (CIT); Klein, Calderwood & MacGregor 1989 and Hoffman, Crandall & Shadbolt 1998 (CDM); Militello & Hutton 1998 (ACTA); Rugg & McGeorge 1995 (laddering); AHRQ Teach-Back (Tool 5); Loftus & Palmer 1974; Klein & Borders 2016 (ShadowBox).
- Regulatory background (for copy only, not legal advice): eCFR 22 CFR 120–130 (ITAR), 15 CFR 730–774 (EAR), 32 CFR 170 (CMMC), DFARS 252.204-7012, NARA CUI Registry, DoD CIO CMMC updates.
- Name-collision check: web searches for every proposed company, product and person name (results recorded for `seed-data/NAMES.yaml`).

---

## 19. Progress log

| Phase | Date | Summary | How to test |
|---|---|---|---|
| 0 — Plan | 2026-09-28 | PLAN.md and CLAUDE.md written from six research tracks and three design drafts, revised after a five-lens review (113 findings: demo-path contradictions, privacy hardening, name collisions), then a second-pass closure/consistency check (fixes to topic support, suspicion-signal scope, preview token, timings, phase dependencies). Golden numbers re-verified by script from Appendix A | Read §11 (demo), §13 (phases), §16–17 (assumptions, questions) |
| 1a — Engine + demo-critical seed | 2026-09-29 | Next.js 16.3.6 scaffold with exact pins; env/log/time; Drizzle schema (41 tables), migrations, FTS5 + triggers; entity detection + suspicion signals; classification rules; coverage/risk math; spoken-number normalizer + traceability checks; FTS sanitizer, query features, similar-jobs scorer; deterministic generator (per-record sub-seeds, per-customer quote totals); seed loader with `file:line` errors, cross-file checks, demo invariants (golden numbers, SPOF set, similar-jobs rank, variance clustering, pinned values), bundle + hash, `seed.lock.json`; one-transaction reset (archives live audit rows, bumps `demo.epoch`); demo-critical content (shop, cast, machines, materials, customers, taxonomy, matrix, 12 anchor parts, 15 anchor quotes, Ray's 12 cards + 2 transcripts, the Ti/thin-wall cards, `ray-live-interview.yaml`, DOC-SS-05); architecture-rule tests; CI on Ubuntu + Windows. Count shortfalls (cards, transcripts, setup sheets, quote logs) are warnings until 1b | `npm ci && npm run check && npm run seed`; break a card in `seed-data/` on purpose and read `npm run seed:check` |

---

## Appendix A — Golden-test inputs

These are the exact inputs behind the [§6](#6-knowledge-risk-taxonomy-coverage-and-risk-math) golden numbers; Phase 1 writes them into `seed-data/` and the golden test computes from them.

**People dates:** Ray hired 1995-06-05, retires 2028-05-15 · Marv hired 2000-08-14 · Linda hired 2004-03-01, retires 2029-11-15 · Tomás hired 1999-01-11, retires 2031-01-15 · Maya 2026-01-12 · Devin 2026-03-09 · Priya 2025-10-13 · Jonah 2025-07-14. `DEMO_TODAY` 2026-09-15. Months are whole months.

**Expertise matrix** (R Ray · M Marv · L Linda · T Tomás · Y Maya · D Devin · P Priya · J Jonah):

| Topic | R | M | L | T | Y | D | P | J |
|---|---|---|---|---|---|---|---|---|
| t-thin-wall | 3 | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| t-quoting | 3 | 1 | 0 | 2 | 1 | 0 | 0 | 0 |
| t-5ax-workholding | 2 | 3 | 0 | 0 | 0 | 1 | 0 | 1 |
| t-tight-tol | 2 | 2 | 2 | 2 | 0 | 0 | 1 | 0 |
| t-fai-cmm | 1 | 1 | 3 | 0 | 0 | 0 | 2 | 0 |
| t-outside-proc | 2 | 0 | 2 | 1 | 1 | 0 | 0 | 0 |
| t-cam | 1 | 2 | 0 | 1 | 0 | 0 | 0 | 2 |
| t-m-vf4 | 1 | 2 | 0 | 1 | 0 | 1 | 0 | 1 |
| t-m-st20 | 0 | 0 | 0 | 2 | 0 | 1 | 0 | 1 |
| t-m-dmu50 | 2 | 3 | 0 | 0 | 0 | 0 | 0 | 1 |
| t-m-genos | 1 | 2 | 0 | 0 | 0 | 1 | 0 | 1 |
| t-m-integrex | 1 | 1 | 0 | 3 | 0 | 0 | 0 | 2 |
| t-m-swiss | 0 | 0 | 0 | 3 | 0 | 1 | 0 | 2 |
| t-m-cmm | 0 | 0 | 3 | 0 | 0 | 0 | 2 | 0 |
| t-m-wedm | 1 | 2 | 0 | 1 | 0 | 0 | 0 | 0 |
| t-mat-6061 | 2 | 2 | 1 | 2 | 1 | 1 | 1 | 1 |
| t-mat-7075 | 2 | 2 | 1 | 1 | 1 | 1 | 0 | 1 |
| t-mat-174ph | 2 | 2 | 1 | 2 | 0 | 0 | 0 | 1 |
| t-mat-316 | 1 | 1 | 1 | 2 | 0 | 1 | 0 | 1 |
| t-mat-ti64 | 3 | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| t-mat-in718 | 3 | 1 | 0 | 2 | 0 | 0 | 0 | 0 |
| t-mat-peek | 1 | 1 | 0 | 2 | 0 | 0 | 0 | 1 |
| t-cus-01 Aerovance | 3 | 1 | 2 | 0 | 1 | 0 | 1 | 0 |
| t-cus-02 Halvorsen | 2 | 2 | 2 | 1 | 0 | 0 | 0 | 0 |
| t-cus-03 Sutrella | 1 | 0 | 2 | 2 | 1 | 0 | 1 | 1 |
| t-cus-04 Quantrel | 1 | 2 | 1 | 0 | 1 | 1 | 0 | 1 |
| t-cus-05 Graymoor | 2 | 2 | 2 | 1 | 0 | 0 | 0 | 0 |
| t-cus-06 Velmont | 2 | 1 | 1 | 1 | 0 | 0 | 0 | 0 |

**Pinned cards** (approved unless noted; weights per §6):

| Card | Contributor | Type · confidence | Weight | Topics |
|---|---|---|---|---|
| KC-001 | Ray | quoting_rule · usually | 1.0 | thin-wall, ti64, quoting |
| KC-002 | Ray | setup_tip · always | 0.8 | thin-wall, ti64, dmu50 |
| KC-003 | Ray | customer_quirk · always | 0.8 | cus-01, fai-cmm |
| KC-004 | Ray | quoting_rule · usually | 1.0 | in718, quoting |
| KC-005 | Ray | failure_story | 1.0 | 174ph, outside-proc, cus-02 |
| KC-006 | Ray | quoting_rule · usually (export_controlled; from INT-02) | 1.0 | cus-06, quoting |
| KC-007 | Ray | machine_quirk · always | 0.8 | genos |
| KC-008 | Ray | quoting_rule · sometimes | 0.75 | 7075, quoting, cus-01 |
| KC-009 | Ray | setup_tip · always | 0.8 | 6061, cus-04 |
| KC-010 | Ray | quoting_rule · always | 1.0 | outside-proc, quoting |
| KC-011, KC-012 | Ray | pending_review (not counted) | — | wedm; cus-05 |
| KC-021 | Marv | failure_story | 1.0 | ti64 |
| KC-034 | Linda | inspection_gotcha · always | 0.8 | thin-wall |
| KC-091 | Ray (scripted) | quoting_rule · always | 1.0 | thin-wall, ti64, quoting |
| KC-092 | Ray (scripted) | setup_tip · always | 0.8 | thin-wall, ti64, dmu50 |
| KC-093 | Ray (scripted) | customer_quirk · always | 0.8 | cus-01, fai-cmm |
| KC-094 | Ray (scripted) | failure_story | 1.0 | thin-wall, ti64, cus-01 |

Rule: no other approved card is tagged titanium or thin-wall for a person with E > 0 on those topics. Other contributors' cards may touch any other topics.
