import { describe, expect, it } from "vitest";
import {
  MINUS,
  formatDate,
  formatHours,
  formatMoneyUSD,
  formatMonths,
  formatNumber,
  formatPct,
  formatProviderLine,
  formatProviderShort,
  formatSignedInt,
  formatSignedPct,
  formatYears,
} from "@/lib/format";

describe("number formatters", () => {
  it("formats hours with one decimal", () => {
    expect(formatHours(41.5)).toBe("41.5 h");
    expect(formatHours(40)).toBe("40.0 h");
    expect(formatHours(1234.56)).toBe("1,234.6 h");
    expect(formatHours(Number.NaN)).toBe("—");
    expect(formatHours(null)).toBe("—");
  });

  it("formats signed percents with a true minus sign and no signed zero", () => {
    expect(formatSignedPct(53.66)).toBe("+53.7 %");
    expect(formatSignedPct(-3.4)).toBe(`${MINUS}3.4 %`);
    expect(formatSignedPct(-3.4)).toBe("−3.4 %");
    expect(formatSignedPct(-0.01)).toBe("0.0 %");
    expect(formatSignedPct(0)).toBe("0.0 %");
    expect(formatSignedPct(12.345, 2)).toBe("+12.35 %");
  });

  it("formats percents", () => {
    expect(formatPct(18.2)).toBe("18.2 %");
    expect(formatPct(18.24, 0)).toBe("18 %");
    expect(formatPct(-2.5)).toBe(`${MINUS}2.5 %`);
    expect(formatPct(undefined)).toBe("—");
  });

  it("formats signed integer deltas", () => {
    expect(formatSignedInt(14)).toBe("+14");
    expect(formatSignedInt(-16)).toBe(`${MINUS}16`);
    expect(formatSignedInt(0)).toBe("0");
    expect(formatSignedInt(-0.2)).toBe("0");
  });

  it("formats US dollars", () => {
    expect(formatMoneyUSD(14884.62)).toBe("$14,884.62");
    expect(formatMoneyUSD(165)).toBe("$165.00");
    expect(formatMoneyUSD(-12.5)).toBe(`${MINUS}$12.50`);
    expect(formatMoneyUSD(-0.001)).toBe("$0.00");
  });

  it("formats months, years and plain numbers", () => {
    expect(formatMonths(20)).toBe("20 mo");
    expect(formatMonths(-3)).toBe(`${MINUS}3 mo`);
    expect(formatYears(31.7)).toBe("31 yrs");
    expect(formatYears(1.2)).toBe("1 yr");
    expect(formatYears(0.4)).toBe("0 yrs");
    expect(formatNumber(1234)).toBe("1,234");
    expect(formatNumber(3.14159, 2)).toBe("3.14");
    expect(formatNumber(-5)).toBe(`${MINUS}5`);
  });

  it("re-exports the UTC date formatter", () => {
    expect(formatDate("2026-09-15")).toBe("Sep 15, 2026");
  });

  it("uses only en-US output regardless of the process locale", () => {
    // Intl is pinned to en-US in the module, so grouping and decimal marks never change.
    expect(formatHours(12345.25)).toMatch(/^12,345\.[23] h$/);
  });
});

