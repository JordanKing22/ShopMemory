// npm run demo:verify — replays every request in seed-data/demo-cache/manifest.yaml through the real gateway on a fresh
// in-memory database, with NO network (a no-egress guard is installed and every provider refuses), and checks each one
// is served by exactly the expected cassette entry. Prints IDs and statuses only. Exit 1 on any failure.
import "./lib/load-env.mts";
import "../e2e/no-egress.cjs";
import { readCassetteDir, readManifest, memoryCassetteStore } from "@/lib/ai/replay/store";
import { createTransportResolver } from "@/lib/ai/replay/lookup";
import { getEnv } from "@/lib/env";
import { dictionaryHits } from "@/lib/redaction/dictionary";
import { cachedRedactionDictionary } from "@/lib/data/dictionary";
import { actorOf, freshDemoDb, gatewayFor, refusingProviders, spyResolver } from "./lib/demo-gateway.mts";
import { out } from "./lib/out";

export interface VerifyResult {
  failures: string[];
  handAuthored: string[];
  checked: number;
}

export async function verifyCassettes(): Promise<VerifyResult> {
  const files = readCassetteDir();
  const manifest = readManifest();
  const store = memoryCassetteStore(files);
  const db = freshDemoDb();
  // The scripted path runs with the demo's open controls (any persona may send the Settings test prompt).
  const env = { ...getEnv(), DEMO_OPEN_CONTROLS: true };
  const dict = cachedRedactionDictionary(db);
  const failures: string[] = [];

  for (const f of files) {
    for (const e of f.entries) {
      if ([e.response.text, e.question ?? "", e.note ?? ""].some((t) => dictionaryHits(t, dict).length > 0)) {
        failures.push(`${f.id}#${e.id}: contains a name or record number (cassettes must be tokenized)`);
      }
    }
  }

  for (const m of manifest) {
    const spy = spyResolver(createTransportResolver(store));
    const gw = gatewayFor(db, env, m, {
      providers: refusingProviders,
      store,
      transports: spy.resolver,
      policy: { demoMode: true, demoMiss: "offline", demoLiveLocal: false, replaySpeed: "instant" },
    });
    const r = await gw
      .runAI({ task: m.task, feature: m.feature, actor: actorOf(db, m.personaId), input: m.input, pinned: m.pinned, scenarioHint: m.scenarioHint })
      .collect();
    const served = spy.last();
    if (r.error) failures.push(`${m.id}: error ${r.error.code}`);
    else if (r.done?.transport !== "demo_replay_exact") failures.push(`${m.id}: served by ${r.done?.transport ?? "nothing"} (expected an exact replay of ${m.expect})`);
    else if (served?.cassetteEntry !== m.expect) failures.push(`${m.id}: served by ${served?.cassetteEntry ?? "?"} (expected ${m.expect})`);
  }

  const handAuthored = files.filter((f) => f.provenance === "hand_authored").map((f) => f.id);
  db.$client.close();
  return { failures, handAuthored, checked: manifest.length };
}

const isMain = process.argv[1] && /demo-verify\.mts$/.test(process.argv[1]);
if (isMain) {
  const r = await verifyCassettes();
  for (const f of r.failures) out.error(`✗ ${f}`);
  if (r.handAuthored.length > 0) out.warn(`! hand-authored cassettes still in the scripted path (labelled "scripted (not model output)"): ${r.handAuthored.join(", ")}`);
  if (r.failures.length > 0) {
    out.error(`demo:verify failed: ${r.failures.length} of ${r.checked} checks.`);
    process.exit(1);
  }
  out.line(`demo:verify passed: ${r.checked} manifest requests replayed exactly, no network used.`);
}
