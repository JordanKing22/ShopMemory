import {
  BellRing,
  CalendarCheck,
  CircleArrowUp,
  CircleCheck,
  Clock,
  FileCheck,
  OctagonAlert,
  OctagonX,
  PencilLine,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { CardStatus } from "@/db/schema/enums";
import type { DocStatus, MachineEventKind, MachineStatus } from "@/lib/data/machines";
import { cn } from "@/lib/utils";

/*
 * Status chips for machine pages: icon + word + border, never color alone (PLAN.md §10). Orange strokes and icons
 * use signal-strong; orange fills are the soft tint with ink text. Labels come from the view model.
 * Safe in Server and Client Components (no hooks, no data imports at runtime).
 */

const CHIP = "inline-flex w-fit max-w-full items-center gap-1.5 rounded-md border px-2 py-px text-sm leading-5 font-medium";

const MACHINE_STATUS: Record<MachineStatus, { icon: LucideIcon; chip: string; iconClass: string }> = {
  running: { icon: CircleCheck, chip: "border-primary/40 bg-accent text-ink", iconClass: "text-primary" },
  down: { icon: OctagonX, chip: "border-destructive bg-surface text-ink font-semibold", iconClass: "text-destructive" },
  pm: { icon: Wrench, chip: "border-signal-strong bg-signal-tint text-ink", iconClass: "text-signal-strong" },
};

export function MachineStatusChip({ status, label, className }: { status: MachineStatus; label: string; className?: string }) {
  const s = MACHINE_STATUS[status];
  const Icon = s.icon;
  return (
    <span data-machine-status={status} className={cn(CHIP, s.chip, className)}>
      <Icon aria-hidden="true" className={cn("size-4 shrink-0", s.iconClass)} strokeWidth={2.25} />
      <span className="min-w-0">{label}</span>
    </span>
  );
}

const EVENT_KIND: Record<MachineEventKind, { icon: LucideIcon; iconClass: string }> = {
  issue: { icon: TriangleAlert, iconClass: "text-signal-strong" },
  alarm: { icon: BellRing, iconClass: "text-signal-strong" },
  crash: { icon: OctagonAlert, iconClass: "text-destructive" },
  repair: { icon: Wrench, iconClass: "text-muted-foreground" },
  pm: { icon: CalendarCheck, iconClass: "text-primary" },
  upgrade: { icon: CircleArrowUp, iconClass: "text-primary" },
};

export function EventKindChip({ kind, label, className }: { kind: MachineEventKind; label: string; className?: string }) {
  const s = EVENT_KIND[kind];
  const Icon = s.icon;
  return (
    <span
      data-event-kind={kind}
      className={cn(CHIP, "border-input-border bg-surface text-ink", kind === "crash" && "border-destructive", className)}
    >
      <Icon aria-hidden="true" className={cn("size-4 shrink-0", s.iconClass)} strokeWidth={2.25} />
      <span className="min-w-0">{label}</span>
    </span>
  );
}

const CARD_STATUS: Partial<Record<CardStatus, { icon: LucideIcon; chip: string; iconClass: string }>> = {
  approved: { icon: CircleCheck, chip: "border-primary/40 bg-accent text-ink", iconClass: "text-primary" },
  pending_review: { icon: Clock, chip: "border-signal-strong bg-signal-tint text-ink", iconClass: "text-signal-strong" },
  draft: { icon: PencilLine, chip: "border-dashed border-input-border bg-surface-sunken text-ink", iconClass: "text-muted-foreground" },
};

export function CardStatusBadge({ status, label, className }: { status: CardStatus; label: string; className?: string }) {
  const s = CARD_STATUS[status] ?? CARD_STATUS.draft!;
  const Icon = s.icon;
  return (
    <span data-card-status={status} className={cn(CHIP, s.chip, className)}>
      <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", s.iconClass)} strokeWidth={2.25} />
      <span className="min-w-0">{label}</span>
    </span>
  );
}

const SHEET_STATUS: Partial<Record<DocStatus, { icon: LucideIcon; chip: string; iconClass: string }>> = {
  approved: { icon: FileCheck, chip: "border-primary/40 bg-accent text-ink", iconClass: "text-primary" },
  expert_review: { icon: Clock, chip: "border-signal-strong bg-signal-tint text-ink", iconClass: "text-signal-strong" },
  draft: { icon: PencilLine, chip: "border-dashed border-input-border bg-surface-sunken text-ink", iconClass: "text-muted-foreground" },
};

export function SheetStatusBadge({ status, label, className }: { status: DocStatus; label: string; className?: string }) {
  const s = SHEET_STATUS[status] ?? SHEET_STATUS.draft!;
  const Icon = s.icon;
  return (
    <span data-doc-status={status} className={cn(CHIP, s.chip, className)}>
      <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", s.iconClass)} strokeWidth={2.25} />
      <span className="min-w-0">{label}</span>
    </span>
  );
}
