# Floorwise (demo)

A scripted sales demo for CNC and precision machine shops. Floorwise captures senior people's tacit know-how through
an AI interviewer, turns it into expert-approved knowledge cards, and makes it usable by newer employees (Ask the
Shop, setup sheets, training), with a visible privacy layer for shops that handle export-controlled work.

**Everything in this demo is fictional**: the shop ("Ridgeline Precision (fictional)"), its people, customers, parts
and jobs. Don't enter real customer, CUI or export-controlled data.

> Status: **Phase 3 complete** (read-only screens, plus the AI gateway: provider adapters, routing policy, redaction,
> replay cassettes, the audit log and the Settings page). Ask the Shop arrives in Phase 4. See [PLAN.md](PLAN.md) §13
> for the phase plan and §19 for the progress log.

## Quick start (Windows or Ubuntu)

Requires Node.js 24 LTS (22.13+ also works). No build tools are needed: the SQLite driver installs from a prebuilt binary.

```bash
npm ci
npm run seed      # checks seed-data/, creates data/floorwise.db and loads the demo data
npm test
npm run build && npm start   # then open http://127.0.0.1:3000
```

Use the persona menu in the header to switch roles: as Marv (machinist) or Devin (trainee), prices, win/loss and
departure dates show a "Hidden for … role" pill instead of the value.

To record the demo's cached answers or call Claude live, put your Anthropic API key in `.env.local`: run
`npm run env:init` (creates the file from `.env.example`; it is gitignored), open it in a text editor and fill in
`ANTHROPIC_API_KEY=`. In a Claude Code cloud environment, where `ANTHROPIC_API_KEY` is reserved for Claude Code's own
sign-in, add the key as an environment variable named `FLOORWISE_ANTHROPIC_API_KEY` instead. If your key belongs to a
Claude Console **workspace** (the API then answers "must include the anthropic-workspace-id header"), also set
`ANTHROPIC_WORKSPACE_ID` (or `FLOORWISE_ANTHROPIC_WORKSPACE_ID`) to that workspace's ID.
The scripted demo itself runs from those cached answers (`DEMO_MODE=true`) with no key and no network.

**Try the AI plumbing (Phase 3):** open **Settings**, press **Send test prompt** (answers come from a replay labelled
`REPLAY`), then open the row it links to in the **Audit log**: the payload shows the persona's name as a
`[[PERSON_…]]` token, and **Reveal** shows what it stands for. Switch the mode to Local and send again.

## Scripts

| Script | What it does |
|---|---|
| `npm run check` | The pre-commit gate: route types, ESLint, TypeScript, Vitest and `seed:check` |
| `npm run env:init` | Creates `.env.local` from `.env.example` (never overwrites it) for your API key and settings |
| `npm test` | Unit tests (Vitest) |
| `npm run seed:check` | Validates `seed-data/` and explains problems as `file:line` (no database access) |
| `npm run seed` | Validates, then resets the database to the seed data (safe while the app runs) |
| `npm run seed:lock` | Records the seed data fingerprint in `seed-data/seed.lock.json` after an intentional edit |
| `npm run demo:verify` | Replays every recorded AI request in `seed-data/demo-cache/manifest.yaml` through the gateway with no network and checks each one hits its cassette exactly |
| `npm run demo:record -- --rekey` | After a prompt, seed or redactor change: recomputes the cassettes' payload hashes (then run `demo:verify`). `-- --task smoke --target anthropic` records live with your key |
| `npm run test:e2e` | Playwright against a production build on port 3100 (`data/e2e.db`), with outbound connections blocked and checked |
| `npm run db:migrate` | Applies the migrations in `drizzle/` |
| `npm run db:nuke -- --yes` | Deletes the database files (only with the app stopped; use `npm run seed` to reset instead) |
| `npm run dev` / `build` / `start` | Next.js (the server binds to 127.0.0.1) |

## Layout

```
src/app/            Next.js App Router pages, route handlers (/api/ai/*, /api/health, /api/audit/export), Server Actions
src/db/             Drizzle schema, client, classification rules, reset, FTS
src/lib/            domain modules: ai (gateway, providers, replay, tasks), audit, policy (entity detection, routing
                    decisions, notices), redaction, coverage, interview (numbers, traceability), retrieval (FTS
                    sanitizer, similar jobs), seed (loader, generator, checks), data, env, log, time
src/server/         server-only wrappers (the gateway singleton, page queries)
seed-data/          all domain content (YAML, CSV, Markdown) + demo-cache/ (replay cassettes); see seed-data/README.md
drizzle/            migrations (never `drizzle-kit push`: it would drop the FTS tables)
scripts/            npm script implementations (run with tsx)
tests/              Vitest
e2e/                Playwright
docs/               AI-GATEWAY.md (the gateway as built), DATA-LAYER.md, NEXT-SESSION.md
```

`PLAN.md` is the source of truth for architecture, data model and the demo script; `CLAUDE.md` holds the project
conventions.
