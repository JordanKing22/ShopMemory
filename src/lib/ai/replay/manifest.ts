/**
 * The demo:verify manifest (seed-data/demo-cache/manifest.yaml): every scripted request that must replay EXACTLY.
 * Each phase appends its requests. snake_case on disk.
 */
import { z } from "zod";
import { AI_MODES } from "@/db/schema/enums";
import { FEATURES, TASK_NAMES, type ManifestRequest } from "../types";

const RefYaml = z.object({ kind: z.string().regex(/^[a-z_]+$/), id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/) }).strict();

export const ManifestYaml = z
  .object({
    format: z.literal(1),
    requests: z.array(
      z
        .object({
          id: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,63}$/),
          phase: z.number().int().min(3).max(8),
          expect: z.string().regex(/^[a-z0-9_.-]+#[A-Za-z0-9_.-]+$/),
          persona_id: z.string(),
          mode: z.enum(AI_MODES),
          cloud_provider: z.enum(["anthropic", "bedrock"]),
          task: z.enum(TASK_NAMES),
          feature: z.enum(FEATURES),
          input: z
            .object({ text: z.string().optional(), turns: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() }).strict()).optional() })
            .strict()
            .nullable()
            .default(null),
          pinned: z.array(RefYaml).default([]),
          scenario_hint: z.string().nullable().default(null),
        })
        .strict(),
    ),
  })
  .strict();

export function manifestFromYaml(value: unknown): ManifestRequest[] {
  const r = ManifestYaml.safeParse(value);
  if (!r.success) throw new Error(`manifest.yaml: invalid (${r.error.issues[0]?.path.join(".") ?? "file"})`);
  const ids = new Set<string>();
  return r.data.requests.map((q) => {
    if (ids.has(q.id)) throw new Error(`manifest.yaml: duplicate request id ${q.id}`);
    ids.add(q.id);
    const m: ManifestRequest = {
      id: q.id,
      phase: q.phase,
      expect: q.expect,
      personaId: q.persona_id,
      mode: q.mode,
      cloudProvider: q.cloud_provider,
      task: q.task,
      feature: q.feature,
    };
    if (q.input) m.input = q.input;
    if (q.pinned.length) m.pinned = q.pinned as ManifestRequest["pinned"];
    if (q.scenario_hint) m.scenarioHint = q.scenario_hint;
    return m;
  });
}
