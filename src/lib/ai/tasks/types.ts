/**
 * Task definitions (docs/AI-GATEWAY.md §10.2). A task supplies the METHOD: its prompt template, output shape and
 * offline fallback. It sees only what the gateway hands it — the actor's display name, the user's text and LLM
 * projections of the sent records (S# keys, never DB IDs) — and may not import the database, the data layer or
 * server modules (CLAUDE.md hard rules 1 and 8). Prompt builders never include runtime timestamps.
 */
import type { Capability } from "@/lib/auth/roles";
import type { AIRequestInput, Classification, Effort, FeatureName, JsonObject, OfflineFallback, ProviderMessage, RecordRef, TaskName } from "../types";

/** What the gateway gives a task to build its input from (no DB access). */
export interface TaskContext {
  /** Full name of the acting persona ("Maya Chen"); the redactor tokenizes it for cloud targets. */
  actorName: string;
  input: AIRequestInput;
  /** Records the user pinned (role-visible ones only), in order. */
  pinned: readonly RecordRef[];
}

export interface PromptSource {
  /** "S1"… */
  key: string;
  /** LlmProjection of the record (no pricing, no contacts). */
  projection: unknown;
}

export type TaskOutput =
  | { kind: "text" }
  | { kind: "json"; schemaName: string; jsonSchema: JsonObject; /** zod-validates; throws on invalid */ parse(value: unknown): unknown };

export interface TaskDefinition<P = unknown> {
  name: TaskName;
  features: readonly FeatureName[];
  promptVersion: string;
  capability: Capability;
  /** The request's minimum classification. */
  classificationFloor: Classification;
  consent: "none" | "required";
  /** How many pinned records the task accepts (0 = none). */
  maxPinned: number;
  output: TaskOutput;
  effort: Effort;
  maxTokens: number;
  /** May a replay match by scenario (never for card extraction). */
  scenarioReplay: boolean;
  defaultScenario?: string;
  /** P1: the task's input from the context. */
  prepare(ctx: TaskContext): P;
  /** P6: system + messages from the input and the SENT sources only. */
  buildPrompt(input: P, sources: readonly PromptSource[]): { system: string; messages: ProviderMessage[] };
  /** Deterministic answer when no recording matches in DEMO_MODE (labelled "scripted (not model output)"). */
  offlineFallback(input: P): OfflineFallback;
}

export type TaskRegistry = Partial<Record<TaskName, TaskDefinition>>;
