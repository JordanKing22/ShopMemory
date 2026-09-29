import { describe, expect, it } from "vitest";
import type { Env } from "@/lib/env";
import { ANTHROPIC_BASE_URL_DEFAULT, bedrockMantleBaseUrl, bedrockRuntimeBaseUrl, hostOf, resolveBedrockBaseUrl } from "@/lib/ai/endpoints";
import { getRoutingSummary, resolveCloudProvider, resolveMode } from "@/lib/policy/summary";
import { env } from "./fixtures/routing-env";

const ALL = { general: true, internal: true, customer_confidential: true, export_controlled: true };
const NONE = { general: false, internal: false, customer_confidential: false, export_controlled: false };
const NO_EC = { ...ALL, export_controlled: false };

const GOV = {
  LLM_PROVIDER: "bedrock" as const,
  AWS_REGION: "us-gov-west-1",
  BEDROCK_MODEL_ID: "us-gov.anthropic.claude-example-v1",
  BEDROCK_BASE_URL: "https://bedrock-runtime-fips.us-gov-west-1.amazonaws.com",
};

describe("endpoints", () => {
  it("builds the explicit base URLs the adapters will pass", () => {
    expect(ANTHROPIC_BASE_URL_DEFAULT).toBe("https://api.anthropic.com");
    expect(bedrockRuntimeBaseUrl("us-east-1")).toBe("https://bedrock-runtime.us-east-1.amazonaws.com");
    expect(bedrockMantleBaseUrl("us-east-1")).toBe("https://bedrock-mantle.us-east-1.api.aws/anthropic");
    expect(resolveBedrockBaseUrl({ region: "us-east-1", endpointMode: "runtime", baseUrlOverride: undefined })).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com",
    );
    expect(resolveBedrockBaseUrl({ region: undefined, endpointMode: "runtime", baseUrlOverride: undefined })).toBeNull();
    expect(resolveBedrockBaseUrl({ region: "../evil", endpointMode: "runtime", baseUrlOverride: undefined })).toBeNull();
    expect(hostOf("http://[::1]:11434")).toBe("[::1]");
    expect(hostOf("not a url")).toBeNull();
  });
});

describe("mode and provider precedence (env only in Phase 2)", () => {
  it("defaults to cloud + Anthropic, and to local when LLM_PROVIDER=ollama", () => {
    expect(resolveMode(env())).toBe("cloud");
    expect(resolveMode(env({ LLM_PROVIDER: "ollama" }))).toBe("local");
    expect(resolveMode(env({ LLM_PROVIDER: "ollama", AI_MODE: "hybrid" }))).toBe("hybrid");
    expect(resolveMode(env({ AI_MODE: "local" }))).toBe("local");
    expect(resolveCloudProvider(env())).toBe("anthropic");
    expect(resolveCloudProvider(env({ LLM_PROVIDER: "bedrock" }))).toBe("bedrock");
    expect(resolveCloudProvider(env({ LLM_PROVIDER: "ollama", HYBRID_CLOUD_PROVIDER: "bedrock" }))).toBe("bedrock");
  });
});

