/**
 * "Send test prompt" on Settings (docs/AI-GATEWAY.md §10.2). The persona's name is in the prompt on purpose: it is what
 * makes a [[PERSON_…]] token visible in the audit row of a cloud call. The reply is asked not to repeat it.
 */
import type { TaskDefinition } from "./types";

export interface SmokeInput {
  actorName: string;
}

export const SMOKE_SYSTEM =
  "You are a connectivity check for a demo application. Reply with one short sentence. Do not repeat names or identifiers from the message.";

export const SMOKE_FALLBACK_TEXT =
  "Offline fallback (scripted, not model output): no recorded reply matched this test prompt, so nothing was sent to a model.";

export const smokeTask: TaskDefinition<SmokeInput> = {
  name: "smoke",
  features: ["settings_test"],
  promptVersion: "smoke-v1",
  capability: "testAiConnection",
  classificationFloor: "internal",
  consent: "none",
  maxPinned: 0,
  output: { kind: "text" },
  effort: "low",
  // Headroom for adaptive thinking: the reply itself is one sentence.
  maxTokens: 1024,
  scenarioReplay: true,
  defaultScenario: "smoke",
  prepare: (ctx) => ({ actorName: ctx.actorName }),
  buildPrompt: (input) => ({
    system: SMOKE_SYSTEM,
    messages: [
      {
        role: "user",
        content: `This is a connectivity check from ${input.actorName} on the Settings page. Reply with one short sentence confirming you received it.`,
      },
    ],
  }),
  offlineFallback: () => ({ text: SMOKE_FALLBACK_TEXT }),
};
