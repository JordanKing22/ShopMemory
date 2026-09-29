import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { LibraryBrowser } from "@/components/library/library-browser";
import { getLibraryPage } from "@/server/queries/cards";

export const metadata: Metadata = { title: "Knowledge Library" };

/**
 * Knowledge Library (PLAN.md §8.3). Facets come from searchParams (non-text filters only); free-text search is a
 * Server Action, so search text never appears in the URL.
 */
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const vm = await getLibraryPage(await searchParams);
  return (
    <>
      <PageHeader
        title="Knowledge Library"
        description="Know-how from the people who hold it. Every card traces back to the exact words it came from and credits the person who said them. Only approved cards count toward coverage."
      />
      <LibraryBrowser vm={vm} />
    </>
  );
}