describe("provider line (honest copy)", () => {
  const base = { host: "", region: undefined, isLoopback: false };

  it("names the Anthropic API and model", () => {
    expect(
      formatProviderLine({
        ...base,
        targetClass: "anthropic",
        providerLabel: "Anthropic API",
        model: "claude-sonnet-5-5",
        host: "api.anthropic.com",
      }),
    ).toBe("Anthropic API · claude-sonnet-5-5");
  });

  it("shows the Bedrock region (not the long model ID) and flags a global cross-region profile", () => {
    const bedrock = {
      ...base,
      targetClass: "bedrock_commercial",
      providerLabel: "Amazon Bedrock",
      host: "bedrock-runtime.us-east-1.amazonaws.com",
      region: "us-east-1",
      fips: false,
    };
    // PLAN.md §4.11: a global profile can process requests in commercial regions worldwide, so it says so.
    expect(formatProviderLine({ ...bedrock, model: "global.anthropic.example-model", crossRegion: "global" })).toBe(
      "Amazon Bedrock · us-east-1 · global cross-region",
    );
    // Geography and in-region profiles add nothing (no "geo cross-region" suffix).
    expect(formatProviderLine({ ...bedrock, model: "us.anthropic.example-model", crossRegion: "geo" })).toBe("Amazon Bedrock · us-east-1");
    expect(formatProviderLine({ ...bedrock, model: "anthropic.example-model", crossRegion: "none" })).toBe("Amazon Bedrock · us-east-1");
    // An application inference profile ARN hides its scope: shown as unknown, treated as global.
    expect(formatProviderLine({ ...bedrock, model: "arn:aws:bedrock:…:application-inference-profile/x", crossRegion: "unknown" })).toBe(
      "Amazon Bedrock · us-east-1 · cross-region scope unknown (treated as global)",
    );
    // FIPS / allowlisted are only claimed for a qualifying GovCloud target.
    expect(formatProviderLine({ ...bedrock, model: "us.anthropic.example-model", crossRegion: "geo", fips: true })).toBe(
      "Amazon Bedrock · us-east-1",
    );
    expect(
      formatProviderLine({
        ...base,
        targetClass: "bedrock_commercial",
        providerLabel: "Amazon Bedrock",
        model: "",
        host: "",
      }),
    ).toBe("Amazon Bedrock · region not set");
  });

  it("names a qualifying GovCloud endpoint as FIPS · allowlisted (PLAN.md §4.11)", () => {
    const gov = {
      ...base,
      targetClass: "bedrock_govcloud",
      providerLabel: "Amazon Bedrock",
      model: "us-gov.anthropic.claude-example-v1",
      host: "bedrock-runtime-fips.us-gov-west-1.amazonaws.com",
      region: "us-gov-west-1",
      crossRegion: "geo",
    };
    expect(formatProviderLine({ ...gov, fips: true })).toBe("Amazon Bedrock · us-gov-west-1 · FIPS · allowlisted");
    expect(formatProviderLine({ ...gov, fips: false })).toBe("Amazon Bedrock · us-gov-west-1 · allowlisted");
  });

  it('says "this computer" only for a loopback Ollama host', () => {
    const ollama = {
      ...base,
      targetClass: "ollama_local",
      providerLabel: "Ollama",
      model: "qwen3.5:4b",
    };
    expect(formatProviderLine({ ...ollama, host: "127.0.0.1:11434", isLoopback: true })).toBe(
      "Ollama · qwen3.5:4b · this computer",
    );
    const lan = formatProviderLine({ ...ollama, host: "ollama.shop.lan", isLoopback: false, locality: "on_prem" });
    expect(lan).toBe("Ollama · qwen3.5:4b · on-prem");
    expect(lan).not.toContain("this computer");
    expect(
      formatProviderLine({ ...ollama, host: "10.0.0.5", isLoopback: false, locality: "on_prem_unencrypted" }),
    ).toBe("Ollama · qwen3.5:4b · on-prem · unencrypted");
    const remote = formatProviderLine({ ...ollama, host: "gpu.example.com", isLoopback: false, locality: "not_local" });
    expect(remote).toBe("Ollama · qwen3.5:4b · gpu.example.com · not local");
    expect(remote).not.toContain("this computer");
    // A loopback flag is the only thing that produces "this computer", whatever the locality says.
    expect(formatProviderLine({ ...ollama, host: "127.0.0.1", isLoopback: false, locality: "this_computer" })).not.toContain(
      "this computer",
    );
  });

  it("has short provider names for phones", () => {
    expect(formatProviderShort({ providerLabel: "Anthropic API" })).toBe("Anthropic");
    expect(formatProviderShort({ providerLabel: "Amazon Bedrock" })).toBe("Bedrock");
    expect(formatProviderShort({ providerLabel: "Ollama" })).toBe("Ollama");
  });
});
