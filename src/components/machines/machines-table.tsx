import type { ReactNode } from "react";
import Link from "next/link";
import { ClassificationBadge } from "@/components/app/classification-badge";
import type { MachineRowVM } from "@/lib/data/machines";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MachineStatusChip } from "./status-chips";

/**
 * The machine list. One DOM structure for every width (so each row and its test IDs exist once): a real table from
 * xl (1280 px), and below that the same rows restyled as cards with a visible label on every value (the people list
 * uses the same pattern). Rows keep the data-layer order (machines.sort_order).
 */

const CELL = "px-3 py-3 align-middle max-xl:p-0";

function Label({ children }: { children: ReactNode }) {
  // Visible on the card layout only; the table layout has column headers.
  return <span className="block text-sm text-muted-foreground xl:hidden">{children}</span>;
}

function Count({ n, zero }: { n: number; zero: string }) {
  return n > 0 ? (
    <span className="font-medium text-ink tabular-nums">{formatNumber(n)}</span>
  ) : (
    <span className="text-muted-foreground tabular-nums">
      <span aria-hidden="true">0</span>
      <span className="sr-only">{zero}</span>
    </span>
  );
}

function MachineRow({ row, windowDays }: { row: MachineRowVM; windowDays: number }) {
  return (
    <tr
      data-testid={`machine-row-${row.id}`}
      data-machine-id={row.id}
      className={cn(
        "xl:border-b xl:border-hairline xl:last:border-b-0 xl:hover:bg-muted/40",
        "max-xl:grid max-xl:grid-cols-3 max-xl:gap-x-4 max-xl:gap-y-3 max-xl:rounded-lg max-xl:border max-xl:bg-card max-xl:p-4 max-xl:shadow-xs",
      )}
    >
      <th scope="row" className={cn(CELL, "text-left font-normal max-xl:col-span-3")}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={`/machines/${row.id}`}
            className="inline-flex min-h-tap items-center gap-2 rounded-sm font-semibold text-primary underline-offset-4 hover:underline"
          >
            <span className="font-mono text-ink">{row.assetTag}</span>
            <span>{row.name}</span>
          </Link>
          <ClassificationBadge level={row.classification} size="sm" info={false} />
        </div>
      </th>
      <td className={cn(CELL, "max-xl:col-span-3 sm:max-xl:col-span-2")}>
        <Label>Make and model</Label>
        <span className="text-ink">
          {row.make} {row.model}
        </span>
        <span className="block text-sm text-muted-foreground">{row.kindLabel}</span>
      </td>
      <td className={cn(CELL, "max-xl:col-span-3 sm:max-xl:col-span-1")}>
        <Label>Status</Label>
        <MachineStatusChip status={row.status} label={row.statusLabel} />
      </td>
      <td className={cn(CELL, "max-xl:col-span-3")}>
        <Label>Location</Label>
        {row.locationCell ? (
          <span className="text-ink">{row.locationCell}</span>
        ) : (
          <span className="text-muted-foreground">
            <span aria-hidden="true">—</span>
            <span className="sr-only">No location recorded</span>
          </span>
        )}
      </td>
      <td className={cn(CELL, "xl:text-right")}>
        <Label>Quirks</Label>
        <Count n={row.quirkCount} zero="No quirks" />
      </td>
      <td className={cn(CELL, "xl:text-right")}>
        <Label>Setup sheets</Label>
        <Count n={row.setupSheetCount} zero="No setup sheets" />
      </td>
      <td className={cn(CELL, "xl:text-right")}>
        <Label>Issues, {windowDays} days</Label>
        <Count n={row.recentIssueCount} zero={`Nothing in the last ${windowDays} days`} />
      </td>
    </tr>
  );
}

export function MachinesTable({ rows, windowDays }: { rows: MachineRowVM[]; windowDays: number }) {
  return (
    <div className="xl:overflow-x-auto xl:rounded-lg xl:border xl:bg-card xl:shadow-xs">
      <table data-testid="machines-table" className="w-full border-collapse text-left max-xl:block">
        <caption className="sr-only">Machines, in the shop&apos;s usual order</caption>
        <thead className="border-b bg-surface-sunken text-sm text-muted-foreground max-xl:hidden">
          <tr>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Machine
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Make and model
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Location
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Quirks
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Setup sheets
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Recent issues
              <span className="block font-normal">last {windowDays} days</span>
            </th>
          </tr>
        </thead>
        <tbody className="max-xl:grid max-xl:gap-4 md:max-xl:grid-cols-2">
          {rows.map((row) => (
            <MachineRow key={row.id} row={row} windowDays={windowDays} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
