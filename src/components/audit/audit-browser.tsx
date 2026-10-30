"use client";

import { useState, useTransition } from "react";
import { Download, Filter, Loader2, RotateCcw } from "lucide-react";
import { queryAudit } from "@/app/actions/audit";
import { ClassificationBadge } from "@/components/app/classification-badge";
import { EmptyState } from "@/components/app/empty-state";
import { ReplayTag } from "@/components/app/replay-tag";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { AuditFilters } from "@/lib/audit/types";
import type { AuditListVM, AuditRowVM } from "@/lib/data/audit";
import { formatTimestampUtc } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AuditDetail } from "./audit-detail";

export interface AuditPersonaOption {
  id: string;
  label: string;
}

const SELECTS: { key: keyof AuditFilters; label: string; options: [string, string][] }[] = [
  {
    key: "decision",
    label: "Decision",
    options: [
      ["allow", "Sent"],
      ["withheld_partial", "Sent · some withheld"],
      ["blocked", "Blocked"],
      ["held", "Held"],
      ["user_excluded_controlled", "Sent without controlled records"],
    ],
  },
  {
    key: "feature",
    label: "Feature",
    options: [
      ["settings_test", "Settings test prompt"],
      ["ask_shop", "Ask the Shop"],
      ["interviewer", "AI Interviewer"],
      ["card_extraction", "Card extraction"],
      ["quote_log", "Quote Reasoning Log"],
      ["document_generator", "Document Generator"],
      ["training", "Training"],
    ],
  },
  {
    key: "providerKind",
    label: "Provider",
    options: [
      ["anthropic", "Anthropic API"],
      ["bedrock", "Amazon Bedrock"],
      ["ollama", "Ollama"],
    ],
  },
  {
    key: "mode",
    label: "Mode",
    options: [
      ["cloud", "Cloud"],
      ["local", "Local"],
      ["hybrid", "Hybrid"],
    ],
  },
  {
    key: "classification",
    label: "Highest label",
    options: [
      ["general", "General"],
      ["internal", "Internal"],
      ["customer_confidential", "Customer-confidential"],
      ["export_controlled", "Export-controlled"],
    ],
  },
  {
    key: "replay",
    label: "Source",
    options: [
      ["live", "Live calls"],
      ["replay", "Replays"],
      ["fallback", "Offline fallbacks"],
      ["seeded", "Seeded examples"],
      ["not_sent", "Nothing sent"],
    ],
  },
  {
    key: "outcome",
    label: "Outcome",
    options: [
      ["ok", "OK"],
      ["blocked", "Blocked"],
      ["held", "Held"],
      ["refusal", "Model declined"],
      ["invalid_output", "Invalid output"],
      ["provider_error", "Provider error"],
      ["timeout", "Timed out"],
      ["aborted", "Cancelled"],
      ["pending", "In progress"],
    ],
  },
];

const fieldClass = "min-h-tap w-full rounded-md border border-input-border bg-surface px-3 text-ink";

function Row({ row, onOpen }: { row: AuditRowVM; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-audit-row={row.id}
        className="grid w-full gap-x-4 gap-y-1 rounded-md border bg-card p-3 text-left text-card-foreground hover:bg-muted md:grid-cols-[11rem_1fr_auto]"
      >
        <span className="text-sm text-muted-foreground tabular-nums">
          #{row.id} · {formatTimestampUtc(row.createdAt)}
        </span>
        <span className="min-w-0">
          <span className="block font-medium text-ink">
            {row.featureLabel} · {row.actorLabel}
          </span>
          <span className="block text-sm text-muted-foreground">
            {row.providerLabel} · {row.decisionLabel}
            {row.withheldCount > 0 ? ` · ${row.withheldCount} withheld` : ""} · {row.outcomeLabel}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2 md:justify-end">
          {row.maxClassification ? <ClassificationBadge level={row.maxClassification} size="sm" info={false} /> : null}
          {row.replayLabel ? <ReplayTag label={row.replayLabel} /> : null}
        </span>
      </button>
    </li>
  );
}

/**
 * The /audit list (PLAN.md §4.7): filters (free text included) go to a Server Action in the POST body, never into the URL;
 * the search text is redacted before matching, so a customer name finds its tokenized rows. Export uses the same
 * filters. Rows open a drawer with the row's payload, policy, Reveal and retry chain.
 */
