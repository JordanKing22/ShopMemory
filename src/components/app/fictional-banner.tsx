import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

/** Used only when the shop profile can't be read (e.g. the root not-found page). The DB copy is canonical. */
export const FICTIONAL_NOTICE_FALLBACK =
  "Demo software. Ridgeline Precision, its people, customers, parts and jobs are fictional. Do not enter real CUI or export-controlled data.";

export interface FictionalBannerProps {
  /** shop_profile.fictional_notice. */
  notice?: string;
  /** Domain "today" already formatted (e.g. "Sep 15, 2026"); the header strip shows "Demo date: …" (PLAN.md §7.5). */
  demoDate?: string;
  className?: string;
}

/**
 * The fictional-data banner (CLAUDE.md hard rule 10): always rendered at the very top of the app,
 * with no close button and no setting that removes it. Print views carry their own fictional footer.
 */
export function FictionalBanner({ notice, demoDate, className }: FictionalBannerProps) {
  const text = notice && notice.trim() ? notice : FICTIONAL_NOTICE_FALLBACK;
  return (
    <section
      aria-label="Demo notice"
      data-fictional-banner=""
      className={cn("w-full bg-ink text-paper print:hidden", className)}
    >
      <p className="mx-auto flex max-w-screen-2xl items-start justify-center gap-2 px-4 py-1.5 text-center text-sm leading-5 sm:items-center">
        <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0 sm:mt-0" />
        <span>
          {text}
          {demoDate ? (
            <>
              {" "}
              <span className="whitespace-nowrap font-medium">Demo date: {demoDate}</span>
            </>
          ) : null}
        </span>
      </p>
    </section>
  );
}
