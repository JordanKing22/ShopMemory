import { describe, expect, it } from "vitest";
import { CLASSIFICATIONS, type Classification } from "@/db/schema/enums";
import { decide } from "@/lib/policy/decide";
import { allowed } from "@/lib/policy/matrix";
import type { DecideInput, Decision, PolicyTargets } from "@/lib/policy/types";
import { env } from "./fixtures/routing-env";
import { GOVCLOUD, SIGNAL, budget, policyTarget, request } from "./helpers/policy";

const NONE: PolicyTargets = { cloud: null, local: null, ecTarget: null };

function run(partial: Partial<DecideInput> & Pick<DecideInput, "mode" | "targets">): Decision {
  return decide({ request: request("internal"), budget: [], excludeAboveClearance: false, confirmNotControlled: false, ...partial });
}

const sentOrBlocked = (d: Decision) => (d.kind === "blocked" || d.kind === "held" ? d.kind : "sent");

describe("decide(): every classification × target follows the matrix", () => {
  const configs = {
    anthropic: () => policyTarget("anthropic", env()),
    bedrock_commercial: () => policyTarget("bedrock", env({ LLM_PROVIDER: "bedrock", AWS_REGION: "us-east-1", BEDROCK_MODEL_ID: "us.anthropic.claude-sonnet-x" })),
    bedrock_govcloud: () => policyTarget("bedrock", env(GOVCLOUD)),
    ollama_local: () => policyTarget("ollama", env()),
  } as const;

  for (const [cls, make] of Object.entries(configs)) {
    for (const c of CLASSIFICATIONS) {
      it(`${c} → ${cls}`, () => {
        const t = make();
        expect(t.descriptor.targetClass).toBe(cls);
        const mode = cls === "ollama_local" ? "local" : "cloud";
        const targets: PolicyTargets = mode === "local" ? { ...NONE, local: t } : { ...NONE, cloud: t };
        const d = run({ mode, targets, request: request(c) });
        expect(sentOrBlocked(d)).toBe(allowed(c, t.descriptor.targetClass, t.opts) ? "sent" : "blocked");
        if (d.kind !== "blocked" && d.kind !== "held") expect(d.redact).toBe(t.descriptor.isCloud);
      });
    }
  }
});

