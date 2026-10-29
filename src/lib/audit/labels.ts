/**
 * Visible labels for audit rows (PLAN.md §4.7, §11.1). Honest copy (CLAUDE.md hard rule 10): every replay says REPLAY,
 * hand-written answers say "scripted (not model output)", seeded rows say "Seeded example (fictional)". Pure.
 */
import type { AuditDecision, AuditOutcome, AuditTransport, CassetteProvenance, PayloadStoredForm, ProviderKind } from "@/db/schema/enums";
import { SCRIPTED_LABEL, SEEDED_ROW_LABEL, isSeededRequestId } from "./types";

export const PROVIDER_NAME: Readonly<Record<ProviderKind, string>> = {
  anthropic: "Anthropic API",
  bedrock: "Amazon Bedrock",
  ollama: "Ollama",
};

export function replayLabel(row: { requestId: string; transport: AuditTransport; cassetteProvenance: CassetteProvenance | null }): string | null {
  if (row.transport === "seeded" || (isSeededRequestId(row.requestId) && row.transport === "none")) return SEEDED_ROW_LABEL;
  if (row.transport === "demo_fallback") return `Offline fallback · ${SCRIPTED_LABEL}`;
  if (row.transport === "demo_replay_exact" || row.transport === "demo_replay_scenario") {
    return row.cassetteProvenance === "hand_authored" ? `REPLAY · ${SCRIPTED_LABEL}` : "REPLAY";
  }
  return null;
}

export function storedFormLabel(form: PayloadStoredForm | null): string | null {
  if (form === "as_sent_redacted") return "sent: redacted · stored: as sent";
  if (form === "redacted_for_storage") return "sent: unredacted (local) · stored: redacted";
  return null;
}

export function providerLine(row: { providerKind: ProviderKind | null; model: string | null }): string {
  if (!row.providerKind) return "No provider";
  return row.model ? `${PROVIDER_NAME[row.providerKind]} · ${row.model}` : PROVIDER_NAME[row.providerKind];
}

export const DECISION_LABEL: Readonly<Record<AuditDecision, string>> = {
  allow: "Sent",
  withheld_partial: "Sent · some records withheld",
  blocked: "Blocked · nothing sent",
  held: "Held · nothing sent",
  user_excluded_controlled: "Sent without controlled records",
};

export const OUTCOME_LABEL: Readonly<Record<AuditOutcome, string>> = {
  pending: "In progress",
  ok: "OK",
  refusal: "Model declined",
  invalid_output: "Invalid output",
  provider_error: "Provider error",
  blocked: "Blocked",
  held: "Held",
  aborted: "Cancelled",
  timeout: "Timed out",
};

export const FEATURE_LABEL: Readonly<Record<string, string>> = {
  settings_test: "Settings · test prompt",
  ask_shop: "Ask the Shop",
  interviewer: "AI Interviewer",
  card_extraction: "Card extraction",
  quote_log: "Quote Reasoning Log",
  document_generator: "Document Generator",
  training: "Training",
};

export const TRANSPORT_LABEL: Readonly<Record<AuditTransport, string>> = {
  live: "Live call",
  demo_replay_exact: "Replay (exact match)",
  demo_replay_scenario: "Replay (scenario match)",
  demo_fallback: "Offline fallback",
  none: "Nothing sent",
  seeded: "Seeded example",
};
