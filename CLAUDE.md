# CLAUDE.md — ShopMemory conventions

ShopMemory is a **scripted sales demo** for CNC / precision machine shops: it captures senior people's tacit know-how through an AI interviewer and makes it usable by newer employees, with a visible privacy layer for ITAR/CUI shops. **All data is fictional.** A polished, reliable scripted demo matters more than scale.

`PLAN.md` is the source of truth for architecture, data model, the six-step demo script and the phase plan. Read the relevant PLAN.md section before changing a module. If a change contradicts PLAN.md, update PLAN.md in the same commit (or ask first if it changes the demo script or a policy decision).

> Phase 1 scaffolding: create-next-app generates `AGENTS.md` and a `CLAUDE.md` that contains only `@AGENTS.md`. When merging, keep `@AGENTS.md` as line 1 of this file and keep everything below it.

## Working agreement
- Build in the phases listed in PLAN.md §13. Finish, verify, commit and push one phase at a time on the designated branch. At the end of each phase: add a row to PLAN.md §19 (Progress log) and give the user a summary of what changed and how to test it.
- Don't start the next phase while the current one has failing checks. Run `npm run check` before every commit and `npm run demo:check` before closing a phase (once those scripts exist).
- Pin dependency versions exactly (no `^`) for anything in the demo path. Don't upgrade better-sqlite3 past 12.x until upstream issue #1516 is fixed. Don't run `npm audit fix --force` (it downgrades drizzle-kit).
- Commit messages: `Phase N: <what>` for phase commits; imperative mood otherwise.

## Hard rules (these protect the demo and the privacy story)

