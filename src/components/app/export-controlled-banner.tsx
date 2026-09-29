import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ExportControlledBannerProps {
  /** What the page shows, e.g. "This job" or "This card". Defaults to "This record". */
  subject?: string;
  className?: string;
}

/**
 * Full-width banner for export-controlled record pages (PLAN.md §10). Honest copy (CLAUDE.md hard rule 10):
 * it describes routing inside this app and makes no compliance claim.
 */
export function ExportControlledBanner({ subject = "This record", className }: ExportControlledBannerProps) {
  return (
    <section
      aria-label="Export-controlled record"
      data-classification="export_controlled"
      className={cn(
        "flex w-full items-start gap-3 rounded-md border-2 border-cls-ec bg-cls-ec px-4 py-3 text-cls-ec-fg",
        className,
      )}
    >
      <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" strokeWidth={2.25} />
      <div className="min-w-0 space-y-1 text-sm leading-relaxed">
        <p className="font-semibold uppercase tracking-wide">Export-controlled</p>
        <p>
          {subject} is labeled export-controlled. Floorwise sends export-controlled records only to the local model
          or an allowlisted AWS GovCloud endpoint, never to a commercial cloud AI service.
        </p>
        <p>
          This label controls routing inside this app; it is not an official CUI marking. In this demo every persona
          can open export-controlled records. A real deployment must limit them to authorized U.S. persons.
        </p>
      </div>
    </section>
  );
}
