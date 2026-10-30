# Next session: start here (Phase 4)

Paste the prompt below into a new Claude Code session on the branch that holds Phase 3
(`claude/floorwise-phase-3-yuwh4a`, or wherever it has been merged).

---

Continue building Floorwise (repo ShopMemory). Read CLAUDE.md, then PLAN.md §13 Phase 4, §11 (demo steps 3 and 6c),
the retrieval invariants in §7, and §19. Phases 1–3 are done and pushed. Then read `docs/AI-GATEWAY.md` — it
describes the Phase 3 gateway as built; §17 items 10–18 record where the build changed the draft.

1. Check the environment (names only, never print values): `FLOORWISE_ANTHROPIC_API_KEY` and
   `FLOORWISE_ANTHROPIC_WORKSPACE_ID` (or `ANTHROPIC_WORKSPACE_ID`). In Phase 3 the key was set but no workspace ID
   was, and the API rejected the key without the `anthropic-workspace-id` header, so the smoke cassettes are
   hand-authored ("REPLAY · scripted (not model output)"). If both are set now, first record the smoke cassette live:
   `npm run demo:record -- --task smoke --target anthropic`, then `npm run demo:verify`. If not, tell me and carry on
   in DEMO_MODE.
2. Build Phase 4 per PLAN §13: the retriever (FTS + tags + synonyms + entity boosts, budgeted 8 cards + 4 jobs) plugged
   into the gateway through `GatewayDeps.retrieve`; the real `ask_shop` task (answer prompt with `[S#]` citations;
   the test-only echo task in `tests/helpers/gateway.ts` stays a test helper); the similar-jobs panel; `/ask` with the
   streaming UI (`src/components/ai/read-ndjson.ts`), citation chips, threads, withheld/blocked/held notices, routing
   chip, Re-run, "Ask the Shop about this job", offline fallback; cassettes `step3.ask.cloud` / `step3.ask.local`
   (v1, seeded cards only; author them with `demo:record -- --author` and record live if the key works); the
   retrieval invariant in `seed:check` (Maya's question: exactly one export_controlled record, J-A06, and no
   export_controlled card in the budgeted context); E2E for step 3 and the 6c blocked path (J-A10 in Cloud).
3. Keep `npm run check`, `npm run build`, `npm run demo:verify` and `npm run test:e2e` green (in the cloud container
   set `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1243`); commit "Phase 4: …", push, add the PLAN §19 row, update
   this file for Phase 5, and give me a summary with how to test it.

Open items carried from earlier phases (don't fix unless asked): restricted roles can roughly narrow the hidden
departure factor from visible numbers (Phase 2 note in §19); pattern-token codes are keyed by the public shop seed
(`docs/AI-GATEWAY.md` §17 item 17 — fine for fictional data, a real deployment needs a per-install secret).
