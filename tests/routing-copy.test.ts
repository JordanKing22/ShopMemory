/**
 * Honest routing copy (CLAUDE.md hard rules 5 and 10; review findings on the provider badge): the header and its
 * details panel never say a label "goes to" / "is sent to" a target the policy blocks or doesn't clear for it.
 */
import { describe, expect, it } from "vitest";
import { CLASSIFICATIONS } from "@/db/schema/enums";
import type { Env } from "@/lib/env";
import { getRoutingSummary, type RoutingSummary } from "@/lib/policy/summary";
import {
  EC_BLOCKED_SENTENCE,
  clearanceListLabel,
  clearanceText,
  ecHeaderLabel,
  ecTargetHeading,
  modeSentence,
  showLocalTarget,
} from "@/lib/routing-copy";
import { env } from "./fixtures/routing-env";

const PROVIDERS = ["Anthropic API", "Amazon Bedrock", "Ollama"];
const summary = (o: Partial<Env>) => getRoutingSummary(env(o));

/** Every sentence the badge renders for this summary. */
function allCopy(s: RoutingSummary): string[] {
  return [modeSentence(s), ecHeaderLabel(s) ?? "", ecTargetHeading(s), ...CLASSIFICATIONS.map((c) => clearanceText(c, s))];
}

function expectNoClaimThatEcIsSent(s: RoutingSummary) {
  for (const text of allCopy(s)) {
    for (const p of PROVIDERS) {
      expect(text, text).not.toMatch(new RegExp(`goes to ${p}`));
    }
  }
  expect(clearanceText("export_controlled", s)).toBe("Export-controlled: not sent in this mode");
  expect(ecHeaderLabel(s)).toBe("EC → blocked");
  expect(ecTargetHeading(s)).toBe("Export-controlled target (blocked)");
  expect(modeSentence(s)).toContain(EC_BLOCKED_SENTENCE);
}

describe("export-controlled copy when the EC target can't take it (fail closed)", () => {
  it("hybrid + HYBRID_EC_TARGET=govcloud with no AWS settings", () => {
    const s = summary({ AI_MODE: "hybrid", HYBRID_EC_TARGET: "govcloud" });
    expect(s.secondary).toMatchObject({ providerLabel: "Amazon Bedrock", targetClass: "bedrock_commercial", configured: false });
    expect(s.clearance.export_controlled).toBe(false);
    expectNoClaimThatEcIsSent(s);
    expect(modeSentence(s)).toBe(`AI requests go to Anthropic API. ${EC_BLOCKED_SENTENCE}`);
  });

  it("hybrid + HYBRID_EC_TARGET=govcloud with a commercial us-east-1 endpoint (configured but not cleared)", () => {
    const s = summary({
      AI_MODE: "hybrid",
      HYBRID_EC_TARGET: "govcloud",
      AWS_REGION: "us-east-1",
      BEDROCK_MODEL_ID: "us.anthropic.claude-sonnet-5-5",
    });
    expect(s.secondary).toMatchObject({ targetClass: "bedrock_commercial", configured: true });
    expectNoClaimThatEcIsSent(s);
  });

  it("hybrid with a LAN Ollama that isn't allowlisted", () => {
    const s = summary({ AI_MODE: "hybrid", OLLAMA_BASE_URL: "http://10.0.0.5:11434" });
    expect(s.secondary).toMatchObject({ providerLabel: "Ollama", configured: false });
    expectNoClaimThatEcIsSent(s);
    for (const text of allCopy(s)) expect(text).not.toContain("on this computer");
  });

  it("local mode with a LAN Ollama that isn't allowlisted: nothing can be sent", () => {
    const s = summary({ LLM_PROVIDER: "ollama", OLLAMA_BASE_URL: "http://10.0.0.5:11434" });
    expect(s.primary.configured).toBe(false);
    expect(modeSentence(s)).toBe("Nothing can be sent: Ollama at 10.0.0.5 isn't a usable local target.");
    expect(modeSentence(s)).not.toMatch(/go(es)? to Ollama/);
    expect(ecHeaderLabel(s)).toBeNull();
    for (const c of CLASSIFICATIONS) expect(clearanceText(c, s)).toMatch(/: not sent to this provider$/);
  });
});

describe("export-controlled copy when the EC target is usable", () => {
  it("hybrid with loopback Ollama names it and says on this computer", () => {
    const s = summary({ AI_MODE: "hybrid" });
    expect(modeSentence(s)).toBe(
      "AI requests go to Anthropic API; anything labeled export-controlled goes to Ollama on this computer instead.",
    );
    expect(ecHeaderLabel(s)).toBe("EC → Ollama · qwen3.5:4b · this computer");
    expect(ecTargetHeading(s)).toBe("Export-controlled requests");
    expect(clearanceText("export_controlled", s)).toBe("Export-controlled: sent only to Ollama on this computer");
    expect(clearanceText("general", s)).toBe("General: sent to Anthropic API");
  });

  it("hybrid with an allowlisted GovCloud endpoint names GovCloud, FIPS and allowlisted", () => {
    const s = summary({
      AI_MODE: "hybrid",
      HYBRID_EC_TARGET: "govcloud",
      AWS_REGION: "us-gov-west-1",
      BEDROCK_MODEL_ID: "us-gov.anthropic.claude-example-v1",
      BEDROCK_BASE_URL: "https://bedrock-runtime-fips.us-gov-west-1.amazonaws.com",
    });
    expect(ecHeaderLabel(s)).toBe("EC → Amazon Bedrock · us-gov-west-1 · FIPS · allowlisted");
    expect(clearanceText("export_controlled", s)).toBe("Export-controlled: sent only to Amazon Bedrock in AWS GovCloud");
    expect(modeSentence(s)).not.toContain("on this computer");
  });
});

