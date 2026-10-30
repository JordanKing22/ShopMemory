"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Send, TriangleAlert } from "lucide-react";
import { ReplayTag } from "@/components/app/replay-tag";
import { readAiStream, replayLabelOf } from "@/components/ai/read-ndjson";
import { Button } from "@/components/ui/button";
import type { AIStreamEvent, DoneEvent, MetaEvent } from "@/lib/ai/types";

/**
 * "Send test prompt" (PLAN.md §4.11, §13 Phase 3): one call through the real gateway (POST /api/ai/smoke). In DEMO_MODE
 * the answer is a replay and says so; every call writes an audit row (linked when it finishes).
 */
export function TestPrompt({ enabled, reason }: { enabled: boolean; reason?: string }) {
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<MetaEvent | null>(null);
  const [text, setText] = useState("");
  const [done, setDone] = useState<DoneEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function send() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setMeta(null);
    setText("");
    setDone(null);
    setError(null);
    try {
      const res = await fetch("/api/ai/smoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature: "settings_test" }),
        signal: controller.signal,
      });
      await readAiStream(
        res,
        (ev: AIStreamEvent) => {
          if (ev.t === "meta") setMeta(ev);
          else if (ev.t === "text") setText((t) => t + ev.d);
          else if (ev.t === "done") setDone(ev);
          else if (ev.t === "error") setError(ev.message);
        },
        controller.signal,
      );
    } catch {
      if (!controller.signal.aborted) setError("The test prompt couldn't be sent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const replay = meta ? replayLabelOf(meta.badge.replay) : null;
  const notice = meta?.decision.noticeText;

  return (
    <div className="space-y-3" data-testid="test-prompt">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={send} disabled={!enabled || busy} className="min-h-tap px-4">
          {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Send aria-hidden="true" />}
          Send test prompt
        </Button>
        {!enabled && reason ? <p className="text-sm text-muted-foreground">{reason}</p> : null}
      </div>
      <div aria-live="polite" className="space-y-2">
        {meta ? (
          <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="test-prompt-route">
            <span className="text-muted-foreground">Routed to</span>
            <span className="font-medium text-ink">{meta.badge.text}</span>
            {replay ? <ReplayTag label={replay} /> : null}
            {meta.badge.recordedOnModel ? <span className="text-muted-foreground">recorded on {meta.badge.recordedOnModel}</span> : null}
          </p>
        ) : null}
        {notice ? (
          <div className="rounded-md border border-signal-strong bg-signal-tint p-3 text-ink">
            <p className="font-semibold">{notice.title}</p>
            <p>{notice.body}</p>
          </div>
        ) : null}
        {text ? (
          <blockquote className="rounded-md border bg-card p-3 text-ink" data-testid="test-prompt-answer">
            {text}
          </blockquote>
        ) : null}
        {error ? (
          <p className="flex items-center gap-2 text-ink" role="alert">
            <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-signal-strong" />
            {error}
          </p>
        ) : null}
        {done && done.auditId !== null ? (
          <p className="text-sm text-muted-foreground" data-testid="test-prompt-done">
            {done.outcome === "ok" ? "Done" : `Finished: ${done.outcome}`} · audit row{" "}
            <Link className="font-medium text-primary underline underline-offset-2" href={`/audit?row=${done.auditId}`}>
              #{done.auditId}
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