export function AuditBrowser({
  initial,
  personas,
  canViewAll,
  initialRowId,
}: {
  initial: AuditListVM;
  personas: AuditPersonaOption[];
  canViewAll: boolean;
  initialRowId: number | null;
}) {
  const [list, setList] = useState(initial);
  const [filters, setFilters] = useState<AuditFilters>({});
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(initialRowId);
  const [pending, start] = useTransition();
  const [exporting, setExporting] = useState<"csv" | "json" | null>(null);

  const set = (key: keyof AuditFilters, value: string | boolean) =>
    setFilters((f) => {
      const next = { ...f } as Record<string, unknown>;
      if (value === "" || value === false) delete next[key];
      else next[key] = value;
      return next as AuditFilters;
    });

  const apply = (f: AuditFilters) =>
    start(async () => {
      setError(null);
      try {
        const r = await queryAudit(f);
        if (r.ok) setList(r.list);
        else setError(r.message);
      } catch {
        setError("The audit log couldn't be searched. Try again.");
      }
    });

  async function exportAs(format: "csv" | "json") {
    setExporting(format);
    setError(null);
    try {
      const res = await fetch("/api/audit/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, filters }),
      });
      if (!res.ok) throw new Error("export failed");
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `floorwise-audit.${format}`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("The export couldn't be created. Try again.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="space-y-4">
      <form
        className="rounded-lg border bg-card p-3 text-card-foreground shadow-xs sm:p-4"
        aria-label="Filter the audit log"
        onSubmit={(e) => {
          e.preventDefault();
          apply(filters);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label htmlFor="audit-q" className="mb-1 block text-sm font-medium text-ink">
              Search text (names are matched through the redactor)
            </label>
            <input
              id="audit-q"
              type="search"
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
              value={filters.q ?? ""}
              onChange={(e) => set("q", e.target.value)}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="audit-from" className="mb-1 block text-sm font-medium text-ink">
              From (UTC)
            </label>
            <input id="audit-from" type="date" value={filters.from ?? ""} onChange={(e) => set("from", e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="audit-to" className="mb-1 block text-sm font-medium text-ink">
              To (UTC)
            </label>
            <input id="audit-to" type="date" value={filters.to ?? ""} onChange={(e) => set("to", e.target.value)} className={fieldClass} />
          </div>
          {canViewAll ? (
            <div>
              <label htmlFor="audit-personaId" className="mb-1 block text-sm font-medium text-ink">
                Persona
              </label>
              <select id="audit-personaId" value={filters.personaId ?? ""} onChange={(e) => set("personaId", e.target.value)} className={fieldClass}>
                <option value="">Everyone</option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {SELECTS.map((s) => (
            <div key={s.key}>
              <label htmlFor={`audit-${s.key}`} className="mb-1 block text-sm font-medium text-ink">
                {s.label}
              </label>
              <select
                id={`audit-${s.key}`}
                value={(filters[s.key] as string | undefined) ?? ""}
                onChange={(e) => set(s.key, e.target.value)}
                className={fieldClass}
              >
                <option value="">Any</option>
                {s.options.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <label className="flex min-h-tap items-center gap-2 self-end text-ink">
            <input type="checkbox" checked={filters.includeEvents === true} onChange={(e) => set("includeEvents", e.target.checked)} className="size-4 accent-primary" />
            Include activity events
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button type="submit" disabled={pending} className="min-h-tap px-4">
            {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Filter aria-hidden="true" />}
            Apply filters
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            className="min-h-tap px-4"
            onClick={() => {
              setFilters({});
              apply({});
            }}
          >
            <RotateCcw aria-hidden="true" />
            Clear
          </Button>
          <Button type="button" variant="outline" disabled={exporting !== null} onClick={() => exportAs("csv")} className="min-h-tap px-4" data-testid="audit-export-csv">
            {exporting === "csv" ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Download aria-hidden="true" />}
            Export CSV
          </Button>
          <Button type="button" variant="outline" disabled={exporting !== null} onClick={() => exportAs("json")} className="min-h-tap px-4">
            {exporting === "json" ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Download aria-hidden="true" />}
            Export JSON
          </Button>
        </div>
      </form>

      <div aria-live="polite">
        {error ? (
          <p role="alert" className="text-ink">
            {error}
          </p>
        ) : null}
        <p className="mb-2 text-sm text-muted-foreground" data-testid="audit-count">
          {list.rows.length} row{list.rows.length === 1 ? "" : "s"}
          {list.truncated ? " (newest 200 shown; narrow the filters to see older ones)" : ""} ·{" "}
          {list.scope === "all" ? "every persona's calls" : "your own calls"}
        </p>
      </div>

      {list.rows.length > 0 ? (
        <ul className={cn("space-y-2", pending && "opacity-60")} data-testid="audit-rows">
          {list.rows.map((r) => (
            <Row key={r.id} row={r} onOpen={() => setOpenId(r.id)} />
          ))}
        </ul>
      ) : (
        <EmptyState title="No audit rows" body="No AI call matches these filters. Send a test prompt from Settings, or clear the filters." />
      )}

      {list.events ? (
        <section aria-labelledby="audit-events" className="space-y-2">
          <h2 id="audit-events" className="text-lg font-semibold text-ink">
            Activity events
          </h2>
          <ul className="space-y-1">
            {list.events.map((e) => (
              <li key={e.id} className="rounded-md border bg-card p-2 text-sm text-ink">
                <span className="text-muted-foreground tabular-nums">{formatTimestampUtc(e.createdAt)}</span> · {e.kind.replace(/_/g, " ")} · {e.actorLabel}
                {e.subject ? ` · ${e.subject}` : ""}
                {e.details ? <span className="block text-muted-foreground">{e.details}</span> : null}
              </li>
            ))}
            {list.events.length === 0 ? <li className="text-muted-foreground">No events.</li> : null}
          </ul>
        </section>
      ) : null}

      <Sheet open={openId !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl" data-testid="audit-sheet">
          {openId !== null ? <AuditDetail key={openId} id={openId} onOpenRow={setOpenId} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
