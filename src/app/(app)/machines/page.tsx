import type { Metadata } from "next";
import Link from "next/link";
import { Printer } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { MachinesTable } from "@/components/machines/machines-table";
import { formatDate } from "@/lib/format";
import { getMachinesList } from "@/server/queries/machines";

export const metadata: Metadata = { title: "Machines" };

/**
 * Machines (PLAN.md §8.6, §9): every machine on the floor with this unit's quirk, setup-sheet and recent-issue
 * counts, each linking to its machine page. Read-only in Phase 2. Rows keep machines.sort_order.
 */
export default async function MachinesPage() {
  const vm = await getMachinesList();

  return (
    <div className="mx-auto flex min-w-0 max-w-7xl flex-col gap-4">
      <PageHeader
        className="mb-2"
        title="Machines"
        description={
          <>
            Each machine&apos;s page collects this unit&apos;s quirks, common setups and recent issues. Recent issues are
            events logged and failure stories captured from {formatDate(vm.windowStart)} to {formatDate(vm.demoToday)} (the
            last {vm.windowDays} days).
          </>
        }
        actions={
          <Link
            href="/machines/labels"
            className="inline-flex min-h-tap items-center gap-2 rounded-md border border-input-border bg-surface px-4 font-medium text-ink hover:bg-muted"
          >
            <Printer aria-hidden="true" className="size-4 shrink-0" />
            Print QR labels
          </Link>
        }
      />
      {vm.machines.length > 0 ? (
        <MachinesTable rows={vm.machines} windowDays={vm.windowDays} />
      ) : (
        <EmptyState title="No machines" body='The demo data has no machines. Run "npm run seed" to load the fictional shop.' />
      )}
    </div>
  );
}
