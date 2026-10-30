import type { Metadata } from "next";
import Link from "next/link";
import { AuditBrowser } from "@/components/audit/audit-browser";
import { PageHeader } from "@/components/app/page-header";
import { can } from "@/lib/auth/roles";
import { labelNamePart } from "@/lib/data/personas";
import { getActor, listPersonas } from "@/server/actor";
import { getAuditPage } from "@/server/queries/audit";

export const metadata: Metadata = { title: "Audit log" };

/**
 * AI audit log (PLAN.md §4.7, §9): every AI call, blocked and held ones included, with the exact redacted payload.
 * The owner sees every row; other personas see their own. ?row=<id> opens a row's drawer (the Settings test prompt
 * links here). Free-text search never goes into the URL.
 */
export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.row) ? sp.row[0] : sp.row;
  const rowId = raw && /^\d{1,9}$/.test(raw) ? Number(raw) : null;
  const [vm, actor, personas] = await Promise.all([getAuditPage({}), getActor(), listPersonas()]);
  const canViewAll = can(actor.role, "viewAll");
  return (
    <div className="mx-auto flex min-w-0 max-w-6xl flex-col gap-4">
      <PageHeader
        className="mb-2"
        title="AI audit log"
        description={
          <>
            Every AI call, including the ones that were blocked or held, with exactly what was sent after names, customers and part
            numbers were replaced with tokens. Rows marked REPLAY were answered from recordings;
            &quot;scripted (not model output)&quot; means a hand-written answer. Change where requests go in{" "}
            <Link href="/settings" className="font-medium text-primary underline underline-offset-2">
              Settings
            </Link>
            .
          </>
        }
      />
      <AuditBrowser
        initial={vm}
        canViewAll={canViewAll}
        initialRowId={rowId}
        personas={personas.map((p) => ({ id: p.id, label: labelNamePart(p.label) }))}
      />
    </div>
  );
}
