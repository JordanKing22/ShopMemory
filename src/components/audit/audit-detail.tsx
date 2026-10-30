"use client";

import { useEffect, useState, useTransition } from "react";
import { Eye, Loader2 } from "lucide-react";
import { getAuditRow, revealAuditRow } from "@/app/actions/audit";
import { ClassificationBadge } from "@/components/app/classification-badge";
import { HiddenField } from "@/components/app/hidden-field";
import { ReplayTag } from "@/components/app/replay-tag";
import { Button } from "@/components/ui/button";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { RevealResult } from "@/lib/audit/types";
import type { AuditDetailVM } from "@/lib/data/audit";
import { formatTimestampUtc } from "@/lib/format";
import { TokenText } from "./token-text";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t pt-4">
      <h3 className="font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

/** The audit row drawer (PLAN.md §4.7): Sent · Response · Policy · Reveal · Retry chain. Loads the row by ID. */
export function AuditDetail({ id, onOpenRow }: { id: number; onOpenRow: (id: number) => void }) {
  const [vm, setVm] = useState<AuditDetailVM | null | "loading" | "error">("loading");
  const [reveal, setReveal] = useState<RevealResult | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    getAuditRow(id)
      .then((r) => live && setVm(r))
      .catch(() => live && setVm("error"));
    return () => {
      live = false;
    };
  }, [id]);

  if (vm === "loading") {
    return (
      <SheetHeader>
        <SheetTitle>Audit row #{id}</SheetTitle>
        <SheetDescription className="flex items-center gap-2">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" /> Loading…
        </SheetDescription>
      </SheetHeader>
    );
  }
  if (vm === "error" || vm === null) {
    return (
      <SheetHeader>
        <SheetTitle>Audit row #{id}</SheetTitle>
        <SheetDescription>{vm === null ? "This row doesn't exist or isn't yours to see." : "This row couldn't be loaded. Try again."}</SheetDescription>
      </SheetHeader>
    );
  }

  const doReveal = () =>
    start(async () => {
      setRevealError(null);
      try {
        setReveal(await revealAuditRow(vm.id));
      } catch {
        setRevealError("Reveal isn't available for this row.");
      }
    });

  return (
    <div className="space-y-4" data-testid="audit-detail">
      <SheetHeader className="gap-2 pr-12">
        <p className="text-sm font-medium text-muted-foreground">
          Audit row #{vm.id} · {formatTimestampUtc(vm.createdAt)}
        </p>
        <SheetTitle className="text-xl leading-tight">
          {vm.featureLabel} · {vm.actorLabel}
        </SheetTitle>
        <SheetDescription className="text-ink">
          {vm.providerLabel} · {vm.decisionLabel} · {vm.outcomeLabel}
        </SheetDescription>
        <div className="flex flex-wrap items-center gap-2">
          {vm.maxClassification ? <ClassificationBadge level={vm.maxClassification} size="sm" info={false} /> : null}
          {vm.replayLabel ? <ReplayTag label={vm.replayLabel} /> : null}
        </div>
      </SheetHeader>

      <Block title="Policy">
        <dl className="space-y-1">
          <Fact term="Mode">{vm.mode}</Fact>
          <Fact term="Destination">
            {vm.endpointHost ?? "none"}
            {vm.region ? ` · ${vm.region}` : ""}
            {vm.crossRegion && vm.crossRegion !== "none" ? ` · ${vm.crossRegion} cross-region` : ""}
          </Fact>
          <Fact term="Transport">{vm.transportLabel}</Fact>
          {vm.storedFormLabel ? <Fact term="Payload">{vm.storedFormLabel}</Fact> : null}
          <Fact term="Labels included">{vm.classificationsIncluded.join(", ") || "—"}</Fact>
          <Fact term="Policy · app">
            {vm.policyVersion} · {vm.appVersion}
          </Fact>
          {vm.errorCode ? <Fact term="Error">{vm.errorCode}</Fact> : null}
        </dl>
        {vm.notice ? (
          <div className="rounded-md border border-signal-strong bg-signal-tint p-3 text-ink" data-testid="audit-notice">
            <p className="font-semibold">{vm.notice.title}</p>
            <p>{vm.notice.body}</p>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-ink">Sent ({vm.recordsSent.length})</p>
            <ul className="text-sm text-ink">
              {vm.recordsSent.map((r) => (
                <li key={r.ref}>{r.label}</li>
              ))}
              {vm.recordsSent.length === 0 ? <li className="text-muted-foreground">No records</li> : null}
            </ul>
          </div>
          <div>
            <p className="text-sm font-medium text-ink">Withheld ({vm.recordsWithheld.length})</p>
            <ul className="text-sm text-ink" data-testid="audit-withheld">
              {vm.recordsWithheld.map((r) => (
                <li key={r.ref}>
                  {r.label} · {r.classification?.replace(/_/g, " ")} · {r.reason === "user_excluded" ? "you left it out" : "not cleared for this provider"}
                </li>
              ))}
              {vm.recordsWithheld.length === 0 ? <li className="text-muted-foreground">None</li> : null}
            </ul>
          </div>
        </div>
      </Block>

      <Block title="What the user typed (redacted)">
        <p className="text-ink">
          <TokenText segments={vm.segments.userInput} />
        </p>
      </Block>

      <Block title="Sent payload (exactly as stored)">
        {vm.payloadHash ? <p className="font-mono text-xs break-all text-muted-foreground">sha256 {vm.payloadHash}</p> : null}
        {vm.segments.request ? (
          <pre className="max-h-80 overflow-auto rounded-md border bg-paper p-3 font-mono text-sm text-ink" data-testid="audit-payload">
            <TokenText segments={vm.segments.request} />
          </pre>
        ) : (
          <p className="text-muted-foreground">Nothing was sent.</p>
        )}
      </Block>

      <Block title="Response (as stored)">
        {vm.replayLabel ? <p className="text-sm text-muted-foreground">{vm.replayLabel}</p> : null}
        <p className="text-ink">
          <TokenText segments={vm.segments.response} />
        </p>
        {vm.citationsValid + vm.citationsStripped > 0 ? (
          <p className="text-sm text-muted-foreground">
            Citations: {vm.citationsValid} kept, {vm.citationsStripped} removed (they pointed at sources that weren&apos;t sent).
          </p>
        ) : null}
      </Block>

      <Block title="Reveal">
        <p className="text-sm text-muted-foreground">
          Shows what this row&apos;s own tokens stand for, at render time, for your role. Nothing is stored; the reveal is logged.
        </p>
        {vm.canReveal ? (
          <Button type="button" variant="outline" onClick={doReveal} disabled={pending} className="min-h-tap px-4">
            {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Eye aria-hidden="true" />}
            Reveal {vm.tokenCount} token{vm.tokenCount === 1 ? "" : "s"}
          </Button>
        ) : (
          <p className="text-sm text-ink">{vm.tokenCount === 0 ? "This row has no tokens." : "You can reveal only your own rows."}</p>
        )}
        {revealError ? <p role="alert">{revealError}</p> : null}
        {reveal ? (
          <table className="w-full text-sm" data-testid="audit-reveal">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-3 font-medium">Token</th>
                <th className="py-1 font-medium">Stands for</th>
              </tr>
            </thead>
            <tbody>
              {reveal.entries.map((e) => (
                <tr key={e.token} className="border-t">
                  <td className="py-1 pr-3 font-mono text-xs break-all">{e.token}</td>
                  <td className="py-1 text-ink">{e.value ?? (e.hiddenLabel ? <HiddenField label={e.hiddenLabel} /> : "unknown")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Block>

      {vm.retryChain.length > 1 ? (
        <Block title="Retry chain">
          <ul className="flex flex-wrap gap-2">
            {vm.retryChain.map((rid, i) => (
              <li key={rid}>
                <Button type="button" variant={rid === vm.id ? "default" : "outline"} onClick={() => onOpenRow(rid)} className="min-h-tap px-3">
                  Attempt {i + 1} · #{rid}
                </Button>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      <Block title="Timing and usage">
        <dl className="space-y-1">
          <Fact term="Latency">{vm.latencyMs === null ? "—" : `${vm.latencyMs} ms`}</Fact>
          <Fact term="First token">{vm.ttftMs === null ? "—" : `${vm.ttftMs} ms`}</Fact>
          <Fact term="Tokens in · out">
            {vm.inputTokens ?? "—"} · {vm.outputTokens ?? "—"}
          </Fact>
          <Fact term="Model (served)">{vm.servedModel ?? (vm.model ? `${vm.model} (configured)` : "—")}</Fact>
          <Fact term="Prompt version">{vm.promptVersion ?? "—"}</Fact>
        </dl>
      </Block>
    </div>
  );
}
