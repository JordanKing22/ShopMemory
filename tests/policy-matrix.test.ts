import { describe, expect, it } from "vitest";
import { CLASSIFICATIONS, TARGET_CLASSES, type Classification } from "@/db/schema/enums";
import {
  GOVCLOUD_ENDPOINT_ALLOWLIST_DEFAULT,
  ROUTING_MATRIX,
  TARGET_IS_CLOUD,
  allowed,
  checkGovCloud,
  clearanceFor,
  crossRegionOf,
  hybridRoute,
  isCoveredModel,
  isLoopbackHost,
  matrixRows,
  ollamaLocality,
  type AllowDeny,
  type CrossRegion,
  type PolicyOptions,
  type RouteTarget,
  type TargetClass,
} from "@/lib/policy/matrix";

// PLAN.md §4.4 written out as the expected table (default settings, a non-covered model, a geo profile), so a
// change to matrix.ts has to change this test too. "R" = allowed + redacted, "L" = allowed locally, "-" = denied.
const EXPECTED: Record<Classification, Record<TargetClass, "R" | "L" | "-">> = {
  general: { anthropic: "R", bedrock_commercial: "R", bedrock_govcloud: "R", ollama_local: "L" },
  internal: { anthropic: "R", bedrock_commercial: "R", bedrock_govcloud: "R", ollama_local: "L" },
  customer_confidential: { anthropic: "R", bedrock_commercial: "R", bedrock_govcloud: "R", ollama_local: "L" },
  export_controlled: { anthropic: "-", bedrock_commercial: "-", bedrock_govcloud: "R", ollama_local: "L" },
};

const DEFAULTS: PolicyOptions = {
  customerConfidentialCloud: "allow",
  customerConfidentialGlobalProfile: "allow",
  coveredModelEc: "deny",
  crossRegion: "geo",
  coveredModel: false,
};

describe("routing matrix data", () => {
  it("has exactly the four classifications and four target classes", () => {
    expect(Object.keys(ROUTING_MATRIX)).toEqual([...CLASSIFICATIONS]);
    for (const c of CLASSIFICATIONS) expect(Object.keys(ROUTING_MATRIX[c])).toEqual([...TARGET_CLASSES]);
  });

  it("matches PLAN.md §4.4 cell for cell with default settings", () => {
    for (const c of CLASSIFICATIONS) {
      for (const t of TARGET_CLASSES) {
        const cell = ROUTING_MATRIX[c][t];
        const got = !cell.allowed ? "-" : cell.redacted ? "R" : "L";
        expect(got, `${c} × ${t}`).toBe(EXPECTED[c][t]);
        expect(allowed(c, t, DEFAULTS), `${c} × ${t}`).toBe(EXPECTED[c][t] !== "-");
      }
    }
  });

  it("redacts every allowed cloud cell (including GovCloud) and never the local model", () => {
    for (const c of CLASSIFICATIONS) {
      for (const t of TARGET_CLASSES) {
        const cell = ROUTING_MATRIX[c][t];
        if (cell.allowed) expect(cell.redacted, `${c} × ${t}`).toBe(TARGET_IS_CLOUD[t]);
      }
    }
  });

  it("puts the env-driven exceptions exactly where §4.4 does", () => {
    expect(ROUTING_MATRIX.customer_confidential.anthropic.deniedWhen).toEqual(["customer_confidential_cloud_deny"]);
    expect(ROUTING_MATRIX.customer_confidential.bedrock_commercial.deniedWhen).toEqual([
      "customer_confidential_cloud_deny",
      "customer_confidential_global_profile_deny",
    ]);
    expect(ROUTING_MATRIX.customer_confidential.bedrock_govcloud.deniedWhen).toEqual([]);
    expect(ROUTING_MATRIX.export_controlled.bedrock_govcloud.deniedWhen).toEqual(["covered_model_ec"]);
    for (const t of TARGET_CLASSES) {
      expect(ROUTING_MATRIX.general[t].deniedWhen).toEqual([]);
      expect(ROUTING_MATRIX.internal[t].deniedWhen).toEqual([]);
      expect(ROUTING_MATRIX.customer_confidential.ollama_local.deniedWhen).toEqual([]);
      expect(ROUTING_MATRIX.export_controlled.ollama_local.deniedWhen).toEqual([]);
    }
  });

  it("matrixRows() renders the same data in order", () => {
    const rows = matrixRows();
    expect(rows.map((r) => r.classification)).toEqual([...CLASSIFICATIONS]);
    for (const r of rows) {
      expect(r.cells.map((c) => c.targetClass)).toEqual([...TARGET_CLASSES]);
      for (const cell of r.cells) expect(cell.allowed).toBe(ROUTING_MATRIX[r.classification][cell.targetClass].allowed);
    }
  });
});

