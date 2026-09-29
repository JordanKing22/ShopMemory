import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";

const LISTS = [
  { href: "/library", label: "Knowledge Library" },
  { href: "/jobs", label: "Jobs" },
  { href: "/people", label: "People" },
  { href: "/machines", label: "Machines" },
  { href: "/risk", label: "Knowledge Risk" },
] as const;

/**
 * notFound() from an app page (a bad record ID such as /library/KC-999) renders here, INSIDE the shell, so the
 * header keeps the mode, provider, REPLAY tag and navigation (CLAUDE.md UI conventions). No DB reads (the layout
 * already loaded the shell) and no second fictional banner (the layout renders it).
 * Detail pages call notFound() only after requireActor()/role checks, so role-hidden data never reaches it.
 * Unmatched URLs outside any route still get the root src/app/not-found.tsx.
 */
export default function RecordNotFound() {
  return (
    <>
      <PageHeader title="Record not found" />
      <EmptyState
        icon={<SearchX aria-hidden="true" className="size-6" />}
        title="That ID isn't in the demo data"
        body="The record may have been mistyped, or it isn't part of the seeded (fictional) Ridgeline Precision data. Pick a list to find it:"
        action={
          <ul className="flex flex-wrap justify-center gap-2">
            {LISTS.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="inline-flex min-h-tap items-center rounded-md border border-input-border bg-surface px-3 font-medium text-ink hover:bg-muted"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        }
      />
    </>
  );
}
