import { BadgeCheck, Hourglass, OctagonAlert, UserRound } from "lucide-react";
import { StatTile } from "@/components/app/stat-tile";
import type { RiskOverviewVM } from "@/lib/data/risk";
import { formatDate } from "@/lib/format";
import { departurePhrase, spofSubline } from "./copy";

/** Tiles fill the row height; a little less padding on short viewports (≤ 800 px) keeps the top heat-map rows in view. */
const TILE = "h-full [@media(max-height:800px)]:py-2";

/**
 * KPI row (PLAN.md §8.1). The "departing within 24 months" tile exists only when the view model carries it
 * (owner/quoter); for machinist/trainee the value was never sent, so the tile is omitted, not hidden.
 */
export function RiskKpis({ vm }: { vm: Pick<RiskOverviewVM, "kpis" | "topics"> }) {
  const { highRisk, spof, departing, approvedRecent } = vm.kpis;
  const label = new Map(vm.topics.map((t) => [t.id, t.shortLabel]));
  const since = (before: number | null, now: number) => (before !== null && before !== now ? ` (${before} at the last reset)` : "");

  const highSub =
    highRisk.count === 0 ? `None right now${since(highRisk.countBefore, 0)}` : `${highRisk.topicIds.map((id) => label.get(id) ?? id).join(", ")}${since(highRisk.countBefore, highRisk.count)}`;

  return (
    <section aria-label="Key figures" className={departing.hidden ? "grid grid-cols-1 gap-3 min-[480px]:grid-cols-3" : "grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4"}>
      <div data-testid="kpi-high" className="min-w-0">
        <StatTile
          className={TILE}
          label="Topics at high risk"
          value={highRisk.count}
          sub={highSub}
          icon={<OctagonAlert aria-hidden="true" className="size-4 shrink-0" />}
        />
      </div>
      <div data-testid="kpi-spof" className="min-w-0">
        <StatTile
          className={TILE}
          tone="signal"
          label="Single points of failure"
          value={spof.count}
          sub={`${spofSubline(spof)}${since(spof.countBefore, spof.count)}`}
          icon={<UserRound aria-hidden="true" className="size-4 shrink-0" />}
        />
      </div>
      {departing.hidden ? null : (
        <div data-testid="kpi-departing" className="min-w-0">
          <StatTile
            className={TILE}
            label={`Departing within ${departing.value.windowMonths} months`}
            value={departing.value.count}
            sub={
              departing.value.count === 0
                ? "No planned departures in that window"
                : departing.value.people.map((p) => `${p.fullName}, ${departurePhrase({ months: p.months, kind: p.kind })}`).join("; ")
            }
            icon={<Hourglass aria-hidden="true" className="size-4 shrink-0" />}
          />
        </div>
      )}
      <div data-testid="kpi-approved-30d" className="min-w-0">
        <StatTile
          className={TILE}
          label={`Cards approved, last ${approvedRecent.windowDays} days`}
          value={approvedRecent.count}
          sub={`Since ${formatDate(approvedRecent.since)}`}
          icon={<BadgeCheck aria-hidden="true" className="size-4 shrink-0" />}
        />
      </div>
    </section>
  );
}