describe("allowed()", () => {
  const AD: (AllowDeny | undefined)[] = ["allow", "deny", undefined];
  const CR: (CrossRegion | undefined)[] = ["global", "geo", "none", undefined];
  const COV: (boolean | undefined)[] = [true, false, undefined];
  const allOptionCombos: PolicyOptions[] = [];
  for (const customerConfidentialCloud of AD)
    for (const customerConfidentialGlobalProfile of AD)
      for (const coveredModelEc of AD)
        for (const crossRegion of CR)
          for (const coveredModel of COV)
            allOptionCombos.push({ customerConfidentialCloud, customerConfidentialGlobalProfile, coveredModelEc, crossRegion, coveredModel });

  it("never lets export_controlled reach the Anthropic API or a commercial Bedrock region, under any settings", () => {
    for (const opts of allOptionCombos) {
      expect(allowed("export_controlled", "anthropic", opts)).toBe(false);
      expect(allowed("export_controlled", "bedrock_commercial", opts)).toBe(false);
    }
  });

  it("always allows everything to the local model and general/internal to every target", () => {
    for (const opts of allOptionCombos) {
      for (const c of CLASSIFICATIONS) expect(allowed(c, "ollama_local", opts)).toBe(true);
      for (const t of TARGET_CLASSES) {
        expect(allowed("general", t, opts)).toBe(true);
        expect(allowed("internal", t, opts)).toBe(true);
      }
    }
  });

  it("settings only ever narrow the default matrix", () => {
    for (const opts of allOptionCombos) {
      for (const c of CLASSIFICATIONS) {
        for (const t of TARGET_CLASSES) {
          if (!ROUTING_MATRIX[c][t].allowed) expect(allowed(c, t, opts)).toBe(false);
        }
      }
    }
  });

  it("CUSTOMER_CONFIDENTIAL_CLOUD=deny makes customer-confidential local/GovCloud-only", () => {
    const opts = { ...DEFAULTS, customerConfidentialCloud: "deny" as const };
    expect(allowed("customer_confidential", "anthropic", opts)).toBe(false);
    expect(allowed("customer_confidential", "bedrock_commercial", opts)).toBe(false);
    expect(allowed("customer_confidential", "bedrock_govcloud", opts)).toBe(true);
    expect(allowed("customer_confidential", "ollama_local", opts)).toBe(true);
    expect(allowed("internal", "anthropic", opts)).toBe(true);
  });

  it("CUSTOMER_CONFIDENTIAL_GLOBAL_PROFILE=deny keeps customer-confidential off global profiles (unknown scope counts as global)", () => {
    const deny = { ...DEFAULTS, customerConfidentialGlobalProfile: "deny" as const };
    expect(allowed("customer_confidential", "bedrock_commercial", { ...deny, crossRegion: "global" })).toBe(false);
    expect(allowed("customer_confidential", "bedrock_commercial", { ...deny, crossRegion: undefined })).toBe(false);
    expect(allowed("customer_confidential", "bedrock_commercial", { ...deny, crossRegion: "geo" })).toBe(true);
    expect(allowed("customer_confidential", "bedrock_commercial", { ...deny, crossRegion: "none" })).toBe(true);
    expect(allowed("customer_confidential", "bedrock_commercial", { ...DEFAULTS, crossRegion: "global" })).toBe(true);
    expect(allowed("customer_confidential", "anthropic", { ...deny, crossRegion: "global" })).toBe(true);
  });

  it("COVERED_MODEL_EC: export_controlled goes to a covered GovCloud model only when allowed (unknown model counts as covered)", () => {
    expect(allowed("export_controlled", "bedrock_govcloud", { ...DEFAULTS, coveredModel: true })).toBe(false);
    expect(allowed("export_controlled", "bedrock_govcloud", { ...DEFAULTS, coveredModel: undefined })).toBe(false);
    expect(allowed("export_controlled", "bedrock_govcloud", { ...DEFAULTS, coveredModel: false })).toBe(true);
    expect(allowed("export_controlled", "bedrock_govcloud", { ...DEFAULTS, coveredModel: true, coveredModelEc: "allow" })).toBe(true);
    expect(allowed("export_controlled", "bedrock_govcloud", {})).toBe(false);
    expect(allowed("customer_confidential", "bedrock_govcloud", { ...DEFAULTS, coveredModel: true })).toBe(true);
  });

  it("fails closed on unknown classifications and targets", () => {
    expect(allowed("secret" as Classification, "ollama_local")).toBe(false);
    expect(allowed("general", "openai" as TargetClass)).toBe(false);
    expect(allowed("__proto__" as Classification, "anthropic")).toBe(false);
    expect(allowed("general", "toString" as TargetClass)).toBe(false);
  });

  it("clearanceFor() gives the header dots per target", () => {
    expect(clearanceFor("anthropic", DEFAULTS)).toEqual({ general: true, internal: true, customer_confidential: true, export_controlled: false });
    expect(clearanceFor("ollama_local", DEFAULTS)).toEqual({ general: true, internal: true, customer_confidential: true, export_controlled: true });
    expect(clearanceFor("bedrock_govcloud", DEFAULTS)).toEqual({ general: true, internal: true, customer_confidential: true, export_controlled: true });
    expect(clearanceFor("anthropic", { ...DEFAULTS, customerConfidentialCloud: "deny" })).toEqual({
      general: true,
      internal: true,
      customer_confidential: false,
      export_controlled: false,
    });
  });
});