describe("hybrid clearance names the real destination of every label", () => {
  it("CUSTOMER_CONFIDENTIAL_CLOUD=deny + Anthropic + loopback Ollama: customer-confidential goes only to Ollama", () => {
    const s = summary({ AI_MODE: "hybrid", CUSTOMER_CONFIDENTIAL_CLOUD: "deny" });
    expect(s.primary.clearance.customer_confidential).toBe(false);
    expect(s.clearance.customer_confidential).toBe(true);

    const cc = clearanceText("customer_confidential", s);
    expect(cc).toBe("Customer-confidential: sent only to Ollama on this computer");
    expect(cc).not.toContain("Anthropic");
    expect(cc).not.toContain("this provider");
    expect(modeSentence(s)).toContain("Customer-confidential records go only to Ollama on this computer.");
    expect(clearanceListLabel(s)).toBe("Which labels can be sent in this mode");
  });

  it("CUSTOMER_CONFIDENTIAL_CLOUD=deny with an unusable local model: customer-confidential is not sent", () => {
    const s = summary({ AI_MODE: "hybrid", CUSTOMER_CONFIDENTIAL_CLOUD: "deny", OLLAMA_BASE_URL: "http://10.0.0.5:11434" });
    expect(clearanceText("customer_confidential", s)).toBe("Customer-confidential: not sent in this mode");
    expect(modeSentence(s)).toContain("Customer-confidential records are not sent in this mode.");
    expect(modeSentence(s)).not.toMatch(/Customer-confidential[^.]*Anthropic/);
  });

  it("Bedrock global profile + CUSTOMER_CONFIDENTIAL_GLOBAL_PROFILE=deny: customer-confidential goes only to Ollama", () => {
    const s = summary({
      AI_MODE: "hybrid",
      LLM_PROVIDER: "bedrock",
      AWS_REGION: "us-east-1",
      BEDROCK_MODEL_ID: "global.anthropic.claude-sonnet-5-5",
      CUSTOMER_CONFIDENTIAL_GLOBAL_PROFILE: "deny",
    });
    expect(s.primary.clearance.customer_confidential).toBe(false);
    const cc = clearanceText("customer_confidential", s);
    expect(cc).toBe("Customer-confidential: sent only to Ollama on this computer");
    expect(cc).not.toContain("Bedrock");
    expect(clearanceText("general", s)).toBe("General: sent to Amazon Bedrock");
  });

  it("GovCloud EC target + customer-confidential denied for the cloud: the local model gets its own block", () => {
    const s = summary({
      AI_MODE: "hybrid",
      HYBRID_EC_TARGET: "govcloud",
      AWS_REGION: "us-gov-west-1",
      BEDROCK_MODEL_ID: "us-gov.anthropic.claude-example-v1",
      BEDROCK_BASE_URL: "https://bedrock-runtime-fips.us-gov-west-1.amazonaws.com",
      CUSTOMER_CONFIDENTIAL_CLOUD: "deny",
    });
    expect(s.routes.customer_confidential).toBe("local");
    expect(showLocalTarget(s)).toBe(true);
    expect(showLocalTarget(summary({ AI_MODE: "hybrid", CUSTOMER_CONFIDENTIAL_CLOUD: "deny" }))).toBe(false);
  });

  it("a hybrid cloud side that isn't configured is never described as receiving requests", () => {
    const s = summary({ AI_MODE: "hybrid", LLM_PROVIDER: "bedrock" });
    expect(s.primary.configured).toBe(false);
    expect(modeSentence(s)).toMatch(/^Nothing is sent to Amazon Bedrock \(it isn't configured\)\./);
    expect(modeSentence(s)).not.toContain("AI requests go to Amazon Bedrock");
    expect(clearanceText("general", s)).toBe("General: sent only to Ollama on this computer");
  });
});

describe("cloud mode", () => {
  it("lists every label the provider doesn't take", () => {
    expect(modeSentence(summary({}))).toBe("AI requests go to Anthropic API. Records labeled export-controlled are not sent to it.");
    expect(modeSentence(summary({ CUSTOMER_CONFIDENTIAL_CLOUD: "deny" }))).toBe(
      "AI requests go to Anthropic API. Records labeled customer-confidential or export-controlled are not sent to it.",
    );
    expect(modeSentence(summary({ LLM_PROVIDER: "bedrock" }))).toBe(
      "Nothing can be sent: Amazon Bedrock isn't configured (see Configuration needs attention).",
    );
    expect(clearanceListLabel(summary({}))).toBe("Which labels this provider may receive");
  });
});
