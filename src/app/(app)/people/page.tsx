import type { Metadata } from "next";
import { Info } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { InfoPopover } from "@/components/app/info-popover";
import { PageHeader } from "@/components/app/page-header";
import { PeopleTable } from "@/components/people/people-table";
import { getPeopleList } from "@/server/queries/people";

export const metadata: Metadata = { title: "People" };

/**
 * People (PLAN.md §9): the knowledge holders with tenure, planned departure (owner/quoter only, PLAN.md §4.8),
 * level-3 topics, deep coverage, approved cards and their highest-risk topic. Rows keep people.sort_order.
 */
export default async function PeoplePage() {
  const vm = await getPeopleList();

  return (
    <div className="mx-auto flex min-w-0 max-w-7xl flex-col gap-4">
      <PageHeader
        className="mb-2"
        title="People"
        description="The people who hold the shop's know-how: how long they've been here, what they know deeply, and how much of it is written down in approved cards."
        actions={
          <InfoPopover
            triggerClassName="min-h-tap gap-2 px-3 text-sm font-medium text-primary"
            panelLabel="What the columns mean"
            trigger={
              <>
                <Info aria-hidden="true" className="size-4 shrink-0" />
                What the columns mean
              </>
            }
            align="end"
          >
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <span className="font-semibold text-ink">Level-3 topics:</span> topics where the shop rates this person as the go-to (deep, level 3 of
                3).
              </li>
              <li>
                <span className="font-semibold text-ink">Deep coverage:</span> how much of that level-3 know-how is captured in approved cards credited
                to them. Drafts don&rsquo;t count until the person approves them.
              </li>
              <li>
                <span className="font-semibold text-ink">Highest risk:</span> their highest cell on the Knowledge Risk map.
              </li>
              <li>
                <span className="font-semibold text-ink">Planned departure:</span> shown to the owner and quoters only.
              </li>
            </ul>
            <p className="mt-2">These are transparent estimates, not a validated instrument.</p>
          </InfoPopover>
        }
      />
      {vm.people.length > 0 ? (
        <PeopleTable rows={vm.people} />
      ) : (
        <EmptyState title="No knowledge holders" body='The demo data has no people. Run "npm run seed" to load the fictional shop.' />
      )}
    </div>
  );
}
