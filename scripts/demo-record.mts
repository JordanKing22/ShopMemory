// npm run demo:record — keeps the replay cassettes in step with the gateway (PLAN.md §11.1).
//
//   --rekey                          for every manifest request: dry run (P0–P8), set the expected entry's payload hash,
//                                    remap S# keys by source fingerprint; fails if a cited source is no longer sent
//   --author --task T --target X     dry run for those requests; writes skeletons (hash, S# table, redacted prompt) to
//                                    data/demo-skeletons/ (gitignored) for hand-authoring
//   --task T --target anthropic|ollama
//                                    LIVE: runs those requests through runAI() with a real provider (the target is
//                                    applied as the global mode, so decide() and redaction still run) and writes the
//                                    tokenized answers (provenance: recorded). Needs credentials.
//
// Prints IDs, hashes and statuses only (never prompts or answers).
import "./lib/load-env.mts";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { aiAuditLog } from "@/db/schema/system";
import { providerFactoryWith } from "@/lib/ai/providers/factory";
import { cassetteToYaml } from "@/lib/ai/replay/cassette";
import { DEMO_CACHE_DIR, memoryCassetteStore, readCassetteDir, readManifest } from "@/lib/ai/replay/store";
import { TASK_NAMES, type CassetteFile, type ManifestRequest, type TaskName } from "@/lib/ai/types";
import { getEnv } from "@/lib/env";
import { stringify } from "yaml";
import { actorOf, freshDemoDb, gatewayFor, refusingProviders } from "./lib/demo-gateway.mts";
import { out } from "./lib/out";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const env = { ...getEnv(), DEMO_OPEN_CONTROLS: true };
const files = readCassetteDir();
const manifest = readManifest();
const byId = new Map(files.map((f) => [f.id, f]));

function entryFor(m: ManifestRequest): { file: CassetteFile; index: number } {
  const [fileId, entryId] = m.expect.split("#");
  const file = byId.get(fileId);
  const index = file ? file.entries.findIndex((e) => e.id === entryId) : -1;
  if (!file || index < 0) {
    out.error(`${m.id}: expected cassette entry ${m.expect} doesn't exist.`);
    process.exit(1);
  }
  return { file, index };
}

function writeFile(f: CassetteFile): void {
  fs.writeFileSync(path.join(DEMO_CACHE_DIR, `${f.id}.yaml`), cassetteToYaml(f), "utf8");
}

const targetMode = (t: string | undefined) => (t === "ollama" ? "local" : t === "anthropic" ? "cloud" : null);

async function dryRun(m: ManifestRequest) {
  const db = freshDemoDb();
  const gw = gatewayFor(db, env, m, { providers: refusingProviders, store: memoryCassetteStore(files), policy: { demoMode: true, replaySpeed: "instant" } });
  const preview = await gw.runAI(
    { task: m.task, feature: m.feature, actor: actorOf(db, m.personaId), input: m.input, pinned: m.pinned, scenarioHint: m.scenarioHint },
    { dryRun: true },
  );
  db.$client.close();
  return preview;
}

async function rekey(): Promise<void> {
  let failed = false;
  const touched = new Set<string>();
  for (const m of manifest) {
    const { file, index } = entryFor(m);
    const preview = await dryRun(m);
    if (!preview.payloadHash) {
      out.error(`✗ ${m.id}: the request is ${preview.decision.kind} (nothing would be sent), so it can't have a cassette.`);
      failed = true;
      continue;
    }
    const entry = file.entries[index];
    // Remap S# keys by source: a cited record must still be sent.
    const sent = preview.sources.filter((s) => s.sent && s.key && s.fingerprint);
    const remap = new Map<string, string>();
    const sources = [];
    for (const s of entry.sources) {
      const ref = s.fingerprint.split("@")[0];
      const now = sent.find((x) => x.fingerprint!.split("@")[0] === ref);
      if (!now) {
        out.error(`✗ ${m.id}: cited source ${s.key} (${ref}) is no longer sent.`);
        failed = true;
        continue;
      }
      remap.set(s.key, now.key!);
      sources.push({ key: now.key!, fingerprint: now.fingerprint! });
    }
    const text = entry.response.text.replace(/\[(S[1-9][0-9]{0,2})\]/g, (all, k: string) => (remap.has(k) ? `[${remap.get(k)}]` : all));
    const changed = entry.payloadHash !== preview.payloadHash || JSON.stringify(sources) !== JSON.stringify(entry.sources) || text !== entry.response.text;
    file.entries[index] = { ...entry, payloadHash: preview.payloadHash, sources, response: { ...entry.response, text } };
    if (changed) touched.add(file.id);
    out.line(`${changed ? "~" : "="} ${m.id} → ${m.expect} ${preview.payloadHash.slice(0, 12)}`);
  }
  if (failed) {
    out.error("demo:record --rekey failed: no cassette was changed.");
    process.exit(1);
  }
  for (const id of touched) writeFile(byId.get(id)!);
  out.line(`Rekeyed ${manifest.length} requests; ${touched.size} cassette file(s) updated.`);
}

