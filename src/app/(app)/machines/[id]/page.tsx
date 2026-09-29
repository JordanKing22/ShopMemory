import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ClassificationBadge } from "@/components/app/classification-badge";
import { PageHeader } from "@/components/app/page-header";
import {
  CardList,
  EventList,
  LibraryAction,
  MachineFacts,
  MachineSection,
  QrPanel,
  SectionNav,
  SheetList,
  SubHeading,
} from "@/components/machines/machine-page";
import { MachineStatusChip } from "@/components/machines/status-chips";
import { formatDate } from "@/lib/format";
import { getMachineDetail } from "@/server/queries/machines";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const vm = await getMachineDetail(id);
  return { title: vm ? `${vm.assetTag} ${vm.name}` : "Machine" };
}

/**
 * A machine page (PLAN.md §8.6), read-only in Phase 2: this unit's quirks, common setups (setup sheets and setup
 * tips), recent issues (events and failure stories from the last 90 demo-days), the unit's history and its QR code.
 * Mobile-first: this is the page a QR label opens on a phone at the machine.
 */
export default async function MachinePage({ params }: { params: Params }) {
  const { id } = await params;
  const vm = await getMachineDetail(id);
  if (!vm) notFound();

  const setupCount = vm.setupSheets.length + vm.setupTips.length;
  const issueCount = vm.recentIssueCount;

  return (
    <div className="mx-auto flex min-w-0 max-w-6xl flex-col gap-5">
      <PageHeader
        className="mb-0"
        eyebrow={
          <Link
            href="/machines"
            className="inline-flex min-h-tap items-center gap-1.5 rounded-sm text-primary underline-offset-4 hover:underline"
          >
            <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
            Machines
          </Link>
        }
        title={
          <>
            <span className="font-mono">{vm.assetTag}</span> {vm.name}
          </>
        }
        badges={
          <>
            <MachineStatusChip status={vm.status} label={vm.statusLabel} />
            <ClassificationBadge level={vm.classification} />
          </>
        }
        description={
          <>
            {vm.kindLabel}
            {vm.locationCell ? (
              <>
                <span aria-hidden="true"> · </span>
                <span className="sr-only">, </span>
                {vm.locationCell}
              </>
            ) : null}
          </>
        }
      />

      <SectionNav
        items={[
          { id: "quirks", label: "Quirks", count: vm.quirks.length },
          { id: "setups", label: "Setups", count: setupCount },
          { id: "issues", label: "Issues", count: issueCount },
          { id: "history", label: "History" },
          { id: "qr", label: "QR code" },
        ]}
      />

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <MachineSection
            id="quirks"
            title="This unit's quirks"
            count={vm.quirks.length}
            description={<>What the people who run {vm.assetTag} know about this particular unit. Approved cards come first.</>}
          >
            <CardList cards={vm.quirks} label="This unit's quirks" empty="No quirks recorded for this unit yet." />
          </MachineSection>

          <MachineSection id="setups" title="Common setups" count={setupCount}>
            <div>
              <SubHeading count={vm.setupSheets.length}>Setup sheets</SubHeading>
              <SheetList sheets={vm.setupSheets} />
            </div>
            <div>
              <SubHeading count={vm.setupTips.length}>Setup tips</SubHeading>
              <CardList cards={vm.setupTips} label="Setup tips" empty="No setup tips linked to this machine yet." />
            </div>
          </MachineSection>

          <MachineSection
            id="issues"
            title="Recent issues"
            count={issueCount}
            description={
              <>
                Events logged on this unit and failure stories captured about it from {formatDate(vm.windowStart)} to{" "}
                {formatDate(vm.demoToday)} (the last {vm.windowDays} days), newest events first.
              </>
            }
          >
            <div>
              <SubHeading count={vm.recentEvents.length}>Logged events</SubHeading>
              <EventList events={vm.recentEvents} windowDays={vm.windowDays} />
            </div>
            <div>
              <SubHeading count={vm.failureStories.length}>Failure stories</SubHeading>
              <CardList
                cards={vm.failureStories}
                label="Failure stories"
                empty={`No failure stories captured in the last ${vm.windowDays} days. Older ones are under All cards for this machine.`}
              />
            </div>
          </MachineSection>

          <MachineSection id="history" title="Unit history" description={<>This unit&apos;s own history, not the model in general.</>}>
            {vm.unitHistory.length > 0 ? (
              <div className="flex max-w-prose flex-col gap-3 text-ink">
                {vm.unitHistory.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No history recorded for this unit.</p>
            )}
          </MachineSection>
        </div>

        <aside aria-label="QR code and unit facts" className="flex min-w-0 flex-col gap-5">
          <div id="qr" className="scroll-mt-24">
            <QrPanel vm={vm} />
          </div>
          <LibraryAction vm={vm} />
          <MachineFacts vm={vm} />
        </aside>
      </div>
    </div>
  );
}