describe("hybridRoute()", () => {
  const anthropic: RouteTarget = { targetClass: "anthropic", opts: DEFAULTS, available: true };
  const local: RouteTarget = { targetClass: "ollama_local", opts: DEFAULTS, available: true };
  const localDown: RouteTarget = { ...local, available: false };
  const govcloud: RouteTarget = { targetClass: "bedrock_govcloud", opts: DEFAULTS, available: true };
  const commercial: RouteTarget = { targetClass: "bedrock_commercial", opts: DEFAULTS, available: true };

  it("sends export_controlled to the EC target and everything else to the cloud", () => {
    const t = { cloud: anthropic, ecTarget: local, local };
    expect(hybridRoute("export_controlled", t)).toEqual({ to: "ec_target" });
    expect(hybridRoute("customer_confidential", t)).toEqual({ to: "cloud" });
    expect(hybridRoute("internal", t)).toEqual({ to: "cloud" });
    expect(hybridRoute("general", t)).toEqual({ to: "cloud" });
  });

  it("fails closed when the local model is down: never a cloud fallback for export_controlled", () => {
    expect(hybridRoute("export_controlled", { cloud: anthropic, ecTarget: localDown, local: localDown })).toEqual({
      to: "blocked",
      reason: "local_unavailable_controlled",
    });
    expect(hybridRoute("internal", { cloud: anthropic, ecTarget: localDown, local: localDown })).toEqual({ to: "cloud" });
  });

  it("uses GovCloud for export_controlled only as the configured EC target, and refuses a commercial one", () => {
    expect(hybridRoute("export_controlled", { cloud: anthropic, ecTarget: govcloud, local })).toEqual({ to: "ec_target" });
    expect(hybridRoute("export_controlled", { cloud: anthropic, ecTarget: commercial, local })).toEqual({
      to: "blocked",
      reason: "local_unavailable_controlled",
    });
  });

  it("sends records the cloud isn't cleared for to local, else blocks", () => {
    const ccDeny: RouteTarget = { ...anthropic, opts: { ...DEFAULTS, customerConfidentialCloud: "deny" } };
    expect(hybridRoute("customer_confidential", { cloud: ccDeny, ecTarget: local, local })).toEqual({ to: "local" });
    expect(hybridRoute("customer_confidential", { cloud: ccDeny, ecTarget: localDown, local: localDown })).toEqual({
      to: "blocked",
      reason: "local_unavailable_controlled",
    });
    expect(hybridRoute("internal", { cloud: { ...anthropic, available: false }, ecTarget: local, local })).toEqual({ to: "local" });
  });

  it("only treats an ollama_local target as the local fallback", () => {
    const ccDeny: RouteTarget = { ...anthropic, opts: { ...DEFAULTS, customerConfidentialCloud: "deny" } };
    expect(hybridRoute("customer_confidential", { cloud: ccDeny, ecTarget: local, local: commercial })).toEqual({
      to: "blocked",
      reason: "local_unavailable_controlled",
    });
  });
});

