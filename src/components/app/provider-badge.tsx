import "server-only";
import { Ban, Check, Cloud, Laptop, Layers, TriangleAlert, type LucideIcon } from "lucide-react";
import { CLASSIFICATIONS, type Classification } from "@/db/schema/enums";
import { getEnv } from "@/lib/env";
import { CLASSIFICATION_SHORT } from "@/lib/classification-labels";
import { formatProviderLine, formatProviderShort } from "@/lib/format";
import { getRoutingSummary, type RoutingSummary, type RoutingTarget } from "@/lib/policy/summary";
import {
  COVERED_MODEL_TEXT,
  CROSS_REGION_TEXT,
  clearanceListLabel,
  clearanceText,
  ecHeaderLabel,
  ecTargetHeading,
  modeSentence,
  showLocalTarget,
  whereText,
} from "@/lib/routing-copy";
import { cn } from "@/lib/utils";
import { InfoPopover } from "./info-popover";

export type { RoutingSummary };
type Mode = RoutingSummary["mode"];
type Target = RoutingTarget;

const MODE_LABEL: Record<Mode, string> = { cloud: "CLOUD", local: "LOCAL", hybrid: "HYBRID" };
const MODE_WORD: Record<Mode, string> = { cloud: "Cloud", local: "Local", hybrid: "Hybrid" };
const MODE_ICON: Record<Mode, LucideIcon> = { cloud: Cloud, local: Laptop, hybrid: Layers };

const DOT_STYLE: Record<Classification, string> = {
  general: "bg-cls-general text-cls-general-fg border-input-border",
  internal: "bg-cls-internal text-cls-internal-fg border-cls-internal-fg/40",
  customer_confidential: "bg-cls-cc text-cls-cc-fg border-cls-cc-fg/50",
  export_controlled: "bg-cls-ec text-cls-ec-fg border-cls-ec",
};

/** The wording lives in src/lib/routing-copy.ts (pure, unit-tested); re-exported for existing importers. */
export { clearanceText };

