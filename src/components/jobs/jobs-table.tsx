import type { ReactNode } from "react";
import Link from "next/link";
import { ClassificationBadge } from "@/components/app/classification-badge";
import type { JobRowVM } from "@/lib/data/jobs";
import { formatDate, formatHours } from "@/lib/format";
import { cn } from "@/lib/utils";
import { OutcomeValue } from "./outcome-value";
import { StatusChip } from "./status-chip";
import { VarianceValue } from "./variance-value";

/**
 * The jobs and quotes list. One DOM structure for every width (so each row and its test ID exist once): a real table
 * from 1440 px (90rem: at 1280 px the 8 columns need ~1081 px but the card is only ~1007–1022 px, which clipped the
 * Status · outcome column), and below that the same rows restyled as cards with a visible label on every value. The
 * breakpoint is in rem so it sorts after the rem-based md/xl variants. Rows keep the data-layer order (newest first by
 * quoted date); nothing is sorted or filtered by a hidden field. No prices, ever.
 */

const CELL = "px-2.5 py-3 align-top max-[90rem]:p-0";
const HEAD = "px-2.5 py-2.5 font-medium";

function Label({ children }: { children: ReactNode }) {
  // Visible on the card layout only; the table layout has column headers.
  return <span className="block text-sm text-muted-foreground min-[90rem]:hidden">{children}</span>;
}

function Dash({ label }: { label: string }) {
  return (
    <span className="text-muted-foreground">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function JobRow({ row }: { row: JobRowVM }) {
  const primaryNumber = row.quoteNumber ?? row.jobNumber ?? row.id;
  return (
    <tr
      data-testid={`job-row-${row.id}`}
      data-quote-id={row.quoteId ?? undefined}
      data-job-id={row.jobId ?? undefined}
      className={cn(
        "min-[90rem]:border-b min-[90rem]:border-hairline min-[90rem]:last:border-b-0 min-[90rem]:hover:bg-muted/40",
        "max-[90rem]:grid max-[90rem]:grid-cols-6 max-[90rem]:gap-x-3 max-[90rem]:gap-y-3 max-[90rem]:rounded-lg max-[90rem]:border max-[90rem]:bg-card max-[90rem]:p-4 max-[90rem]:shadow-xs",
      )}
    >
      <th scope="row" className={cn(CELL, "text-left font-normal max-[90rem]:col-span-6")}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={row.href}
            className="inline-flex min-h-tap items-center rounded-sm font-semibold whitespace-nowrap text-primary underline-offset-4 hover:underline"
          >
            <span className="sr-only">{row.kind === "internal" ? "Internal work order " : "Quote "}</span>
            {primaryNumber}
          </Link>
          <ClassificationBadge level={row.classification} size="sm" info={false} />
        </div>
        <div className="text-sm text-muted-foreground">
          {row.kind === "internal" ? "Internal work order" : row.jobNumber ? `Job ${row.jobNumber}` : "No job"}
        </div>
      </th>
      <td className={cn(CELL, "max-[90rem]:col-span-6")}>
        <Label>Part</Label>
        <span className="block whitespace-nowrap text-ink">
          {row.partNumber} <span className="text-muted-foreground">rev {row.partRevision}</span>
        </span>
        <span className="block text-sm text-muted-foreground min-[90rem]:max-w-48">{row.partDescription}</span>
      </td>
      <td className={cn(CELL, "max-[90rem]:col-span-3")}>
        <Label>Customer (fictional)</Label>
        {row.customerName ? <span className="text-ink">{row.customerName}</span> : <span className="text-muted-foreground">Internal</span>}
      </td>
      <td className={cn(CELL, "max-[90rem]:col-span-3")}>
        <Label>{row.kind === "internal" ? "Started" : "Quoted by"}</Label>
        {row.quotedBy ? <span className="block text-ink">{row.quotedBy.name}</span> : null}
        {row.date ? (
          <span className={cn("block whitespace-nowrap", row.quotedBy ? "text-sm text-muted-foreground" : "text-ink")}>
            {row.kind === "internal" ? "Started " : ""}
            {formatDate(row.date)}
          </span>
        ) : (
          <Dash label="No date" />
        )}
      </td>
      <td className={cn(CELL, "max-[90rem]:col-span-2 min-[90rem]:text-right")}>
        <Label>Quoted</Label>
        {row.quotedHours !== null ? (
          <span className="whitespace-nowrap tabular-nums text-ink">{formatHours(row.quotedHours)}</span>
        ) : (
          <Dash label="Not quoted" />
        )}
      </td>
      <td className={cn(CELL, "max-[90rem]:col-span-2 min-[90rem]:text-right")}>
        <Label>Actual</Label>
        {row.actualHours !== null ? (
          <span className="whitespace-nowrap tabular-nums text-ink">{formatHours(row.actualHours)}</span>
        ) : (
          <Dash label="No actual hours yet" />
        )}
      </td>
      <td className={cn(CELL, "max-[90rem]:col-span-2 min-[90rem]:text-right")}>
        <Label>Variance</Label>
        <VarianceValue pct={row.variancePct} emptyLabel={row.kind === "internal" ? "Not quoted, no variance" : "No actual hours yet"} />
      </td>
      <td className={cn(CELL, "max-[90rem]:col-span-6")}>
        <Label>Status and outcome</Label>
        <div className="flex flex-col items-start gap-1.5 max-[90rem]:flex-row max-[90rem]:flex-wrap max-[90rem]:items-center max-[90rem]:gap-2">
          <StatusChip status={row.status} label={row.statusLabel} />
          {row.outcome ? (
            <span data-testid="job-row-outcome">
              <span className="sr-only">Outcome: </span>
              <OutcomeValue outcome={row.outcome} compact />
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export interface JobsTableProps {
  rows: JobRowVM[];
  /** "Hidden for Machinist role" when outcomes are hidden for this persona (shown in the column header). */
  outcomeHiddenLabel: string | null;
}

export function JobsTable({ rows, outcomeHiddenLabel }: JobsTableProps) {
  return (
    <div className="min-[90rem]:overflow-x-auto min-[90rem]:rounded-lg min-[90rem]:border min-[90rem]:bg-card min-[90rem]:shadow-xs">
      <table data-testid="jobs-table" className="w-full border-collapse text-left max-[90rem]:block">
        <caption className="sr-only">
          Quotes and jobs, newest first. Hours are quoted and actual; variance is actual against quoted.
          {outcomeHiddenLabel ? ` Win/loss outcomes: ${outcomeHiddenLabel}.` : ""}
        </caption>
        <thead className="border-b bg-surface-sunken text-sm text-muted-foreground max-[90rem]:hidden">
          <tr>
            <th scope="col" className={HEAD}>
              Quote / job
            </th>
            <th scope="col" className={HEAD}>
              Part
            </th>
            <th scope="col" className={HEAD}>
              Customer (fictional)
            </th>
            <th scope="col" className={HEAD}>
              Quoted by
            </th>
            <th scope="col" className={cn(HEAD, "text-right")}>
              Quoted
            </th>
            <th scope="col" className={cn(HEAD, "text-right")}>
              Actual
            </th>
            <th scope="col" className={cn(HEAD, "text-right")}>
              Variance
            </th>
            <th scope="col" className={HEAD}>
              Status · outcome
            </th>
          </tr>
        </thead>
        <tbody className="max-[90rem]:grid max-[90rem]:gap-4 md:max-[90rem]:grid-cols-2">
          {rows.map((row) => (
            <JobRow key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