describe("decide(): target qualification edge cases", () => {
  it("an unlisted GovCloud host is treated as commercial and never gets export_controlled", () => {
    const t = policyTarget("bedrock", env({ ...GOVCLOUD, BEDROCK_BASE_URL: "https://bedrock-runtime.us-gov-west-1.amazonaws.com" }));
    expect(t.descriptor.targetClass).toBe("bedrock_commercial");
    expect(run({ mode: "cloud", targets: { ...NONE, cloud: t }, request: request("export_controlled") }).kind).toBe("blocked");
  });

  it("SDK base-URL variables don't change the host the policy checks", () => {
    const t = policyTarget("anthropic", env({ ANTHROPIC_BASE_URL: "https://proxy.example.com" }));
    expect(t.descriptor.host).toBe("api.anthropic.com");
    expect(t.descriptor.baseUrl).toBe("https://api.anthropic.com");
  });

  it("a covered model on GovCloud is denied export_controlled unless COVERED_MODEL_EC=allow", () => {
    const covered = { ...GOVCLOUD, BEDROCK_MODEL_ID: "us-gov.anthropic.claude-fable-5-1" };
    const deny = policyTarget("bedrock", env(covered));
    expect(run({ mode: "cloud", targets: { ...NONE, cloud: deny }, request: request("export_controlled") }).kind).toBe("blocked");
    const allow = policyTarget("bedrock", env({ ...covered, COVERED_MODEL_EC: "allow" }));
    expect(run({ mode: "cloud", targets: { ...NONE, cloud: allow }, request: request("export_controlled") }).kind).toBe("allow");
  });

  it("CUSTOMER_CONFIDENTIAL_GLOBAL_PROFILE=deny keeps customer-confidential data off a global profile", () => {
    const e = env({ LLM_PROVIDER: "bedrock", AWS_REGION: "us-east-1", BEDROCK_MODEL_ID: "global.anthropic.claude-sonnet-x", CUSTOMER_CONFIDENTIAL_GLOBAL_PROFILE: "deny" });
    const t = policyTarget("bedrock", e);
    expect(t.descriptor.crossRegion).toBe("global");
    expect(run({ mode: "cloud", targets: { ...NONE, cloud: t }, request: request("customer_confidential") }).kind).toBe("blocked");
    expect(run({ mode: "cloud", targets: { ...NONE, cloud: t }, request: request("internal") }).kind).toBe("allow");
  });

  it("Ollama with a remote_host model (unavailable) or a plaintext LAN host blocks Local mode; nothing goes elsewhere", () => {
    const down = policyTarget("ollama", env(), false);
    const d = run({ mode: "local", targets: { ...NONE, local: down } });
    expect(d).toMatchObject({ kind: "blocked", reason: "local_unavailable" });
    const lan = policyTarget("ollama", env({ OLLAMA_BASE_URL: "http://10.0.0.5:11434", OLLAMA_HOST_ALLOWLIST: ["10.0.0.5"] }));
    expect(lan.descriptor.available).toBe(false);
    expect(run({ mode: "local", targets: { ...NONE, local: lan } }).kind).toBe("blocked");
  });

  it("Cloud mode with an unavailable provider is blocked (provider_unavailable)", () => {
    const t = policyTarget("anthropic", env({ DEMO_MODE: false }));
    expect(t.descriptor.available).toBe(false);
    expect(run({ mode: "cloud", targets: { ...NONE, cloud: t } })).toMatchObject({ kind: "blocked", reason: "provider_unavailable" });
  });
});

describe("decide(): Cloud mode budget, blocks and holds", () => {
  const cloud = policyTarget("anthropic", env());
  const targets: PolicyTargets = { ...NONE, cloud };

  it("withholds budgeted records not cleared for the target (no backfill) and says so", () => {
    const d = run({
      mode: "cloud",
      targets,
      request: request("customer_confidential"),
      budget: budget(["card", "KC-001", "customer_confidential"], ["job", "J-A02", "customer_confidential"], ["job", "J-A06", "export_controlled"]),
    });
    expect(d.kind).toBe("withheld_partial");
    if (d.kind !== "withheld_partial") return;
    expect(d.sent.map((s) => s.ref.id)).toEqual(["KC-001", "J-A02"]);
    expect(d.withheld).toEqual([{ ref: { kind: "job", id: "J-A06" }, classification: "export_controlled", reason: "not_cleared_for_target" }]);
    expect(d.notice).toEqual({
      key: "withheld_records",
      params: { count: 1, recordKinds: "job", classification: "export_controlled", mode: "cloud", providerKind: "anthropic", model: "claude-sonnet-5-5" },
    });
  });

  it("blocks a request whose own floor isn't cleared, naming the records (IDs only)", () => {
    const req = { ...request("export_controlled"), mentions: [{ kind: "job" as const, id: "J-A10", surface: "x", start: 0, end: 1, classification: "export_controlled" as Classification }] };
    const d = run({ mode: "cloud", targets, request: req, budget: budget(["card", "KC-001", "internal"]) });
    expect(d).toMatchObject({ kind: "blocked", reason: "request_not_cleared" });
    expect(d.notice?.params).toMatchObject({ recordIds: "J-A10", classification: "export_controlled" });
    if (d.kind === "blocked") expect(d.withheld).toHaveLength(1);
  });

  it("holds on a detector hit and never offers 'send anyway', even when the client claims confirmation", () => {
    for (const confirmNotControlled of [false, true]) {
      const d = run({ mode: "cloud", targets, request: request("internal", [SIGNAL]), confirmNotControlled });
      expect(d).toMatchObject({ kind: "held", canSendAnyway: false, triggers: ["numeric_core"] });
    }
  });

  it("holds on the retrieval signal alone; a confirmation sends with heldOverride and the sent_after_hold notice", () => {
    const b = budget(["job", "J-A06", "export_controlled"], ["card", "KC-001", "internal"]);
    expect(run({ mode: "cloud", targets, budget: b })).toMatchObject({ kind: "held", canSendAnyway: true, triggers: ["retrieval"] });
    const d = run({ mode: "cloud", targets, budget: b, confirmNotControlled: true });
    expect(d).toMatchObject({ kind: "withheld_partial", heldOverride: true, notice: { key: "sent_after_hold" } });
  });
});

