/** Test helper: a valid write-ahead input with overridable fields (audit tests). */
import { POLICY_VERSION } from "@/lib/policy/matrix";
import { APP_VERSION, type AuditCompleteInput, type AuditWriteAheadInput } from "@/lib/audit/types";

export function writeAheadInput(over: Partial<AuditWriteAheadInput> = {}): AuditWriteAheadInput {
  return {
    createdAt: "2026-10-01T10:00:00.000Z",
    requestId: "req_test-1",
    actor: { personaId: "P-PER-05", personId: "PER-05", role: "quoter" },
    feature: "settings_test",
    task: "smoke",
    mode: "cloud",
    decision: "allow",
    target: {
      providerKind: "anthropic",
      targetClass: "anthropic",
      model: "claude-sonnet-5-5",
      endpointHost: "api.anthropic.com",
      region: null,
      crossRegion: null,
      isCloud: true,
    },
    transport: "demo_replay_exact",
    cassetteProvenance: "hand_authored",
    maxClassification: "internal",
    classificationsIncluded: ["internal"],
    recordsSent: [],
    recordsWithheld: [],
    notice: null,
    tokensUsed: [],
    userInputRedacted: null,
    requestPayloadRedacted: "{}",
    payloadHash: "0".repeat(64),
    payloadStoredForm: "as_sent_redacted",
    promptVersion: "smoke-v1",
    policyVersion: POLICY_VERSION,
    appVersion: APP_VERSION,
    demoEpoch: 1,
    ...over,
  };
}

export function completeInput(over: Partial<AuditCompleteInput> = {}): AuditCompleteInput {
  const w = writeAheadInput();
  return {
    createdAt: w.createdAt,
    requestId: "req_test-blocked",
    actor: w.actor,
    feature: "ask_shop",
    task: "ask_shop",
    mode: "cloud",
    decision: "blocked",
    target: w.target,
    maxClassification: "export_controlled",
    classificationsIncluded: ["export_controlled"],
    recordsWithheld: [],
    notice: { key: "blocked_request_controlled", params: { recordIds: "J-A10", classification: "export_controlled", providerKind: "anthropic", model: "claude-sonnet-5-5" } },
    tokensUsed: [],
    userInputRedacted: "What went wrong on [[JOB_SXV8]]?",
    promptVersion: "ask-v1",
    policyVersion: POLICY_VERSION,
    appVersion: APP_VERSION,
    demoEpoch: 1,
    ...over,
  };
}