/** Four G / I / CC / EC dots. Cleared = filled with a check; not cleared = hollow, dashed, with a slash icon. */
export function ClearanceDots({ summary, className }: { summary: RoutingSummary; className?: string }) {
  return (
    <ul aria-label={clearanceListLabel(summary)} className={cn("flex items-center gap-1", className)}>
      {CLASSIFICATIONS.map((level) => {
        const cleared = summary.clearance[level];
        const text = clearanceText(level, summary);
        return (
          <li
            key={level}
            title={text}
            data-cleared={cleared ? "true" : "false"}
            className={cn(
              "inline-flex h-6 items-center gap-0.5 rounded-full border px-1.5 text-sm leading-none font-semibold",
              cleared ? DOT_STYLE[level] : "border-dashed border-input-border bg-surface text-muted-foreground",
            )}
          >
            <span aria-hidden="true">{CLASSIFICATION_SHORT[level]}</span>
            {cleared ? (
              <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
            ) : (
              <Ban aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
            )}
            <span className="sr-only">{text}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** REPLAY tag (CLAUDE.md hard rule 10): signal-orange fill with INK text, never white. */
export function ReplayTag({ className }: { className?: string }) {
  return (
    <span
      data-replay=""
      className={cn(
        "inline-flex h-6 items-center rounded-sm bg-signal px-1.5 text-sm leading-none font-semibold tracking-wide text-ink",
        className,
      )}
    >
      REPLAY
    </span>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

function TargetRows({ t, heading }: { t: Target; heading?: string }) {
  const bedrock = t.providerKind === "bedrock";
  return (
    <div className="space-y-1">
      {heading ? <p className="font-semibold text-ink">{heading}</p> : null}
      <dl className="space-y-1">
        <Row term="Provider">{t.providerLabel}</Row>
        <Row term="Model">{t.model || "not set"}</Row>
        <Row term="Host">{t.host || "not set"}</Row>
        {t.region ? <Row term="Region">{t.region}</Row> : null}
        {bedrock && t.crossRegion ? <Row term="Cross-region">{CROSS_REGION_TEXT[t.crossRegion]}</Row> : null}
        {bedrock ? <Row term="FIPS endpoint">{t.fips ? "Yes" : "No"}</Row> : null}
        {t.coveredModel ? <Row term="Retention">{COVERED_MODEL_TEXT}</Row> : null}
        <Row term="Where">{whereText(t)}</Row>
      </dl>
    </div>
  );
}

function Details({ summary }: { summary: RoutingSummary }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="font-semibold text-ink">AI routing: {MODE_WORD[summary.mode]} mode</p>
        <p className="text-muted-foreground">{modeSentence(summary)}</p>
      </div>
      <TargetRows t={summary.primary} heading={summary.secondary ? "Main provider" : undefined} />
      {summary.secondary ? <TargetRows t={summary.secondary} heading={ecTargetHeading(summary)} /> : null}
      {showLocalTarget(summary) && summary.local ? (
        <TargetRows t={summary.local} heading="Local model (labels the main provider isn't cleared for)" />
      ) : null}
      <div className="space-y-1">
        <p className="font-semibold text-ink">{clearanceListLabel(summary)}</p>
        <ul className="space-y-0.5">
          {CLASSIFICATIONS.map((level) => (
            <li key={level} className="flex items-center gap-2">
              {summary.clearance[level] ? (
                <Check aria-hidden="true" className="size-4 shrink-0 text-primary" strokeWidth={3} />
              ) : (
                <Ban aria-hidden="true" className="size-4 shrink-0 text-signal-strong" strokeWidth={2.5} />
              )}
              <span>{clearanceText(level, summary)}</span>
            </li>
          ))}
        </ul>
      </div>
      {summary.demoMode ? (
        <p className="flex items-start gap-2">
          <ReplayTag className="shrink-0" />
          <span>Demo mode: AI answers are replayed from recordings and labeled REPLAY.</span>
        </p>
      ) : null}
      {summary.configProblems.length > 0 ? (
        <div className="rounded-md border border-signal-strong bg-signal-tint p-2">
          <p className="flex items-center gap-2 font-semibold text-ink">
            <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-signal-strong" />
            Configuration needs attention
          </p>
          <ul className="mt-1 list-disc pl-6">
            {summary.configProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-muted-foreground">Set by the server configuration. Keys and secrets are never shown here.</p>
    </div>
  );
}

export interface ProviderBadgeProps {
  /** Defaults to getRoutingSummary(getEnv()). Pass one in to render a specific configuration. */
  summary?: RoutingSummary;
  className?: string;
}

/**
 * Header badge (PLAN.md §4.11): mode pill, provider line, G/I/CC/EC clearance dots, REPLAY in DEMO_MODE and a
 * warning when configuration is incomplete. Reads configuration only; never shows secret values.
 * Below 1024 px the provider line collapses to a short label ("Anthropic") so the clearance dots fit on tablets
 * (768 px and up); below 768 px (phones) the dots move into the details panel. The details open on click / tap / Enter.
 */
export function ProviderBadge({ summary: given, className }: ProviderBadgeProps) {
  const summary = given ?? getRoutingSummary(getEnv());
  const ModeIcon = MODE_ICON[summary.mode];
  const line = formatProviderLine(summary.primary);
  const ecLine = ecHeaderLabel(summary);
  const problems = summary.configProblems;

  const trigger = (
    <span className="flex min-w-0 items-center gap-2">
      <span className="sr-only">AI routing: </span>
      <span
        data-mode={summary.mode}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-ink px-2 text-sm leading-none font-semibold tracking-wide text-paper"
      >
        <ModeIcon aria-hidden="true" className="size-4" />
        {MODE_LABEL[summary.mode]}
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-medium text-ink lg:hidden">{formatProviderShort(summary.primary)}</span>
        <span className="hidden truncate text-sm font-medium text-ink lg:block">{line}</span>
        {ecLine ? <span className="hidden truncate text-sm text-muted-foreground lg:block">{ecLine}</span> : null}
      </span>
      {problems.length > 0 ? (
        <span className="inline-flex shrink-0 items-center text-signal-strong">
          <TriangleAlert aria-hidden="true" className="size-4" />
          <span className="sr-only">Configuration problem: {problems.join("; ")}.</span>
        </span>
      ) : null}
    </span>
  );

  return (
    <div
      data-provider-badge=""
      className={cn("flex min-w-0 items-center gap-2 print:hidden", className)}
    >
      <InfoPopover
        trigger={trigger}
        panelLabel="AI routing details"
        triggerClassName="min-w-0 max-w-full px-1.5 py-1"
        align="start"
        className="w-[22rem]"
      >
        <Details summary={summary} />
      </InfoPopover>
      {/* Dots from 768 px (tablets included, PLAN.md §4.11); below that (phones) they're in the details panel.
          From 640 px they would overlap the mode pill: the header can't fit wordmark, persona, pill, dots and REPLAY. */}
      <ClearanceDots summary={summary} className="hidden shrink-0 md:flex" />
      {summary.demoMode ? <ReplayTag className="shrink-0" /> : null}
    </div>
  );
}
