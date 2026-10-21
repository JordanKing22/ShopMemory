import { afterEach, describe, expect, it } from "vitest";
import { envSummary, getEnv, resetEnvCache } from "@/lib/env";

const KEYS = ["ANTHROPIC_API_KEY", "FLOORWISE_ANTHROPIC_API_KEY"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

function setKeys(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) {
    if (values[k] === undefined) delete process.env[k];
    else process.env[k] = values[k];
  }
  resetEnvCache();
}

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetEnvCache();
});

describe("Anthropic key alias", () => {
  it("uses ANTHROPIC_API_KEY when it is the only one set", () => {
    setKeys({ ANTHROPIC_API_KEY: "test-key-a" });
    expect(getEnv().ANTHROPIC_API_KEY).toBe("test-key-a");
  });

  it("uses FLOORWISE_ANTHROPIC_API_KEY when it is the only one set", () => {
    setKeys({ FLOORWISE_ANTHROPIC_API_KEY: "test-key-f" });
    expect(getEnv().ANTHROPIC_API_KEY).toBe("test-key-f");
    expect(envSummary().ANTHROPIC_API_KEY).toBe(true);
  });

  it("prefers FLOORWISE_ANTHROPIC_API_KEY over ANTHROPIC_API_KEY", () => {
    setKeys({ ANTHROPIC_API_KEY: "test-key-a", FLOORWISE_ANTHROPIC_API_KEY: "test-key-f" });
    expect(getEnv().ANTHROPIC_API_KEY).toBe("test-key-f");
  });

  it("treats blank values as unset", () => {
    setKeys({ ANTHROPIC_API_KEY: "  ", FLOORWISE_ANTHROPIC_API_KEY: "" });
    expect(getEnv().ANTHROPIC_API_KEY).toBeUndefined();
    expect(envSummary().ANTHROPIC_API_KEY).toBe(false);
  });
});
