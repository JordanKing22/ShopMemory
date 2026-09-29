# Floorwise (demo)

A scripted sales demo for CNC and precision machine shops. Floorwise captures senior people's tacit know-how through
an AI interviewer, turns it into expert-approved knowledge cards, and makes it usable by newer employees (Ask the
Shop, setup sheets, training), with a visible privacy layer for shops that handle export-controlled work.

**Everything in this demo is fictional**: the shop ("Ridgeline Precision (fictional)"), its people, customers, parts
and jobs. Don't enter real customer, CUI or export-controlled data.

> Status: **Phase 1a** (schema, seed engine, demo-critical seed data). The screens arrive in Phase 2. See
> [PLAN.md](PLAN.md) §13 for the phase plan and §19 for the progress log.

## Quick start (Windows or Ubuntu)

Requires Node.js 24 LTS (22.13+ also works). No build tools are needed: the SQLite driver installs from a prebuilt binary.

```bash
npm ci
npm run seed      # checks seed-data/, creates data/floorwise.db and loads the demo data
npm test
```

Later phases need an Anthropic API key in `.env.local` (copy `.env.example`) to record the demo's cached answers.
The scripted demo itself runs from those cached answers (`DEMO_MODE=true`) with no key and no network.

## Scripts

| Script | What it does |
|---|---|
| `npm run check` | The pre-commit gate: route types, ESLint, TypeScript, Vitest and `seed:check` |
| `npm test` | Unit tests (Vitest) |
| `npm run seed:check` | Validates `seed-data/` and explains problems as `file:line` (no database access) |
| `npm run seed` | Validates, then resets the database to the seed data (safe while the app runs) |
| `npm run seed:lock` | Records the seed data fingerprint in `seed-data/seed.lock.json` after an intentional edit |
| `npm run db:migrate` | Applies the migrations in `drizzle/` |
| `npm run db:nuke -- --yes` | Deletes the database files (only with the app stopped; use `npm run seed` to reset instead) |
| `npm run dev` / `build` / `start` | Next.js (the server binds to 127.0.0.1) |

## Layout

```
src/app/            Next.js App Router pages (Phase 2+)
src/db/             Drizzle schema, client, classification rules, reset, FTS
src/lib/            domain modules: coverage, interview (numbers, traceability), policy (entity detection),
                    retrieval (FTS sanitizer, similar jobs), seed (loader, generator, checks), env, log, time
seed-data/          all domain content (YAML, CSV, Markdown); see seed-data/README.md
drizzle/            migrations (never `drizzle-kit push`: it would drop the FTS tables)
scripts/            npm script implementations (run with tsx)
tests/              Vitest
```

`PLAN.md` is the source of truth for architecture, data model and the demo script; `CLAUDE.md` holds the project
conventions.
