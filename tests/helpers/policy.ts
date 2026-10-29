/** Test helpers: policy targets and request classifications built from a hermetic env (tests/fixtures/routing-env). */
import type { Classification } from "@/db/schema/enums";
import { descriptorFor } from "@/lib/ai/descriptor";
import type { RecordRef } from "@/lib/ai/types";
import type { Env } from "@/lib/env";
import type { SuspicionSignal } from "@/lib/policy/entity-detect";
import { routingTargetFor, type ProviderKind } from "@/lib/policy/summary";
import type { BudgetedRecord, PolicyTarget, RequestClassification } from "@/lib/policy/types";

export function policyTarget(kind: ProviderKind, e: Env, available = true): PolicyTarget {
  const built = routingTargetFor(kind, e);
  return { descriptor: descriptorFor(built.target, { available, verified: "config-only-demo" }), opts: built.opts };
}

export function request(floor: Classification, signals: SuspicionSignal[] = []): RequestClassification {
  return {
    floor,
    sources: { text: floor, session: "general", pinned: "general", task: "general" },
    mentions: [],
    signals,
    detectorHit: signals.length > 0,
  };
}

export function budget(...items: [RecordRef["kind"], string, Classification][]): BudgetedRecord[] {
  return items.map(([kind, id, classification], i) => ({ ref: { kind, id }, classification, rank: i + 1 }));
}

export const SIGNAL: SuspicionSignal = {
  kind: "numeric_core",
  recordId: "PRT-G01",
  recordKind: "part",
  surface: "4410",
  start: 4,
  end: 8,
  classification: "export_controlled",
};

/** A GovCloud-qualified Bedrock configuration (FIPS host on the default allowlist). */
export const GOVCLOUD: Partial<Env> = {
  LLM_PROVIDER: "bedrock",
  AWS_REGION: "us-gov-west-1",
  BEDROCK_MODEL_ID: "us-gov.anthropic.claude-sonnet-x",
  BEDROCK_BASE_URL: "https://bedrock-runtime-fips.us-gov-west-1.amazonaws.com",
};
