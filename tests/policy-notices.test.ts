import { describe, expect, it } from "vitest";
import { NOTICE_KEYS, type Notice, type NoticeKey } from "@/lib/policy/types";
import { noticeParamsAreSafe, renderNotice } from "@/lib/policy/notices";

const EXAMPLES: Record<NoticeKey, Notice> = {
  withheld_records: {
    key: "withheld_records",
    params: { count: 1, recordKinds: "job", classification: "export_controlled", mode: "cloud", providerKind: "anthropic", model: "claude-sonnet-5-5" },
  },
  blocked_request_controlled: {
    key: "blocked_request_controlled",
    params: { recordIds: "J-A10", classification: "export_controlled", providerKind: "anthropic", model: "claude-sonnet-5-5" },
  },
  blocked_local_unavailable: { key: "blocked_local_unavailable", params: { host: "127.0.0.1:11434", model: "qwen3.5:4b" } },
  blocked_hybrid_local_down: {
    key: "blocked_hybrid_local_down",
    params: { host: "127.0.0.1:11434", count: 1, classification: "export_controlled", canExclude: 0, targetKind: "ollama" },
  },
  blocked_provider_unavailable: { key: "blocked_provider_unavailable", params: { providerKind: "bedrock" } },
  held_looks_controlled: { key: "held_looks_controlled", params: { triggers: "numeric_core", canSendAnyway: 0, providerKind: "anthropic" } },
  user_excluded_controlled: { key: "user_excluded_controlled", params: { count: 2 } },
  sent_after_hold: { key: "sent_after_hold", params: { withheldCount: 0, triggers: "retrieval" } },
};

const ctx = { role: "quoter" as const, recordLabel: (id: string) => (id === "J-A10" ? "job RJ-26-0310" : null) };

describe("notices (PLAN.md §4.4 copy)", () => {
  it("every notice key renders a title, and its params hold only IDs, enums, counts and hosts", () => {
    for (const key of NOTICE_KEYS) {
      const n = EXAMPLES[key];
      expect(noticeParamsAreSafe(n.params), key).toBe(true);
      const r = renderNotice(n, ctx);
      expect(r.key).toBe(key);
      expect(r.title.length, key).toBeGreaterThan(0);
    }
  });

  it("uses the PLAN wording for withheld, blocked, held and hybrid-local-down", () => {
    const w = renderNotice(EXAMPLES.withheld_records, ctx);
    expect(`${w.title} ${w.body}`).toBe(
      "1 related job was withheld from this answer. It is labeled export-controlled, and Cloud mode (Anthropic API · claude-sonnet-5-5) isn't cleared for export-controlled data, so it was not sent. Switch to Local or Hybrid to include it.",
    );
    const b = renderNotice(EXAMPLES.blocked_request_controlled, ctx);
    expect(`${b.title} ${b.body}`).toBe(
      "Not sent — withheld. This question refers to job RJ-26-0310, which is labeled export-controlled. Export-controlled data can go only to the local model or an allowlisted AWS GovCloud endpoint. Nothing was sent to Anthropic.",
    );
    expect(b.actions).toEqual(["switch_local", "show_matching_records"]);
    const h = renderNotice(EXAMPLES.held_looks_controlled, ctx);
    expect(h.actions).toEqual(["switch_local"]);
    expect(renderNotice({ ...EXAMPLES.held_looks_controlled, params: { ...EXAMPLES.held_looks_controlled.params, canSendAnyway: 1 } }, ctx).actions).toEqual([
      "switch_local",
      "send_anyway",
    ]);
    const hy = renderNotice(EXAMPLES.blocked_hybrid_local_down, ctx);
    expect(hy.body).toContain("Ollama at 127.0.0.1:11434 isn't responding. Floorwise never sends controlled data to the cloud as a fallback.");
  });

  it("a record the viewer can't see is never named", () => {
    const r = renderNotice(EXAMPLES.blocked_request_controlled, { role: "trainee", recordLabel: () => null });
    expect(r.body).toContain("refers to a record, which is labeled export-controlled");
  });

  it("rejects params carrying free text", () => {
    expect(noticeParamsAreSafe({ q: "How do we quote" })).toBe(false);
  });
});