describe("checkGovCloud()", () => {
  const good = {
    region: "us-gov-west-1",
    baseUrl: "https://bedrock-runtime-fips.us-gov-west-1.amazonaws.com",
    endpointMode: "runtime" as const,
    modelId: "us-gov.anthropic.claude-example-v1",
    allowlist: [] as string[],
  };

  it("qualifies an allowlisted FIPS host in a GovCloud region (default allowlist)", () => {
    expect(GOVCLOUD_ENDPOINT_ALLOWLIST_DEFAULT).toEqual([
      "bedrock-runtime-fips.us-gov-west-1.amazonaws.com",
      "bedrock-runtime-fips.us-gov-east-1.amazonaws.com",
    ]);
    expect(checkGovCloud(good)).toEqual({ qualified: true, failed: [] });
    expect(checkGovCloud({ ...good, baseUrl: "https://BEDROCK-RUNTIME-FIPS.us-gov-west-1.amazonaws.com/" }).qualified).toBe(true);
  });

  it("names each failing check", () => {
    expect(checkGovCloud({ ...good, region: "us-east-1" }).failed).toEqual(["region", "host_has_region"]);
    expect(checkGovCloud({ ...good, baseUrl: "https://bedrock-runtime.us-gov-west-1.amazonaws.com" }).failed).toEqual(["allowlisted_host"]);
    expect(checkGovCloud({ ...good, region: "us-gov-east-1" }).failed).toEqual(["host_has_region"]);
    expect(checkGovCloud({ ...good, baseUrl: "http://bedrock-runtime-fips.us-gov-west-1.amazonaws.com" }).failed).toEqual([
      "https_no_path_or_userinfo",
    ]);
    expect(checkGovCloud({ ...good, baseUrl: "https://bedrock-runtime-fips.us-gov-west-1.amazonaws.com/proxy" }).failed).toEqual([
      "https_no_path_or_userinfo",
    ]);
    expect(checkGovCloud({ ...good, baseUrl: "https://u:p@bedrock-runtime-fips.us-gov-west-1.amazonaws.com" }).failed).toEqual([
      "https_no_path_or_userinfo",
    ]);
    expect(checkGovCloud({ ...good, modelId: "global.anthropic.claude-example-v1" }).failed).toEqual(["model_prefix"]);
    expect(checkGovCloud({ ...good, modelId: undefined }).failed).toEqual(["model_prefix"]);
    expect(checkGovCloud({ ...good, baseUrl: null }).failed).toEqual(["allowlisted_host", "host_has_region", "https_no_path_or_userinfo"]);
  });

  it("uses an explicit allowlist instead of the default, with exact host matching", () => {
    expect(checkGovCloud({ ...good, allowlist: ["vpce-123.bedrock-runtime.us-gov-west-1.vpce.amazonaws.com"] }).failed).toEqual([
      "allowlisted_host",
    ]);
    expect(
      checkGovCloud({
        ...good,
        baseUrl: "https://vpce-123.bedrock-runtime.us-gov-west-1.vpce.amazonaws.com",
        allowlist: ["vpce-123.bedrock-runtime.us-gov-west-1.vpce.amazonaws.com"],
      }).qualified,
    ).toBe(true);
    expect(checkGovCloud({ ...good, baseUrl: "https://evil-bedrock-runtime-fips.us-gov-west-1.amazonaws.com" }).failed).toEqual([
      "allowlisted_host",
    ]);
  });

  it("mantle mode needs an anthropic. model ID and accepts only the SDK's /anthropic path", () => {
    const mantle = {
      ...good,
      endpointMode: "mantle" as const,
      baseUrl: "https://bedrock-mantle.us-gov-west-1.api.aws/anthropic",
      modelId: "anthropic.claude-example-v1",
      allowlist: ["bedrock-mantle.us-gov-west-1.api.aws"],
    };
    expect(checkGovCloud(mantle)).toEqual({ qualified: true, failed: [] });
    expect(checkGovCloud({ ...mantle, modelId: "us-gov.anthropic.claude-example-v1" }).failed).toEqual(["model_prefix"]);
    expect(checkGovCloud({ ...good, baseUrl: `${good.baseUrl}/anthropic` }).failed).toEqual(["https_no_path_or_userinfo"]);
  });
});

