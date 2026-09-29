import type { Metadata } from "next";
import { EmptyState } from "@/components/app/empty-state";
import { LabelSheetView } from "@/components/machines/print-views";
import { getMachineLabels } from "@/server/queries/machines";

export const metadata: Metadata = { title: "QR label sheet" };

/**
 * 8-up QR label sheet on US Letter (PLAN.md §8.6): one 4 × 2 in label per machine, two columns × four rows.
 * Rendered in the (print) group, so there is no app shell. The static `labels` segment wins over (app)/machines/[id].
 */
export default async function MachineLabelSheetPage() {
  const labels = await getMachineLabels();
  if (labels.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-4 text-2xl font-semibold text-ink">QR label sheet</h1>
        <EmptyState title="No machines" body='The demo data has no machines. Run "npm run seed" to load the fictional shop.' />
      </div>
    );
  }
  return <LabelSheetView labels={labels} />;
}
