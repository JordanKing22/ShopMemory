import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";

export const metadata: Metadata = { title: "Knowledge Risk" };

/** Placeholder: the Knowledge Risk heat map (PLAN.md §8.1) replaces this page. */
export default function RiskPage() {
  return (
    <PageHeader
      title="Knowledge Risk"
      description="Who holds the shop's know-how, how much of it is captured, and where a departure would hurt most."
    />
  );
}
