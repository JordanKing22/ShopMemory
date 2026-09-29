import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LabelPrintView } from "@/components/machines/print-views";
import { getMachineLabel } from "@/server/queries/machines";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const label = await getMachineLabel(id);
  return { title: label ? `QR label ${label.assetTag}` : "QR label" };
}

/**
 * Printable 4 × 2 in QR label for one machine (PLAN.md §8.6). The code encodes `${PUBLIC_BASE_URL}/machines/<id>`.
 * Rendered in the (print) group, so there is no app shell; the page's own @page rule sets the 4 × 2 in paper size.
 */
export default async function MachineLabelPage({ params }: { params: Params }) {
  const { id } = await params;
  const label = await getMachineLabel(id);
  if (!label) notFound();
  return <LabelPrintView label={label} />;
}