describe("decide(): Hybrid mode fails closed", () => {
  const cloud = policyTarget("anthropic", env({ AI_MODE: "hybrid" }));
  const local = policyTarget("ollama", env());
  const localDown = policyTarget("ollama", env(), false);

  it("export-controlled context goes to the local model; everything else to the cloud", () => {
    const up: PolicyTargets = { cloud, local, ecTarget: local };
    const ec = run({ mode: "hybrid", targets: up, budget: budget(["job", "J-A06", "export_controlled"]) });
    expect(ec.kind === "allow" && ec.target.descriptor.targetClass).toBe("ollama_local");
    const cc = run({ mode: "hybrid", targets: up, budget: budget(["card", "KC-001", "customer_confidential"]) });
    expect(cc.kind === "allow" && cc.target.descriptor.targetClass).toBe("anthropic");
    const suspected = run({ mode: "hybrid", targets: up, request: request("internal", [SIGNAL]) });
    expect(suspected.kind === "allow" && suspected.target.descriptor.targetClass).toBe("ollama_local");
  });

  it("local down: blocked, never the cloud; the escape hatch only narrows and is refused when the floor is controlled", () => {
    const down: PolicyTargets = { cloud, local: localDown, ecTarget: localDown };
    const b = budget(["card", "KC-001", "internal"], ["job", "J-A06", "export_controlled"]);
    const d = run({ mode: "hybrid", targets: down, budget: b });
    expect(d).toMatchObject({ kind: "blocked", reason: "local_unavailable_controlled", canExcludeControlled: true });
    expect(d.notice?.params).toMatchObject({ count: 1, canExclude: 1, host: "127.0.0.1:11434" });

    const excluded = run({ mode: "hybrid", targets: down, budget: b, excludeAboveClearance: true });
    expect(excluded.kind).toBe("user_excluded_controlled");
    if (excluded.kind === "user_excluded_controlled") {
      expect(excluded.target.descriptor.targetClass).toBe("anthropic");
      expect(excluded.sent.map((s) => s.ref.id)).toEqual(["KC-001"]);
      expect(excluded.withheld).toEqual([{ ref: { kind: "job", id: "J-A06" }, classification: "export_controlled", reason: "user_excluded" }]);
    }

    // A pinned export-controlled record makes the request itself controlled: no button, and a forged POST is still blocked.
    const pinned = request("export_controlled");
    expect(run({ mode: "hybrid", targets: down, request: pinned, budget: b })).toMatchObject({ kind: "blocked", canExcludeControlled: false });
    expect(run({ mode: "hybrid", targets: down, request: pinned, budget: b, excludeAboveClearance: true }).kind).toBe("blocked");
    // A detector hit is treated like export_controlled: no escape hatch either.
    expect(run({ mode: "hybrid", targets: down, request: request("internal", [SIGNAL]), budget: b, excludeAboveClearance: true }).kind).toBe("blocked");
  });

  it("excludeAboveClearance is ignored outside Hybrid", () => {
    const d = run({ mode: "cloud", targets: { ...NONE, cloud }, request: request("export_controlled"), excludeAboveClearance: true });
    expect(d.kind).toBe("blocked");
  });
});