describe("ollamaLocality() and isLoopbackHost()", () => {
  it("treats only 127.0.0.0/8, ::1 and localhost as loopback", () => {
    for (const h of ["127.0.0.1", "127.1.2.3", "127.255.255.255", "localhost", "LOCALHOST", "::1", "[::1]"]) {
      expect(isLoopbackHost(h), h).toBe(true);
    }
    for (const h of ["128.0.0.1", "127.0.0.256", "0.0.0.0", "10.0.0.5", "192.168.1.20", "localhost.example.com", "sub.localhost", "::ffff:7f00:1", "", null, undefined]) {
      expect(isLoopbackHost(h), String(h)).toBe(false);
    }
  });

  it("classifies loopback URLs as this computer (URL normalization included)", () => {
    for (const baseUrl of ["http://127.0.0.1:11434", "http://localhost:11434", "http://[::1]:11434", "http://[0:0:0:0:0:0:0:1]:11434", "http://127.1:11434"]) {
      expect(ollamaLocality({ baseUrl, allowlist: [], allowPlaintextLan: false }), baseUrl).toEqual({ locality: "this_computer", isLoopback: true });
    }
  });

  it("allowlisted on-prem hosts need https unless plaintext LAN is enabled", () => {
    const allowlist = ["gpu-box.shop.lan", "10.0.0.5:11434"];
    expect(ollamaLocality({ baseUrl: "https://gpu-box.shop.lan:11434", allowlist, allowPlaintextLan: false })).toEqual({ locality: "on_prem", isLoopback: false });
    expect(ollamaLocality({ baseUrl: "https://10.0.0.5:11434", allowlist, allowPlaintextLan: false })).toEqual({ locality: "on_prem", isLoopback: false });
    expect(ollamaLocality({ baseUrl: "http://gpu-box.shop.lan:11434", allowlist, allowPlaintextLan: false })).toEqual({
      locality: "not_local",
      isLoopback: false,
      problem: "plaintext_lan",
    });
    expect(ollamaLocality({ baseUrl: "http://gpu-box.shop.lan:11434", allowlist, allowPlaintextLan: true })).toEqual({
      locality: "on_prem_unencrypted",
      isLoopback: false,
    });
  });

  it("refuses hosts that are neither loopback nor allowlisted, bad URLs and URLs with credentials", () => {
    expect(ollamaLocality({ baseUrl: "https://192.168.1.20:11434", allowlist: [], allowPlaintextLan: true })).toEqual({
      locality: "not_local",
      isLoopback: false,
      problem: "not_allowlisted",
    });
    expect(ollamaLocality({ baseUrl: "not a url", allowlist: [], allowPlaintextLan: false }).problem).toBe("invalid_url");
    expect(ollamaLocality({ baseUrl: "ftp://127.0.0.1", allowlist: [], allowPlaintextLan: false }).problem).toBe("invalid_url");
    expect(ollamaLocality({ baseUrl: "http://u:p@127.0.0.1:11434", allowlist: [], allowPlaintextLan: false }).problem).toBe("userinfo");
  });
});