async function author(task: TaskName, target: string): Promise<void> {
  const mode = targetMode(target);
  const dir = path.join(process.cwd(), "data", "demo-skeletons");
  fs.mkdirSync(dir, { recursive: true });
  for (const m of manifest.filter((x) => x.task === task && x.mode === mode)) {
    const p = await dryRun(m);
    const skeleton = {
      request: m.id,
      expect: m.expect,
      payload_hash: p.payloadHash,
      decision: p.decision.kind,
      sources: p.sources.filter((s) => s.sent).map((s) => ({ key: s.key, fingerprint: s.fingerprint })),
      redacted_request: p.request,
    };
    fs.writeFileSync(path.join(dir, `${m.id}.yaml`), `# Skeleton for hand-authoring (tokenized; gitignored).\n${stringify(skeleton, { lineWidth: 0 })}`, "utf8");
    out.line(`wrote data/demo-skeletons/${m.id}.yaml (${p.payloadHash?.slice(0, 12) ?? "no payload"})`);
  }
}

async function record(task: TaskName, target: string): Promise<void> {
  const mode = targetMode(target);
  if (!mode) {
    out.error("--target must be anthropic or ollama.");
    process.exit(1);
  }
  if (target === "anthropic" && !env.ANTHROPIC_API_KEY) {
    out.error("Recording from the Anthropic API needs ANTHROPIC_API_KEY (or FLOORWISE_ANTHROPIC_API_KEY) in your environment or .env.local.");
    process.exit(1);
  }
  const requests = manifest.filter((x) => x.task === task && x.mode === mode);
  if (requests.length === 0) {
    out.error(`No manifest requests for task ${task} in ${mode} mode.`);
    process.exit(1);
  }
  const fileIds = new Set(requests.map((m) => m.expect.split("#")[0]));
  let served: { kind: "anthropic" | "ollama"; model: string } | null = null;
  for (const m of requests) {
    const db = freshDemoDb();
    const gw = gatewayFor(db, env, m, {
      providers: providerFactoryWith(env, {}),
      store: memoryCassetteStore([]),
      policy: { demoMode: false },
    });
    const r = await gw.runAI({ task: m.task, feature: m.feature, actor: actorOf(db, m.personaId), input: m.input, pinned: m.pinned }).collect();
    if (r.error || !r.done?.auditId) {
      out.error(`✗ ${m.id}: ${r.error?.code ?? "no audit row"} — nothing was written.`);
      db.$client.close();
      process.exit(1);
    }
    const row = db.select().from(aiAuditLog).where(eq(aiAuditLog.id, r.done.auditId)).get()!;
    const { file, index } = entryFor(m);
    const entry = file.entries[index];
    file.entries[index] = {
      ...entry,
      payloadHash: row.payloadHash!,
      response: {
        text: row.responseRedacted ?? "",
        data: null,
        stopReason: row.stopReason === "end_turn" || row.stopReason === "stop" ? "end_turn" : row.stopReason === "max_tokens" ? "max_tokens" : "other",
        usage: { inputTokens: row.inputTokens, outputTokens: row.outputTokens },
        ttftMs: row.ttftMs,
        latencyMs: row.latencyMs,
      },
    };
    served = { kind: target === "ollama" ? "ollama" : "anthropic", model: row.servedModel ?? row.model ?? "unknown" };
    out.line(`● ${m.id} → ${m.expect} recorded (${row.payloadHash!.slice(0, 12)}, ${row.latencyMs} ms)`);
    db.$client.close();
  }
  const date = new Date().toISOString().slice(0, 10);
  for (const id of fileIds) {
    const f = byId.get(id)!;
    const all = f.entries.every((e) => requests.some((m) => m.expect === `${f.id}#${e.id}`));
    if (!all) {
      out.error(`✗ ${f.id}: some of its entries aren't in this recording, so the file can't be marked recorded. Nothing was written.`);
      process.exit(1);
    }
    f.provenance = "recorded";
    f.recordedOn = served ? { providerKind: served.kind, model: served.model, date } : null;
    writeFile(f);
    out.line(`wrote seed-data/demo-cache/${f.id}.yaml (provenance: recorded). Now run: npm run demo:verify`);
  }
}

const task = value("task") as TaskName | undefined;
if (task !== undefined && !(TASK_NAMES as readonly string[]).includes(task)) {
  out.error(`Unknown --task. One of: ${TASK_NAMES.join(", ")}`);
  process.exit(1);
}
if (flag("rekey")) await rekey();
else if (flag("author") && task) await author(task, value("target") ?? "anthropic");
else if (task) await record(task, value("target") ?? "anthropic");
else {
  out.line("Usage: npm run demo:record -- --rekey | --author --task <task> --target <anthropic|ollama> | --task <task> --target <anthropic|ollama>");
  process.exit(1);
}
