import type { Metadata } from "next";
import { Info } from "lucide-react";
import { InfoPopover } from "@/components/app/info-popover";
import { RiskKpis } from "@/components/risk/risk-kpis";
import { RiskScreen } from "@/components/risk/risk-screen";
import { getRiskOverview } from "@/server/queries/risk";

export const metadata: Metadata = { title: "Knowledge Risk" };

/**
 * Knowledge Risk (PLAN.md §8.1, demo steps 1 and 5): KPI row, then the topic × holder heat map with its cell sheet.
 * All numbers come from computeCoverage() over the live database; departure-derived values arrive gated by role.
 */
export default async function RiskPage() {
  const vm = await getRiskOverview();

  const info = (
    <InfoPopover
      triggerClassName="min-h-tap gap-2 px-3 text-sm font-medium text-primary"
      panelLabel="How the risk score works"
      trigger={
        <>
          <Info aria-hidden="true" className="size-4 shrink-0" />
          How the score works
        </>
      }
      align="end"
    >
      <p className="font-semibold text-ink">A transparent estimate, not a validated instrument.</p>
      <p className="mt-2">
        Each cell estimates how much of a person&rsquo;s know-how on a topic would walk out the door if they left before it was written down:
      </p>
      <p className="mt-2 rounded-md bg-surface-sunken px-2 py-1 font-mono">risk = 100 × (E/3) × (1 − f) × U × T × D</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>E: tacit expertise level, 0–3, assessed by the shop.</li>
        <li>f: share captured in approved cards credited to that person (drafts don&rsquo;t count).</li>
        <li>U: how soon a planned departure is.</li>
        <li>T: tenure. D: discount when someone else can back the topic up.</li>
      </ul>
      <p className="mt-2">U is hidden for machinist and trainee roles, and so are T and D, because either would reveal U.</p>
      <p className="mt-2">Bands: High ≥ 50 · Elevated 35–49 · Watch 20–34 · Low under 20.</p>
      <p className="mt-2">
        A single point of failure is a level-3 holder with more than half the topic&rsquo;s expertise, no backup above level 1, and under half of it
        captured.
      </p>
    </InfoPopover>
  );

  return <RiskScreen vm={vm} kpis={<RiskKpis vm={vm} />} info={info} />;
}
