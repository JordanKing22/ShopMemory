import { HiddenField } from "@/components/app/hidden-field";
import type { Gated } from "@/lib/data/gate";
import type { PersonDeparture } from "@/lib/data/people";
import { formatDate, formatMonths } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "Retires in 20 mo · May 15, 2028" (PLAN.md §8.1 chip wording, plus the date). Owner/quoter only. */
export function departureText(d: PersonDeparture): string {
  const date = formatDate(d.date);
  const retire = d.kind === "retirement";
  if (d.months < 0) return `${retire ? "Retired" : "Left"} · ${date}`;
  if (d.months === 0) return `${retire ? "Retires" : "Leaves"} this month · ${date}`;
  return `${retire ? "Retires" : "Leaves"} in ${formatMonths(d.months)} · ${date}`;
}

export interface DepartureValueProps {
  departure: Gated<PersonDeparture | null>;
  className?: string;
}

/**
 * The planned-departure field (data-testid="person-departure"), gated per PLAN.md §4.8:
 * - owner/quoter: "Retires in 20 mo · May 15, 2028", or "—" when none is planned;
 * - machinist/trainee: always the "Hidden for {Role} role" pill (so "none planned" isn't revealed either).
 * The data layer has already dropped the value for hidden roles; this only renders what it was given.
 */
export function DepartureValue({ departure, className }: DepartureValueProps) {
  if (departure.hidden) {
    return (
      <span data-testid="person-departure" data-departure="hidden" className={cn("inline-flex", className)}>
        <HiddenField label={departure.label} />
      </span>
    );
  }
  if (departure.value === null) {
    return (
      <>
        <span data-testid="person-departure" data-departure="none" aria-hidden="true" className={cn("text-muted-foreground", className)}>
          —
        </span>
        <span className="sr-only">None planned</span>
      </>
    );
  }
  return (
    <span data-testid="person-departure" data-departure="planned" className={cn("font-medium text-ink", className)}>
      {departureText(departure.value)}
    </span>
  );
}
