"use client";

import { useId, useState, type ReactNode } from "react";
import { History } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { RiskOverviewVM } from "@/lib/data/risk";
import type { RiskView } from "./copy";
import { prefersReducedMotion } from "./count-up";
import { RiskHeatMap } from "./heat-map";

/**
 * The Knowledge Risk screen layout (PLAN.md §8.1). Client-side only for the page-level Before / Now state: the
 * delta control sits in the page header (top right), and the heat map below reads it. `kpis` and `info` are
 * server-rendered nodes passed through.
 */
export function RiskScreen({ vm, kpis, info }: { vm: RiskOverviewVM; kpis: ReactNode; info: ReactNode }) {
  const [view, setView] = useState<RiskView>("now");
  const [countRun, setCountRun] = useState<number | null>(null);
  const labelId = useId();
  const hasChanges = vm.baseline.hasChanges;

  const onViewChange = (v: string) => {
    if (v !== "before" && v !== "now") return;
    setView(v);
    // The count-up starts from the click (never from render): baseline → now over 900 ms, unless reduced motion.
    setCountRun((n) => (v === "now" && !prefersReducedMotion() ? (n ?? 0) + 1 : null));
  };

  const deltaControl = hasChanges ? (
    <div className="flex items-center gap-2">
      <span id={labelId} className="text-sm font-medium text-muted-foreground">
        Since the last reset
      </span>
      <ToggleGroup type="single" variant="outline" value={view} onValueChange={onViewChange} aria-labelledby={labelId} data-testid="risk-delta">
        <ToggleGroupItem value="before" data-value="before">
          Before
        </ToggleGroupItem>
        <ToggleGroupItem value="now" data-value="now">
          Now
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  ) : (
    <p data-testid="risk-delta-none" className="inline-flex min-h-tap items-center gap-2 text-sm text-muted-foreground">
      <History aria-hidden="true" className="size-4 shrink-0" />
      {vm.baseline.available ? "No changes since the last reset" : "No reset baseline to compare with"}
    </p>
  );

  return (
    <div className="flex min-w-0 flex-col gap-4 [@media(max-height:800px)]:gap-3">
      <PageHeader
        className="mb-2"
        title="Knowledge Risk"
        description="Who holds the shop's know-how and where a departure would hurt most."
        actions={
          <>
            {deltaControl}
            {info}
          </>
        }
      />
      {kpis}
      <RiskHeatMap vm={vm} view={hasChanges ? view : "now"} countRun={hasChanges && view === "now" ? countRun : null} />
    </div>
  );
}
