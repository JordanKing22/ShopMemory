import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { jobDetail, jobsPage, type JobDetailVM, type JobsPageVM } from "@/lib/data/jobs";
import { requireActor } from "@/server/actor";
import { getDb } from "@/server/db";

/**
 * The /jobs list for the current persona: every quote with its job plus the internal work orders, filtered by the
 * page's searchParams (non-text facets only). No prices for anyone; the outcome is gated and, for roles that can't
 * see it, never used to filter.
 */
export async function getJobsPage(searchParams: Readonly<Record<string, string | string[] | undefined>>): Promise<JobsPageVM> {
  await connection();
  const actor = await requireActor();
  return jobsPage(getDb(), actor, searchParams);
}

/**
 * One job or quote page (J-… or Q-… IDs), or null (the page calls notFound()). quote_financials is read only for
 * roles that may see prices. Memoized per request with React cache(), so generateMetadata and the page share one read.
 */
export const getJobDetail = cache(async (id: string): Promise<JobDetailVM | null> => {
  await connection();
  const actor = await requireActor();
  return jobDetail(getDb(), actor, id);
});
