/**
 * Consent text shown before an interview or quote log (PLAN.md §4.9). consent_records store the version and the
 * SHA-256 of the exact text shown, so any wording change needs a new version. Phase 5 adds the speech-engine line.
 */
import { createHash } from "node:crypto";
import type { TARGET_CLASSES } from "@/db/schema/enums";

export type TargetClass = (typeof TARGET_CLASSES)[number];

export const CONSENT_VERSIONS = ["consent-v1"] as const;
export type ConsentVersion = (typeof CONSENT_VERSIONS)[number];

const DESTINATION: Record<TargetClass, string> = {
  anthropic: "Your answers are sent to the Anthropic API with names replaced by tokens.",
  bedrock_commercial: "Your answers are sent to Amazon Bedrock in this company's AWS account with names replaced by tokens.",
  bedrock_govcloud: "Your answers are sent to an allowlisted AWS GovCloud endpoint with names replaced by tokens.",
  ollama_local: "Your answers are sent to the local model on this computer.",
};

export function consentText(version: ConsentVersion, target: TargetClass): string {
  switch (version) {
    case "consent-v1":
      return [
        "Floorwise will record this interview as text so your know-how can be turned into draft knowledge cards.",
        DESTINATION[target],
        "Nothing becomes shop knowledge until you review and approve it, and every approved card is credited to you.",
        "You can stop at any time. Withdrawing deletes the transcript and unapproved drafts. Approved cards, the AI-call audit log (names tokenized) and any retention by the AI provider under its terms are not affected.",
      ].join("\n");
  }
}

export function consentTextSha256(version: ConsentVersion, target: TargetClass): string {
  return createHash("sha256").update(consentText(version, target), "utf8").digest("hex");
}

export function isConsentVersion(v: string): v is ConsentVersion {
  return (CONSENT_VERSIONS as readonly string[]).includes(v);
}