1. **Every model call goes through `runAI()`** (`src/server/ai.ts` in the app, `src/lib/ai/gateway.ts` in scripts). Never import `@anthropic-ai/sdk`, `@anthropic-ai/bedrock-sdk`, `@aws-sdk/*` or call Ollama outside `src/lib/ai/providers/*`. Never pass record bodies or classifications into `runAI()` — pass record references; the gateway loads and classifies them itself.
2. **Never write secrets or unredacted payloads to logs, the console, the audit tables, error messages or files.** Use `src/lib/log.ts` (the only place `console.*` is allowed). Never log prompts, messages, transcripts or response text. Wrap provider errors with `toSafeError()`; never rethrow raw SDK errors. Anthropic/Bedrock clients are created lazily with `logLevel: 'warn'`. Never set `OLLAMA_DEBUG_LOG_REQUESTS`.
3. **Only `src/lib/env.ts` reads `process.env`** (plus config files and scripts). Never use a `NEXT_PUBLIC_` prefix for anything provider-related.
4. **Every record that can reach a model has a classification** (`general < internal < customer_confidential < export_controlled`). Derive it with `src/db/classification.ts`. Classifications are never lowered automatically; lowering needs the owner role and a logged reason. Generated outputs inherit `max(sources)`.
5. **Routing decisions live only in `src/lib/policy/`** (`matrix.ts` is the single source of truth, also rendered on the Privacy page). export_controlled goes only to local Ollama or an allowlisted GovCloud hostname. Never add a fallback that sends controlled data to the cloud when the local model is down — fail closed.
6. **Redaction is mandatory on every cloud call (including GovCloud)** and not configurable. Tokens look like `[[CUSTOMER_01]]`, `[[PERSON_01]]`, `[[PART_A01]]` and derive from entity IDs. IDs that can end up near prompts are opaque (`PER-01`, `CUS-01`, `PRT-A01`), never name slugs.
7. **Roles are enforced server-side.** Every Server Action and route handler starts with `requireActor()` and `assertCan(...)`. Data access goes through `src/lib/data/*` with the actor. Prompt builders only see `LlmProjection<T>` types. **Prices, margins, shop rates and customer contacts are never sent to any model.**
8. **No domain facts in code or prompts.** The app supplies interviewing *method*; machining facts live only in `seed-data/` (fictional, SME-reviewed) or come from the person being interviewed. Interviewer questions must pass the lexical-novelty check (no technical term, cause, remedy or number the expert didn't say). Machine quirks describe *this unit's* history, never a manufacturer or model-wide defect.
9. **Every knowledge card is traceable** to an exact substring of an expert transcript turn (hand-entered cards get a synthetic manual-entry turn). The traceability gate rejects, it doesn't warn. Only approved cards feed Ask the Shop, Training and coverage.
10. **Honest UI copy.** Never claim the product is ITAR, EAR, DFARS, CMMC, FedRAMP or AS9100 compliant/certified/ready; use "designed to support" and "helps you keep records you label export-controlled away from cloud models". Never say "audio deleted" for Web Speech (the app never receives audio) — use the engine-specific copy in PLAN.md §4.9. Say "nothing leaves this computer" only when the target host is loopback. Replayed AI answers are always labelled `REPLAY`. The fictional-data banner is never removable.
11. **The scripted demo path must always work.** If you change a prompt, the seed, the tokenizer/redactor, retrieval ranking or a task schema, re-record or re-verify cassettes (`npm run demo:record`, `npm run demo:verify`) in the same change. Reserved IDs (`KC-091…094`, `INT-LIVE-RAY`, `DOC-SS-LIVE`) are created only by the scripted flow. Keep every demo step idempotent.

## Stack and versions (see PLAN.md §2)
Node 24 LTS (engines `>=22.13 <27`) · Next.js 16.3.6 App Router + TypeScript 5.9 (not 7) + ESLint 9 (not 10) · React 19.2 · Tailwind CSS 4.3 (CSS-first, no `tailwind.config.js`) · shadcn/ui 4.21 (Radix base) · better-sqlite3 **12.11.1** + drizzle-orm 0.45.3 + drizzle-kit 0.31.11 · `@anthropic-ai/sdk` 0.129.0 · `@anthropic-ai/bedrock-sdk` 0.34.0 · Ollama native `/api/chat` via `fetch` · zod 4 · Vitest 5 + vite 8 · Playwright 1.63 · tsx · qrcode · geist (local fonts).

Next.js 16 docs matching the installed version are in `node_modules/next/dist/docs/` — use them rather than memory (async `params`/`cookies()`, `proxy.ts` instead of middleware, Turbopack default, `next lint` removed).

## Code layout
- `src/app/(app)/*` pages (Server Components) · `src/app/api/*` route handlers (AI streams, exports, uploads) · `src/app/actions/*` Server Actions (short mutations only).
- `src/lib/*` domain modules (ai, policy, redaction, audit, auth, data, retrieval, coverage, interview, speech, demo, seed). `src/db/*` schema, client, reset, classification, FTS. `src/server/*` holds the `import 'server-only'` wrappers — don't import `server-only` in `src/db` or the gateway core (it throws under tsx).
- `seed-data/` all domain content + demo cassettes · `drizzle/` migrations · `scripts/*.mts` · `tests/` (Vitest) · `e2e/` (Playwright) · `data/` runtime (gitignored).

## Next.js conventions
- Every DB read helper calls `await connection()` first, so pages are dynamic and never serve prerendered seed data. Keep `cacheComponents` off; no `use cache` on DB data.
- Mutations = Server Actions (role-checked inside, then `revalidatePath`). AI calls = `POST /api/ai/[task]` returning NDJSON events (`meta`, `text`, `result`, `done`, `error`); token restoration happens on the server before streaming.
- Photo uploads go to a route handler (Server Actions cap bodies at 1 MB). Never serve private photos through `next/image`.
- No `Date.now()` / `Math.random()` / locale-dependent formatting in render paths. Format dates with `en-US` and `timeZone: 'UTC'`. Domain time comes from `getDemoToday()` (fixed `DEMO_TODAY`), never the wall clock; only audit/session timestamps use real time.

## Database conventions
- One synchronous better-sqlite3 connection per process on `globalThis` (WAL, busy timeout 5000, foreign keys on). **Transactions are synchronous** — an async callback throws.
- Migrations: `npm run db:generate` then migrate. **Never `drizzle-kit push`** (it drops the FTS5 tables). FTS5 tables and triggers live in a custom migration; app code never writes to `*_fts` directly.
- **Always sanitize user text before FTS5 `MATCH`** (`src/lib/retrieval/fts-query.ts`). Raw text like `thin-wall` or `Ti-6Al-4V` throws.
- Reset = delete + deterministic reinsert inside one transaction (`src/db/reset.ts`). **Never delete or replace the `.db` file while a server is running.**
- Search text columns (`search_*`) never contain prices or account data.

## AI adapter rules
- Anthropic/Bedrock (Claude 5.x): never send `temperature`, `top_p`, `top_k`, forced `tool_choice`, assistant prefill or `thinking: {type:'disabled'}` (all return 400). Use `output_config.effort` (`low` for interviewer phrasing, `medium` otherwise). Check `stop_reason === 'refusal'`.
- Structured output: hand-written JSON schema (`jsonSchemaOutputFormat(schema, { transform: false })`) on the first-party API; prompt-JSON on Bedrock; `format: z.toJSONSchema(...)` on Ollama. **Always validate with zod in code**, with one repair retry.
- Ollama: always `think: false`, identical `options` on every call (`num_ctx`, `temperature: 0`, `num_predict`), `keep_alive: '60m'`; refuse models with a non-empty `remote_host`.
- Bedrock: `AWS_REGION` and `BEDROCK_MODEL_ID` are required (fail closed); never hardcode model IDs — point to the AWS/Anthropic docs in `.env.example`.
- Citations use per-request source keys `[S1]…`; strip any citation to a source that wasn't sent.

## Seed data conventions (`seed-data/`)
- Editable by a non-programmer SME: YAML for entities and cards, CSV for the expertise matrix, Markdown + frontmatter for transcripts and setup sheets. Every file starts with a comment explaining what to edit.
- Stable, human-typable IDs; never reuse or renumber an ID. Add generated records at the end.
- Deterministic: mulberry32 with per-record sub-seeds; fixed `DEMO_TODAY`; canonical JSON for hashes; LF line endings and NFC normalization.
- Run `npm run seed:check` after any edit (it explains errors with `file:line`). The Reset button replays the last *valid* bundle in `data/seed-bundle.json`.
- Seed content is placeholder wording for SME review; keep scripted-interview facts consistent with Ray's existing cards.

## UI conventions
- Tokens in `src/app/globals.css` (`:root` + `@theme inline`): paper `#FAFAF7`, ink `#16181C`, primary blue `#1D4ED8`, signal orange `#F26B1D` (fills only, **ink text on orange — never white**), signal-strong `#B4480E` for orange strokes/text, muted text `#4B5260`.
- Classification badges and risk bands always combine color + icon + word (never color alone). Hidden-by-role fields render a visible "Hidden for {Role} role" pill.
- Tap targets: 44 px default, 48 px on coarse pointers, 64 px on machine-page actions, 88–96 px for photo/voice/stop. No hover-only, long-press-only or swipe-only interactions. Must work at 1280×720, 820 and 390 px wide without horizontal page scroll.
- The header always shows the active mode and provider (and `REPLAY` in DEMO_MODE).

## Cross-platform (Windows + Ubuntu)
- npm scripts must run under cmd.exe: no `VAR=x cmd`, no `rm -rf`, no single-quoted args. Anything non-trivial is a `scripts/*.mts` file run with tsx. Use `path.join`, never hardcoded separators.
- Keep the DB path a static literal (`path.join(process.cwd(), 'data', 'shopmemory.db')`) so Turbopack doesn't trace the whole project.
- `.gitattributes` enforces LF; don't commit CRLF files.

## Testing
- `npm test` (Vitest, node env) for pure modules: policy, redaction round-trip + stream restorer, coverage golden numbers, seed determinism, FTS sanitizer, cassettes, interview policy, gateway parity, role projection, secret hygiene, architecture rules.
- `npm run test:e2e` (Playwright against a production build on port 3100 with `data/e2e.db`, no egress allowed). In this cloud container set `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194` (the Playwright CDN is blocked); elsewhere run `npx playwright install chromium`.
- Every bug in the demo path gets a regression test before the fix is committed.

## This build environment
- Cloud container: `ui.shadcn.com`, `cdn.playwright.dev`, `ollama.com`, `nextjs.org` and `docs.aws.amazon.com` are blocked; npm registry, raw.githubusercontent.com and platform.claude.com are reachable. If the shadcn CLI can't reach its registry, copy component sources from `shadcn-ui/ui` (`apps/v4/registry/new-york-v4/ui/*.tsx`) and fix imports.
- No Ollama or real API keys here unless the user provides them; DEMO_MODE and stubbed transports cover tests.