describe("getRoutingSummary", () => {
  it("cloud / Anthropic default", () => {
    const s = getRoutingSummary(env());
    expect(s.mode).toBe("cloud");
    expect(s.source).toBe("env");
    expect(s.demoMode).toBe(true);
    expect(s.secondary).toBeUndefined();
    expect(s.primary).toMatchObject({
      targetClass: "anthropic",
      providerKind: "anthropic",
      providerLabel: "Anthropic API",
      model: "claude-sonnet-5-5",
      host: "api.anthropic.com",
      isLoopback: false,
      isCloud: true,
      redacted: true,
      configured: true,
      coveredModel: false,
    });
    expect(s.primary.region).toBeUndefined();
    expect(s.clearance).toEqual(NO_EC);
    expect(s.configProblems).toEqual([]);
  });

  it("never honours ANTHROPIC_BASE_URL (the host comes from the adapter's explicit base URL)", () => {
    const s = getRoutingSummary(env({ ANTHROPIC_BASE_URL: "http://127.0.0.1:8080", ANTHROPIC_BEDROCK_BASE_URL: "http://127.0.0.1:9090" }));
    expect(s.primary.host).toBe("api.anthropic.com");
    expect(s.primary.isLoopback).toBe(false);
  });

  it("CUSTOMER_CONFIDENTIAL_CLOUD=deny removes customer-confidential from Cloud mode", () => {
    expect(getRoutingSummary(env({ CUSTOMER_CONFIDENTIAL_CLOUD: "deny" })).clearance).toEqual({
      ...NO_EC,
      customer_confidential: false,
    });
  });

  it("local / Ollama on this computer", () => {
    const s = getRoutingSummary(env({ LLM_PROVIDER: "ollama" }));
    expect(s.mode).toBe("local");
    expect(s.primary).toMatchObject({
      targetClass: "ollama_local",
      providerKind: "ollama",
      providerLabel: "Ollama",
      model: "qwen3.5:4b",
      host: "127.0.0.1",
      isLoopback: true,
      isCloud: false,
      redacted: false,
      configured: true,
      locality: "this_computer",
    });
    expect(s.clearance).toEqual(ALL);
    expect(s.configProblems).toEqual([]);
    expect(getRoutingSummary(env({ AI_MODE: "local", OLLAMA_BASE_URL: "http://localhost:11434" })).primary.isLoopback).toBe(true);
  });

  it("local / Ollama on an allowlisted on-prem host is local but not loopback", () => {
    const s = getRoutingSummary(
      env({ LLM_PROVIDER: "ollama", OLLAMA_BASE_URL: "https://gpu-box.shop.lan:11434", OLLAMA_HOST_ALLOWLIST: ["gpu-box.shop.lan"] }),
    );
    expect(s.primary).toMatchObject({ host: "gpu-box.shop.lan", isLoopback: false, configured: true, locality: "on_prem" });
    expect(s.clearance).toEqual(ALL);
    expect(s.configProblems).toEqual([]);

    const plain = getRoutingSummary(
      env({
        LLM_PROVIDER: "ollama",
        OLLAMA_BASE_URL: "http://gpu-box.shop.lan:11434",
        OLLAMA_HOST_ALLOWLIST: ["gpu-box.shop.lan"],
        OLLAMA_ALLOW_PLAINTEXT_LAN: true,
      }),
    );
    expect(plain.primary).toMatchObject({ isLoopback: false, locality: "on_prem_unencrypted", configured: true });
  });

  it("local / Ollama on a non-loopback host that isn't allowlisted is not usable (fail closed)", () => {
    const s = getRoutingSummary(env({ LLM_PROVIDER: "ollama", OLLAMA_BASE_URL: "http://192.168.1.20:11434" }));
    expect(s.primary).toMatchObject({ host: "192.168.1.20", isLoopback: false, configured: false, locality: "not_local" });
    expect(s.clearance).toEqual(NONE);
    expect(s.configProblems).toEqual(["OLLAMA_BASE_URL is not this computer and its host is not in OLLAMA_HOST_ALLOWLIST"]);

    const http = getRoutingSummary(
      env({ LLM_PROVIDER: "ollama", OLLAMA_BASE_URL: "http://gpu-box.shop.lan:11434", OLLAMA_HOST_ALLOWLIST: ["gpu-box.shop.lan"] }),
    );
    expect(http.clearance).toEqual(NONE);
    expect(http.configProblems).toEqual(["OLLAMA_BASE_URL must use https for an on-prem host (or set OLLAMA_ALLOW_PLAINTEXT_LAN=true)"]);
  });

  it("hybrid: cloud primary plus the local EC target", () => {
    const s = getRoutingSummary(env({ AI_MODE: "hybrid" }));
    expect(s.mode).toBe("hybrid");
    expect(s.primary).toMatchObject({ targetClass: "anthropic", host: "api.anthropic.com" });
    expect(s.secondary).toMatchObject({ targetClass: "ollama_local", providerLabel: "Ollama", host: "127.0.0.1", isLoopback: true });
    expect(s.clearance).toEqual(ALL);
    expect(s.configProblems).toEqual([]);
  });

  it("hybrid with LLM_PROVIDER=ollama uses HYBRID_CLOUD_PROVIDER for the cloud side", () => {
    const s = getRoutingSummary(env({ LLM_PROVIDER: "ollama", AI_MODE: "hybrid" }));
    expect(s.primary.targetClass).toBe("anthropic");
    expect(s.secondary?.targetClass).toBe("ollama_local");
  });

  it("hybrid with an unusable local model can't send export-controlled records (no cloud fallback)", () => {
    const s = getRoutingSummary(env({ AI_MODE: "hybrid", OLLAMA_BASE_URL: "http://192.168.1.20:11434" }));
    expect(s.clearance).toEqual(NO_EC);
    expect(s.configProblems).toContain("OLLAMA_BASE_URL is not this computer and its host is not in OLLAMA_HOST_ALLOWLIST");
  });

  it("hybrid sends customer-confidential to local when the cloud may not take it", () => {
    expect(getRoutingSummary(env({ AI_MODE: "hybrid", CUSTOMER_CONFIDENTIAL_CLOUD: "deny" })).clearance).toEqual(ALL);
    expect(
      getRoutingSummary(env({ AI_MODE: "hybrid", CUSTOMER_CONFIDENTIAL_CLOUD: "deny", OLLAMA_BASE_URL: "http://192.168.1.20:11434" })).clearance,
    ).toEqual({ ...NO_EC, customer_confidential: false });
  });

  it("hybrid with HYBRID_EC_TARGET=govcloud uses a qualifying GovCloud endpoint as the EC target", () => {
    const s = getRoutingSummary(env({ AI_MODE: "hybrid", HYBRID_EC_TARGET: "govcloud", ...GOV, LLM_PROVIDER: "anthropic" }));
    expect(s.primary.targetClass).toBe("anthropic");
    expect(s.secondary).toMatchObject({
      targetClass: "bedrock_govcloud",
      providerLabel: "Amazon Bedrock",
      host: "bedrock-runtime-fips.us-gov-west-1.amazonaws.com",
      region: "us-gov-west-1",
      fips: true,
      redacted: true,
    });
    expect(s.clearance).toEqual(ALL);
    expect(s.configProblems).toEqual([]);
  });

  it("hybrid with HYBRID_EC_TARGET=govcloud and a commercial endpoint can't send export-controlled records", () => {
    const s = getRoutingSummary(
      env({ AI_MODE: "hybrid", HYBRID_EC_TARGET: "govcloud", AWS_REGION: "us-east-1", BEDROCK_MODEL_ID: "us.anthropic.claude-sonnet-5-5" }),
    );
    expect(s.secondary?.targetClass).toBe("bedrock_commercial");
    expect(s.clearance.export_controlled).toBe(false);
    expect(s.configProblems).toContain("HYBRID_EC_TARGET=govcloud needs a Bedrock endpoint that passes the GovCloud checks");
  });

  it("bedrock without AWS_REGION and BEDROCK_MODEL_ID fails closed with a named config problem", () => {
    const s = getRoutingSummary(env({ LLM_PROVIDER: "bedrock" }));
    expect(s.primary).toMatchObject({
      targetClass: "bedrock_commercial",
      providerLabel: "Amazon Bedrock",
      model: "",
      host: "",
      configured: false,
    });
    expect(s.primary.region).toBeUndefined();
    expect(s.clearance).toEqual(NONE);
    expect(s.configProblems).toEqual(["Amazon Bedrock needs AWS_REGION and BEDROCK_MODEL_ID"]);

    const noModel = getRoutingSummary(env({ LLM_PROVIDER: "bedrock", AWS_REGION: "us-east-1" }));
    expect(noModel.configProblems).toEqual(["Amazon Bedrock needs BEDROCK_MODEL_ID"]);
    expect(noModel.primary.host).toBe("bedrock-runtime.us-east-1.amazonaws.com");
    expect(noModel.clearance).toEqual(NONE);
  });

  it("config problems name settings, never their values", () => {
    const s = getRoutingSummary(
      env({ LLM_PROVIDER: "bedrock", AWS_REGION: "zz-canary-region", BEDROCK_MODEL_ID: "canary-model", BEDROCK_BASE_URL: "http://canary.example" }),
    );
    expect(s.configProblems).toEqual(["AWS_REGION is not a valid AWS region name", "BEDROCK_BASE_URL must be a valid https URL"]);
    expect(s.configProblems.join(" ")).not.toMatch(/canary/);
    expect(s.clearance).toEqual(NONE);
  });

  it("bedrock commercial: regional host, cross-region scope and the global-profile rule", () => {
    const s = getRoutingSummary(env({ LLM_PROVIDER: "bedrock", AWS_REGION: "us-east-1", BEDROCK_MODEL_ID: "global.anthropic.claude-sonnet-5-5" }));
    expect(s.primary).toMatchObject({
      targetClass: "bedrock_commercial",
      host: "bedrock-runtime.us-east-1.amazonaws.com",
      region: "us-east-1",
      crossRegion: "global",
      fips: false,
      endpointMode: "runtime",
      isLoopback: false,
      configured: true,
    });
    expect(s.clearance).toEqual(NO_EC);
    expect(s.configProblems).toEqual([]);

    const denyGlobal = getRoutingSummary(
      env({
        LLM_PROVIDER: "bedrock",
        AWS_REGION: "us-east-1",
        BEDROCK_MODEL_ID: "global.anthropic.claude-sonnet-5-5",
        CUSTOMER_CONFIDENTIAL_GLOBAL_PROFILE: "deny",
      }),
    );
    expect(denyGlobal.clearance).toEqual({ ...NO_EC, customer_confidential: false });

    const geo = getRoutingSummary(
      env({ LLM_PROVIDER: "bedrock", AWS_REGION: "us-east-1", BEDROCK_MODEL_ID: "us.anthropic.claude-sonnet-5-5", CUSTOMER_CONFIDENTIAL_GLOBAL_PROFILE: "deny" }),
    );
    expect(geo.primary.crossRegion).toBe("geo");
    expect(geo.clearance).toEqual(NO_EC);
  });

  it("bedrock with an application inference profile ARN: scope unknown, treated as global (fail closed)", () => {
    const appProfile = "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/a1b2c3d4e5f6";
    const deny = getRoutingSummary(
      env({ LLM_PROVIDER: "bedrock", AWS_REGION: "us-east-1", BEDROCK_MODEL_ID: appProfile, CUSTOMER_CONFIDENTIAL_GLOBAL_PROFILE: "deny" }),
    );
    expect(deny.primary.crossRegion).toBe("unknown");
    expect(deny.primary.configured).toBe(true);
    expect(deny.clearance.customer_confidential).toBe(false);
    expect(deny.clearance).toEqual({ ...NO_EC, customer_confidential: false });
    expect(deny.routes.customer_confidential).toBe("blocked");

    const allow = getRoutingSummary(env({ LLM_PROVIDER: "bedrock", AWS_REGION: "us-east-1", BEDROCK_MODEL_ID: appProfile }));
    expect(allow.clearance).toEqual(NO_EC);

    // Hybrid: the application profile can't take customer-confidential, so it goes to the local model instead.
    const hybrid = getRoutingSummary(
      env({
        AI_MODE: "hybrid",
        LLM_PROVIDER: "bedrock",
        AWS_REGION: "us-east-1",
        BEDROCK_MODEL_ID: appProfile,
        CUSTOMER_CONFIDENTIAL_GLOBAL_PROFILE: "deny",
      }),
    );
    expect(hybrid.routes.customer_confidential).toBe("local");
  });

  it("bedrock derives the host from BEDROCK_BASE_URL when set, and from the Mantle default otherwise", () => {
    const vpc = getRoutingSummary(
      env({
        LLM_PROVIDER: "bedrock",
        AWS_REGION: "us-east-1",
        BEDROCK_MODEL_ID: "us.anthropic.claude-sonnet-5-5",
        BEDROCK_BASE_URL: "https://vpce-0abc.bedrock-runtime.us-east-1.vpce.amazonaws.com",
      }),
    );
    expect(vpc.primary.host).toBe("vpce-0abc.bedrock-runtime.us-east-1.vpce.amazonaws.com");

    const mantle = getRoutingSummary(
      env({ LLM_PROVIDER: "bedrock", AWS_REGION: "us-west-2", BEDROCK_MODEL_ID: "anthropic.claude-sonnet-5-5", BEDROCK_ENDPOINT: "mantle" }),
    );
    expect(mantle.primary).toMatchObject({ host: "bedrock-mantle.us-west-2.api.aws", endpointMode: "mantle", crossRegion: "none" });
  });

  it("bedrock GovCloud: an allowlisted FIPS endpoint is cleared for export-controlled (not covered models by default)", () => {
    const s = getRoutingSummary(env(GOV));
    expect(s.primary).toMatchObject({
      targetClass: "bedrock_govcloud",
      host: "bedrock-runtime-fips.us-gov-west-1.amazonaws.com",
      region: "us-gov-west-1",
      fips: true,
      govCloud: { qualified: true, failed: [] },
      coveredModel: false,
    });
    expect(s.clearance).toEqual(ALL);

    const covered = getRoutingSummary(env({ ...GOV, BEDROCK_MODEL_ID: "us-gov.anthropic.claude-fable-5-1-v1" }));
    expect(covered.primary.coveredModel).toBe(true);
    expect(covered.clearance).toEqual(NO_EC);
    expect(getRoutingSummary(env({ ...GOV, BEDROCK_MODEL_ID: "us-gov.anthropic.claude-fable-5-1-v1", COVERED_MODEL_EC: "allow" })).clearance).toEqual(ALL);
  });

  it("bedrock in a GovCloud region that fails a check is treated as commercial and says which check failed", () => {
    const s = getRoutingSummary(env({ ...GOV, BEDROCK_BASE_URL: undefined }));
    expect(s.primary.host).toBe("bedrock-runtime.us-gov-west-1.amazonaws.com");
    expect(s.primary.targetClass).toBe("bedrock_commercial");
    expect(s.primary.govCloud).toEqual({ qualified: false, failed: ["allowlisted_host"] });
    expect(s.clearance).toEqual(NO_EC);
    expect(s.configProblems).toEqual([
      "The Bedrock endpoint is treated as a commercial region because a GovCloud check failed: the endpoint host must be listed in GOVCLOUD_ENDPOINT_ALLOWLIST",
    ]);
  });

  it("DEMO_MODE on: no API key needed; DEMO_MODE off: the key is required (presence only, never the value)", () => {
    const on = getRoutingSummary(env({ DEMO_MODE: true }));
    expect(on.demoMode).toBe(true);
    expect(on.primary.configured).toBe(true);
    expect(on.configProblems).toEqual([]);

    const off = getRoutingSummary(env({ DEMO_MODE: false }));
    expect(off.demoMode).toBe(false);
    expect(off.primary.configured).toBe(false);
    expect(off.clearance).toEqual(NONE);
    expect(off.configProblems).toEqual(["Anthropic API needs ANTHROPIC_API_KEY (or DEMO_MODE=true)"]);

    const canary = "sk-ant-canary-0000000000000000";
    const live = getRoutingSummary(env({ DEMO_MODE: false, ANTHROPIC_API_KEY: canary }));
    expect(live.primary.configured).toBe(true);
    expect(live.clearance).toEqual(NO_EC);
    expect(live.configProblems).toEqual([]);
    expect(JSON.stringify(live)).not.toContain(canary);
    expect(JSON.stringify(live)).not.toContain("canary");
  });

  it("routes: where each label goes, consistent with clearance in every mode", () => {
    expect(getRoutingSummary(env()).routes).toEqual({
      general: "primary",
      internal: "primary",
      customer_confidential: "primary",
      export_controlled: "blocked",
    });
    expect(getRoutingSummary(env({ LLM_PROVIDER: "ollama" })).routes).toEqual({
      general: "primary",
      internal: "primary",
      customer_confidential: "primary",
      export_controlled: "primary",
    });
    const hybrid = getRoutingSummary(env({ AI_MODE: "hybrid", CUSTOMER_CONFIDENTIAL_CLOUD: "deny" }));
    expect(hybrid.routes).toEqual({
      general: "primary",
      internal: "primary",
      customer_confidential: "local",
      export_controlled: "secondary",
    });
    expect(hybrid.local).toMatchObject({ targetClass: "ollama_local", isLoopback: true });

    const govEc = getRoutingSummary(env({ AI_MODE: "hybrid", HYBRID_EC_TARGET: "govcloud" }));
    expect(govEc.secondary).toMatchObject({ targetClass: "bedrock_commercial", configured: false });
    expect(govEc.routes.export_controlled).toBe("blocked");

    const configs: Partial<Env>[] = [
      {},
      { AI_MODE: "hybrid" },
      { AI_MODE: "hybrid", OLLAMA_BASE_URL: "http://10.0.0.5:11434" },
      { AI_MODE: "hybrid", HYBRID_EC_TARGET: "govcloud", ...GOV, LLM_PROVIDER: "anthropic" },
      { AI_MODE: "hybrid", CUSTOMER_CONFIDENTIAL_CLOUD: "deny", OLLAMA_BASE_URL: "http://10.0.0.5:11434" },
      { LLM_PROVIDER: "bedrock" },
      GOV,
    ];
    for (const c of configs) {
      const s = getRoutingSummary(env(c));
      for (const level of ["general", "internal", "customer_confidential", "export_controlled"] as const) {
        expect(s.clearance[level], JSON.stringify(c)).toBe(s.routes[level] !== "blocked");
      }
    }
  });

  it("is plain serializable data (safe to pass to a Client Component)", () => {
    const s = getRoutingSummary(env({ AI_MODE: "hybrid" }));
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
