"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setAiRouting } from "@/app/actions/ai-routing";
import { Button } from "@/components/ui/button";
import type { RoutingOptions } from "@/lib/policy/summary";
import type { AiRoutingSetting, EffectiveRouting } from "@/lib/policy/types";
import { cn } from "@/lib/utils";

const MODES: { value: AiRoutingSetting["mode"]; label: string; help: string }[] = [
  { value: "cloud", label: "Cloud", help: "Every request goes to the cloud provider below, redacted. Export-controlled records are withheld." },
  { value: "local", label: "Local", help: "Every request goes to the local model (Ollama). Nothing is sent to a cloud provider." },
  { value: "hybrid", label: "Hybrid", help: "Cloud where the labels allow it; export-controlled records go to the local model. Never a cloud fallback." },
];
const PROVIDERS: { value: AiRoutingSetting["cloudProvider"]; label: string }[] = [
  { value: "anthropic", label: "Anthropic API" },
  { value: "bedrock", label: "Amazon Bedrock" },
];

/** Mode and cloud-provider picker (PLAN.md §4.11). Options missing configuration are disabled with the reason. */
export function RoutingForm({ effective, options, canChange }: { effective: EffectiveRouting; options: RoutingOptions; canChange: boolean }) {
  const [mode, setMode] = useState(effective.mode);
  const [cloudProvider, setCloudProvider] = useState(effective.cloudProvider);
  const [pending, start] = useTransition();
  const router = useRouter();
  const disabled = !canChange || options.locked;
  const changed = mode !== effective.mode || cloudProvider !== effective.cloudProvider;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        const r = await setAiRouting({ mode, cloudProvider });
        if (r.ok) {
          toast.success(`AI routing set to ${mode === "cloud" ? "Cloud" : mode === "local" ? "Local" : "Hybrid"}.`);
          router.refresh();
        } else toast.error(r.reason);
      } catch {
        toast.error("The setting couldn't be saved. Try again.");
      }
    });
  }

  const radio = (checked: boolean, off: boolean) =>
    cn(
      "flex min-h-tap cursor-pointer items-start gap-3 rounded-md border p-3",
      checked ? "border-primary bg-accent" : "border-input-border bg-surface",
      off && "cursor-not-allowed opacity-60",
    );

  return (
    <form onSubmit={submit} className="space-y-5" data-testid="routing-form">
      <fieldset disabled={disabled} className="space-y-2">
        <legend className="mb-2 font-semibold text-ink">Mode</legend>
        <div className="grid gap-2 md:grid-cols-3">
          {MODES.map((m) => {
            const opt = options.modes[m.value];
            return (
              <label key={m.value} className={radio(mode === m.value, !opt.enabled)}>
                <input
                  type="radio"
                  name="mode"
                  value={m.value}
                  checked={mode === m.value}
                  disabled={!opt.enabled}
                  onChange={() => setMode(m.value)}
                  className="mt-1 size-4 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{m.label}</span>
                  <span className="block text-sm text-muted-foreground">{opt.enabled ? m.help : opt.reason}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset disabled={disabled || mode === "local"} className="space-y-2">
        <legend className="mb-2 font-semibold text-ink">Cloud provider{mode === "local" ? " (not used in Local mode)" : ""}</legend>
        <div className="grid gap-2 md:grid-cols-2">
          {PROVIDERS.map((p) => {
            const opt = options.cloudProviders[p.value];
            return (
              <label key={p.value} className={radio(cloudProvider === p.value, !opt.enabled)}>
                <input
                  type="radio"
                  name="cloudProvider"
                  value={p.value}
                  checked={cloudProvider === p.value}
                  disabled={!opt.enabled}
                  onChange={() => setCloudProvider(p.value)}
                  className="mt-1 size-4 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{p.label}</span>
                  {!opt.enabled ? <span className="block text-sm text-muted-foreground">{opt.reason}</span> : null}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={disabled || !changed || pending} className="min-h-tap px-4">
          {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
          Save routing
        </Button>
        {!canChange ? <p className="text-sm text-muted-foreground">Only the owner can change AI routing in this demo.</p> : null}
        {options.locked ? <p className="text-sm text-muted-foreground">Settings are locked by the server (AI_SETTINGS_LOCKED=true).</p> : null}
      </div>
    </form>
  );
}
