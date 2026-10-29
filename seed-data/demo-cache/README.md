# Demo cache (replay cassettes)

What the app replays in `DEMO_MODE=true` (PLAN.md §11.1). Every file here is **tokenized**: names, customers, part, job
and quote numbers appear only as `[[KIND_XXXX]]` tokens, never as text. Don't type a real name into a cassette.

- `<id>.yaml` — one cassette per task and target class (`smoke.cloud`, `smoke.local`, …). Each entry is keyed by the
  hash of the exact (redacted) payload the gateway would send, so a replay is exact or it isn't used.
- `provenance: hand_authored` means the answer was written by hand. The app labels it
  **"REPLAY · scripted (not model output)"** until it is re-recorded from a real model (`provenance: recorded`).
- `manifest.yaml` — every scripted request `npm run demo:verify` must replay exactly. Each phase appends to it.

After editing a prompt, the seed data, the redactor or a task schema:

```
npm run demo:record -- --rekey     # recompute payload hashes (and S# keys) for every manifest request
npm run demo:verify                # replay every manifest request offline; fails on any miss
```

To record a real answer (needs credentials; the request goes through the same gateway, redacted):

```
npm run demo:record -- --task smoke --target anthropic
npm run demo:record -- --task smoke --target ollama
```
