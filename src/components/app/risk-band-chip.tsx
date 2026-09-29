import { CircleCheck, Eye, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import type { RiskBand } from "@/lib/coverage/params";
import { cn } from "@/lib/utils";

/** Visible words for each band (PLAN.md §6: high ≥ 50 · elevated 35–49 · watch 20–34 · low < 20). */
export const RISK_BAND_LABEL: Record<RiskBand, string> = {
  high: "High",
  elevated: "Elevated",
  watch: "Watch",
  low: "Low",
};

export const RISK_BAND_ICON: Record<RiskBand, LucideIcon> = {
  high: OctagonAlert,
  elevated: TriangleAlert,
  watch: Eye,
  low: CircleCheck,
};

/** Icon + word + fill; orange fills always carry ink text (never white). */
const STYLE: Record<RiskBand, { chip: string; icon: string }> = {
  high: { chip: "bg-signal text-ink border-signal font-semibold", icon: "text-ink" },
  elevated: { chip: "bg-signal-tint text-ink border-signal-strong", icon: "text-signal-strong" },
  watch: { chip: "bg-cls-general text-ink border-input-border", icon: "text-muted-foreground" },
  low: { chip: "bg-surface text-muted-foreground border-hairline", icon: "text-muted-foreground" },
};

export interface RiskBandChipProps {
  band: RiskBand;
  /** Optional score printed before the word, e.g. 57 → "57 · High". */
  score?: number;
  size?: "sm" | "md";
  className?: string;
}

export function RiskBandChip({ band, score, size = "md", className }: RiskBandChipProps) {
  const Icon = RISK_BAND_ICON[band];
  const style = STYLE[band];
  return (
    <span
      data-risk-band={band}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border text-sm leading-5 tabular-nums",
        size === "sm" ? "px-1.5 py-px" : "px-2 py-0.5",
        style.chip,
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn("shrink-0", size === "sm" ? "size-3.5" : "size-4", style.icon)} strokeWidth={2.25} />
      {typeof score === "number" && Number.isFinite(score) ? (
        <span>
          {Math.round(score)}
          <span aria-hidden="true"> · </span>
          <span className="sr-only">, </span>
        </span>
      ) : null}
      <span>{RISK_BAND_LABEL[band]}</span>
      <span className="sr-only"> risk</span>
    </span>
  );
}
