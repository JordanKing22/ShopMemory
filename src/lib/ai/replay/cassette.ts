/**
 * Cassette files (PLAN.md §11.1, docs/AI-GATEWAY.md §11): seed-data/demo-cache/<id>.yaml, snake_case on disk,
 * TOKENIZED (no seed name anywhere). provenance hand_authored = written by hand; the app labels its answers
 * "REPLAY · scripted (not model output)". Parsing validates with zod and reports the file and path, never content.
 */
import { stringify } from "yaml";
import { z } from "zod";
import { PROVIDER_KINDS, TARGET_CLASSES } from "@/db/schema/enums";
import { TASK_NAMES, type CassetteEntry, type CassetteFile } from "../types";

const HASH = z.string().regex(/^[0-9a-f]{64}$/);
const STOP = z.enum(["end_turn", "max_tokens", "refusal", "stop_sequence", "other"]);

const EntryYaml = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/),
    payload_hash: HASH,
    scenario: z.string().regex(/^[a-z0-9_.-]{1,64}$/).nullable().default(null),
    turn_index: z.number().int().nonnegative().nullable().default(null),
    question: z.string().nullable().default(null),
    sources: z.array(z.object({ key: z.string().regex(/^S[1-9][0-9]{0,2}$/), fingerprint: z.string() }).strict()).default([]),
    note: z.string().nullable().default(null),
    response: z
      .object({
        text: z.string(),
        data: z.unknown().nullable().default(null),
        stop_reason: STOP.default("end_turn"),
        usage: z.object({ input_tokens: z.number().int().nullable(), output_tokens: z.number().int().nullable() }).strict(),
        ttft_ms: z.number().nonnegative().nullable().default(null),
        latency_ms: z.number().nonnegative().nullable().default(null),
      })
      .strict(),
  })
  .strict();

export const CassetteYaml = z
  .object({
    format: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,63}$/),
    task: z.enum(TASK_NAMES),
    target_class: z.enum(TARGET_CLASSES),
    prompt_version: z.string().min(1).max(64),
    provenance: z.enum(["recorded", "hand_authored"]),
    recorded_on: z
      .object({ provider_kind: z.enum(PROVIDER_KINDS), model: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
      .strict()
      .nullable()
      .default(null),
    entries: z.array(EntryYaml),
  })
  .strict();

export class CassetteError extends Error {
  constructor(file: string, where: string) {
    super(`${file}: invalid cassette (${where || "file"})`);
    this.name = "CassetteError";
  }
}

export function cassetteFromYaml(file: string, value: unknown): CassetteFile {
  const r = CassetteYaml.safeParse(value);
  if (!r.success) throw new CassetteError(file, r.error.issues[0]?.path.join(".") ?? "");
  const y = r.data;
  const ids = new Set<string>();
  for (const e of y.entries) {
    if (ids.has(e.id)) throw new CassetteError(file, `entries.${e.id} (duplicate id)`);
    ids.add(e.id);
  }
  return {
    format: 1,
    id: y.id,
    task: y.task,
    targetClass: y.target_class,
    promptVersion: y.prompt_version,
    provenance: y.provenance,
    recordedOn: y.recorded_on ? { providerKind: y.recorded_on.provider_kind, model: y.recorded_on.model, date: y.recorded_on.date } : null,
    entries: y.entries.map(
      (e): CassetteEntry => ({
        id: e.id,
        payloadHash: e.payload_hash,
        scenario: e.scenario,
        turnIndex: e.turn_index,
        question: e.question,
        sources: e.sources,
        note: e.note,
        response: {
          text: e.response.text,
          data: e.response.data ?? null,
          stopReason: e.response.stop_reason,
          usage: { inputTokens: e.response.usage.input_tokens, outputTokens: e.response.usage.output_tokens },
          ttftMs: e.response.ttft_ms,
          latencyMs: e.response.latency_ms,
        },
      }),
    ),
  };
}

export function cassetteHeader(file: CassetteFile): string {
  const kind = file.targetClass === "ollama_local" ? "Local mode (Ollama)" : "Cloud mode";
  return [
    `# Replay cassette ${file.id}: ${file.task} task, ${kind}. TOKENIZED: never write a real name, part, job or quote number.`,
    `# provenance hand_authored = written by hand; the app labels it "REPLAY · scripted (not model output)".`,
    `# After a prompt or seed change run: npm run demo:record -- --rekey && npm run demo:verify`,
  ].join("\n");
}

export function cassetteToYaml(file: CassetteFile): string {
  const doc = {
    format: 1,
    id: file.id,
    task: file.task,
    target_class: file.targetClass,
    prompt_version: file.promptVersion,
    provenance: file.provenance,
    recorded_on: file.recordedOn ? { provider_kind: file.recordedOn.providerKind, model: file.recordedOn.model, date: file.recordedOn.date } : null,
    entries: file.entries.map((e) => ({
      id: e.id,
      payload_hash: e.payloadHash,
      scenario: e.scenario,
      turn_index: e.turnIndex,
      question: e.question,
      sources: e.sources,
      note: e.note,
      response: {
        text: e.response.text,
        data: e.response.data ?? null,
        stop_reason: e.response.stopReason,
        usage: { input_tokens: e.response.usage.inputTokens, output_tokens: e.response.usage.outputTokens },
        ttft_ms: e.response.ttftMs,
        latency_ms: e.response.latencyMs,
      },
    })),
  };
  return `${cassetteHeader(file)}\n${stringify(doc, { lineWidth: 0 })}`;
}
