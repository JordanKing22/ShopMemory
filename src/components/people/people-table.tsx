import type { ReactNode } from "react";
import Link from "next/link";
import { ClassificationBadge } from "@/components/app/classification-badge";
import { RiskBandChip } from "@/components/app/risk-band-chip";
import type { PersonRowVM } from "@/lib/data/people";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CoverageMeter } from "./coverage-meter";
import { DepartureValue } from "./departure-value";

/**
 * The knowledge-holder list. One DOM structure for every width (so each row and its test IDs exist once):
 * a real table from xl (1280 px, ≥ 1024 px of content), and below that the same rows restyled as cards with a
 * visible label on every value. On a card the departure moves up under the name (CSS order) so the role pill,
 * which never wraps, gets the full card width. Rows keep the data-layer order (people.sort_order, never departure).
 */

const CELL = "px-3 py-3 align-middle max-xl:p-0";

function Label({ children }: { children: ReactNode }) {
  // Visible on the card layout only; the table layout has column headers.
  return <span className="block text-sm text-muted-foreground xl:hidden">{children}</span>;
}

function PersonRow({ row }: { row: PersonRowVM }) {
  return (
    <tr
      data-testid={`person-row-${row.id}`}
      data-person-id={row.id}
      className={cn(
        "xl:border-b xl:border-hairline xl:last:border-b-0 xl:hover:bg-muted/40",
        "max-xl:grid max-xl:grid-cols-2 max-xl:gap-x-4 max-xl:gap-y-3 max-xl:rounded-lg max-xl:border max-xl:bg-card max-xl:p-4 max-xl:shadow-xs",
      )}
    >
      <th scope="row" className={cn(CELL, "text-left font-normal max-xl:order-first max-xl:col-span-2")}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={`/people/${row.id}`}
            className="inline-flex min-h-tap items-center rounded-sm font-semibold text-primary underline-offset-4 hover:underline"
          >
            {row.fullName}
          </Link>
          {row.isMe ? <span className="rounded-full bg-accent px-2 py-px text-sm font-medium text-ink">You</span> : null}
          <ClassificationBadge level={row.classification} size="sm" info={false} />
        </div>
        <div className="text-sm text-muted-foreground">
          {row.jobTitle}
          <span aria-hidden="true"> · </span>
          <span className="sr-only">, </span>
          {row.departmentLabel}
        </div>
      </th>
      <td className={CELL}>
        <Label>Tenure</Label>
        <span className="whitespace-nowrap text-ink">
          <span aria-hidden="true">{row.tenureLabel}</span>
          <span className="sr-only">{row.tenureLongLabel}</span>
        </span>
      </td>
      <td className={cn(CELL, "max-xl:order-first max-xl:col-span-2")}>
        <Label>Planned departure</Label>
        <DepartureValue departure={row.departure} />
      </td>
      <td className={cn(CELL, "xl:text-right")}>
        <Label>Level-3 topics</Label>
        <span className="font-medium text-ink tabular-nums">{formatNumber(row.deepTopicCount)}</span>
      </td>
      <td className={CELL}>
        <Label>Deep coverage</Label>
        <CoverageMeter pct={row.deepCoveragePct} emptyLabel="No level-3 topics" />
      </td>
      <td className={cn(CELL, "xl:text-right")}>
        <Label>Approved cards</Label>
        <span className="font-medium text-ink tabular-nums">{formatNumber(row.approvedCardCount)}</span>
      </td>
      <td className={cn(CELL, "max-xl:col-span-2")}>
        <Label>Highest risk</Label>
        {row.topRisk ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <RiskBandChip band={row.topRisk.band} score={row.topRisk.risk} size="sm" />
            <span className="text-sm text-ink">
              <span className="sr-only">on </span>
              {row.topRisk.topicShortLabel}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">
            <span aria-hidden="true">—</span>
            <span className="sr-only">No topics held</span>
          </span>
        )}
      </td>
    </tr>
  );
}

export function PeopleTable({ rows }: { rows: PersonRowVM[] }) {
  return (
    <div className="xl:overflow-x-auto xl:rounded-lg xl:border xl:bg-card xl:shadow-xs">
      <table data-testid="people-table" className="w-full border-collapse text-left max-xl:block">
        <caption className="sr-only">Knowledge holders, in the shop&apos;s usual order</caption>
        <thead className="border-b bg-surface-sunken text-sm text-muted-foreground max-xl:hidden">
          <tr>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Person
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Tenure
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Planned departure
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Level-3 topics
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Deep coverage
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Approved cards
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Highest risk
            </th>
          </tr>
        </thead>
        <tbody className="max-xl:grid max-xl:gap-4 md:max-xl:grid-cols-2">
          {rows.map((row) => (
            <PersonRow key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
