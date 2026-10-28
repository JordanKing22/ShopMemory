# Next session: start here (Phase 3)

Paste the prompt below into a new Claude Code session on branch `claude/shopmemory-demo-brief-bhujcu`.

---

Continue building Floorwise (repo ShopMemory, branch `claude/shopmemory-demo-brief-bhujcu`). Read CLAUDE.md,
then PLAN.md §13 Phase 3 and §19. Phases 1 and 2 are done and pushed.

1. Check the environment (names only, never print values): `FLOORWISE_ANTHROPIC_API_KEY` should be set. The key
   is valid but NOT scoped to a workspace: the API answers "must include the anthropic-workspace-id header".
   Add `FLOORWISE_ANTHROPIC_WORKSPACE_ID` (or `ANTHROPIC_WORKSPACE_ID`) to `src/lib/env.ts` and send it as the
   `anthropic-workspace-id` default header in the Anthropic adapter. If no workspace ID variable is set, tell me
   and carry on in DEMO_MODE (hand-authored smoke cassette).
2. Phase 3 was started but the build run stopped on a usage limit. A DRAFT contract is committed:
   `docs/AI-GATEWAY.md` plus shared types (`src/lib/ai/types.ts`, `src/lib/ai/errors.ts`, `src/lib/policy/types.ts`,
   `src/lib/redaction/`, `src/lib/audit/`), new capabilities in `roles.ts`, enum values and migration 0003.
   Review the draft against PLAN §4 and continue from it (fix it where it is wrong).
3. Build Phase 3 per PLAN §13: runAI() gateway + P0–P8/R1–R6 pipeline, Anthropic/Bedrock/Ollama adapters
   (explicit baseURL; Sonnet 5.5: never temperature/top_p/top_k, thinking disabled, forced tool_choice or
   prefill; effort via output_config.effort; no server-side refusal fallbacks), policy decide/notices,
   redaction core + StreamRestorer, ReplayTransport + cassettes + demo:record/demo:verify, audit log +
   ~20 seeded history rows, /settings (Send test prompt), /audit (Reveal, export), /api/health, /api/ai/*,
   lint/architecture/secret-hygiene/no-egress tests. Record the smoke cassette live if the key works.
4. Keep `npm run check`, `npm run build` and `npm run test:e2e` green; commit "Phase 3: …", push, add the
   PLAN §19 row, and give me a summary with how to test it.
