import type { ReactNode } from "react";
import { FictionalBanner } from "@/components/app/fictional-banner";
import { formatDate } from "@/lib/format";
import { getShellInfo } from "@/server/queries/shell";

/**
 * Print views (PLAN.md §9, §10): no app shell (no header, navigation or toaster), so the printed page holds only
 * what the route prints. On screen the non-dismissable fictional banner still sits on top (CLAUDE.md hard rule 10);
 * it is print:hidden, and every printed label names the shop "(fictional)" itself.
 * Both groups share the root layout, so moving between (app) and (print) is an ordinary client navigation.
 */
export default async function PrintLayout({ children }: Readonly<{ children: ReactNode }>) {
  const shell = await getShellInfo();
  return (
    <div className="flex min-h-dvh flex-col print:block print:min-h-0">
      <FictionalBanner notice={shell.fictionalNotice} demoDate={formatDate(shell.demoToday)} />
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 outline-none sm:px-6 print:m-0 print:p-0">
        {children}
      </main>
    </div>
  );
}
