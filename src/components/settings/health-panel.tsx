"use client";

import { useState } from "react";
import { Activity, Flame, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HealthReport, ProviderHealth } from "@/lib/ai/types";

const STATUS_TEXT: Record<ProviderHealth["status"], string> = {
  ready: "Ready",
  unreachable: "Unreachable",
  misconfigured: "Needs configuration",
  model_missing: "Model not found",
  model_not_allowed: "Model not allowed (remote/cloud model)",
  not_checked: "Not checked (the first call is the check)",
  replay: "Not contacted: replay (DEMO_MODE)",
};

/** Provider checks (GET /api/health?deep=1) and the Ollama warm-up (POST /api/health/warm). No secrets are shown. */
export function HealthPanel({ enabled }: { enabled: boolean }) {
  const [busy, setBusy] = useState<"check" | "warm" | null>(null);
  const [report, setReport] = useState<HealthReport | null>(null);
  const [warm, setWarm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setBusy("check");
    setError(null);
    try {
      const res = await fetch("/api/health?deep=1", { cache: "no-store" });
      if (!res.ok) throw new Error("bad status");
      setReport((await res.json()) as HealthReport);
    } catch {
      setError("The providers couldn't be checked. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function doWarm() {
    setBusy("warm");
    setError(null);
    try {
      const res = await fetch("/api/health/warm", { method: "POST" });
      if (!res.ok) throw new Error("bad status");
      const body = (await res.json()) as { ok: boolean; health: ProviderHealth | null };
      setWarm(body.health ? `Local model: ${STATUS_TEXT[body.health.status]}` : "Nothing to warm: the current mode doesn't call a live local model.");
    } catch {
      setError("The local model couldn't be warmed up. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={check} disabled={!enabled || busy !== null} className="min-h-tap px-4">
          {busy === "check" ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Activity aria-hidden="true" />}
          Check providers
        </Button>
        <Button type="button" variant="outline" onClick={doWarm} disabled={!enabled || busy !== null} className="min-h-tap px-4">
          {busy === "warm" ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Flame aria-hidden="true" />}
          Warm local model
        </Button>
      </div>
      <div aria-live="polite" className="space-y-2">
        {report ? (
          <ul className="space-y-1" data-testid="health-report">
            {report.providers.map((p) => (
              <li key={p.kind} className="text-ink">
                <span className="font-medium">{p.kind === "anthropic" ? "Anthropic API" : p.kind === "bedrock" ? "Amazon Bedrock" : "Ollama"}</span>
                {" · "}
                {STATUS_TEXT[p.status]}
                {p.problems.length > 0 ? <span className="text-muted-foreground"> — {p.problems.join("; ")}</span> : null}
              </li>
            ))}
            {report.sdkEnvOverrides.length > 0 ? (
              <li className="text-muted-foreground">Ignored SDK variables (explicit settings win): {report.sdkEnvOverrides.join(", ")}</li>
            ) : null}
          </ul>
        ) : null}
        {warm ? <p className="text-ink">{warm}</p> : null}
        {error ? (
          <p role="alert" className="text-ink">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
