import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { GatedValue } from "@/components/app/hidden-field";
import type { Gated } from "@/lib/data/gate";
import type { FinancialValues, FinancialsVM } from "@/lib/data/jobs";
import { formatHours, formatMoneyUSD, formatNumber, formatPct } from "@/lib/format";
import { Fact, JobSection } from "./job-section";

function pct(n: number): string {
  return formatPct(n, Number.isInteger(n) ? 0 : 1);
}

interface FieldSpec {
  label: string;
  key: keyof FinancialValues;
  render: (n: number) => ReactNode;
  testId?: string;
  strong?: boolean;
}

const FIELDS: FieldSpec[] = [
  { label: "Unit price", key: "unitPriceUsd", render: formatMoneyUSD, testId: "price-unit", strong: true },
  { label: "Total price", key: "totalPriceUsd", render: formatMoneyUSD, testId: "price-total", strong: true },
  { label: "Target margin", key: "targetMarginPct", render: pct, testId: "price-margin" },
  { label: "Shop rate", key: "shopRateUsdPerHr", render: (n) => `${formatMoneyUSD(n)} / h` },
  { label: "Material cost", key: "materialCostUsd", render: formatMoneyUSD },
  { label: "Outside processing", key: "outsideProcessingUsd", render: formatMoneyUSD },
  { label: "Risk adder", key: "riskAdderHours", render: formatHours },
  { label: "Scrap allowance", key: "scrapAllowancePct", render: (n) => (n === 0 ? "None" : `${formatNumber(n, Number.isInteger(n) ? 0 : 1)} %`) },
];

/**
 * The quote's prices and cost inputs (quote_financials). Owner and quoters see the values; for machinist and trainee
 * every field is the "Hidden for {Role} role" pill, built from the one Hidden slot the data layer returned without
 * querying the table, so no amount (and no price field name) is in the page. Test IDs: job-financials · price-unit · price-total · price-margin.
 */
export function FinancialsSection({ financials }: { financials: FinancialsVM | null }) {
  if (!financials) {
    return (
      <JobSection id="job-financials-title" testId="job-financials" title="Prices">
        <p className="text-muted-foreground">Internal work order: never quoted, so there are no prices.</p>
      </JobSection>
    );
  }
  const hiddenForRole = financials.hidden;
  const values = financials.hidden ? null : financials.value;
  if (!hiddenForRole && values === null) {
    return (
      <JobSection id="job-financials-title" testId="job-financials" title="Prices">
        <p className="text-muted-foreground">No prices were recorded for this quote.</p>
      </JobSection>
    );
  }
  // One Hidden slot for the whole section (no per-field names in the payload); every field shows the same pill.
  const slot = (key: keyof FinancialValues): Gated<number> =>
    financials.hidden ? financials : { hidden: false, value: (values as FinancialValues)[key] };

  return (
    <JobSection
      id="job-financials-title"
      testId="job-financials"
      title="Prices"
      aside={
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Lock aria-hidden="true" className="size-4 shrink-0" />
          Owner and quoters only
        </span>
      }
      description={
        hiddenForRole
          ? "Prices, margins and cost inputs are shown to the owner and quoters only. Quoted and actual hours stay visible to everyone."
          : undefined
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {FIELDS.map((field) => (
          <Fact key={field.label} label={field.label} testId={field.testId}>
            <GatedValue value={slot(field.key)} hiddenClassName="whitespace-normal">
              {(n) => <span className={field.strong ? "text-lg font-semibold tabular-nums" : "tabular-nums"}>{field.render(n)}</span>}
            </GatedValue>
          </Fact>
        ))}
      </dl>
    </JobSection>
  );
}