describe("crossRegionOf() and isCoveredModel()", () => {
  it("derives the inference-profile scope from the model-ID prefix", () => {
    expect(crossRegionOf("global.anthropic.claude-sonnet-5-5")).toBe("global");
    expect(crossRegionOf("us.anthropic.claude-sonnet-5-5")).toBe("geo");
    expect(crossRegionOf("eu.anthropic.claude-sonnet-5-5")).toBe("geo");
    expect(crossRegionOf("apac.anthropic.claude-sonnet-5-5")).toBe("geo");
    expect(crossRegionOf("us-gov.anthropic.claude-example-v1")).toBe("geo");
    expect(crossRegionOf("anthropic.claude-sonnet-5-5")).toBe("none");
    expect(crossRegionOf("arn:aws:bedrock:us-east-1:123456789012:inference-profile/global.anthropic.claude-sonnet-5-5")).toBe("global");
    expect(crossRegionOf("arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-sonnet-5-5")).toBe("geo");
    expect(crossRegionOf("arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-5-5-v1:0")).toBe("none");
    expect(crossRegionOf(undefined)).toBe("none");
  });

  it("fails closed for ARNs whose scope can't be read (application inference profiles, malformed ARNs)", () => {
    // An application inference profile ends in an opaque ID but can wrap a global cross-region profile.
    const appProfile = "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/a1b2c3d4e5f6";
    expect(crossRegionOf(appProfile)).toBe("unknown");
    expect(crossRegionOf("ARN:AWS:BEDROCK:US-EAST-1:123456789012:APPLICATION-INFERENCE-PROFILE/A1B2")).toBe("unknown");
    // The opaque ID must not be mistaken for a prefix, even when it looks like one.
    expect(crossRegionOf("arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/us.fake")).toBe("unknown");
    expect(crossRegionOf("arn:aws:bedrock:us-east-1:123456789012:custom-model/abc")).toBe("unknown");
    expect(crossRegionOf("arn:aws:bedrock")).toBe("unknown");
    expect(crossRegionOf("arn:aws:bedrock:us-east-1:123456789012:inference-profile/")).toBe("unknown");

    // "unknown" counts as global: CUSTOMER_CONFIDENTIAL_GLOBAL_PROFILE=deny applies.
    const deny = { customerConfidentialGlobalProfile: "deny" as const };
    expect(allowed("customer_confidential", "bedrock_commercial", { ...deny, crossRegion: "unknown" })).toBe(false);
    expect(allowed("customer_confidential", "bedrock_commercial", { ...deny, crossRegion: "global" })).toBe(false);
    expect(allowed("customer_confidential", "bedrock_commercial", { ...deny, crossRegion: "geo" })).toBe(true);
    expect(allowed("customer_confidential", "bedrock_commercial", { ...deny, crossRegion: "none" })).toBe(true);
    expect(allowed("customer_confidential", "bedrock_commercial", { crossRegion: "unknown" })).toBe(true);
  });

  it("flags the Fable and Mythos families as covered models", () => {
    expect(isCoveredModel("claude-fable-5-1")).toBe(true);
    expect(isCoveredModel("us-gov.anthropic.claude-mythos-5")).toBe(true);
    expect(isCoveredModel("global.anthropic.claude-fable-5-v1:0")).toBe(true);
    expect(isCoveredModel("claude-sonnet-5-5")).toBe(false);
    expect(isCoveredModel("qwen3.5:4b")).toBe(false);
    expect(isCoveredModel(undefined)).toBe(false);
  });
});
