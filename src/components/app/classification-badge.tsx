import { Building2, Circle, Handshake, ShieldAlert, type LucideIcon } from "lucide-react";
import type { Classification } from "@/db/schema/enums";
import { CLASSIFICATION_LABEL, CLASSIFICATION_SHORT } from "@/lib/classification-labels";
import { cn } from "@/lib/utils";
import { InfoPopover } from "./info-popover";

/** Visible words (PLAN.md §4.3) and the G / I / CC / EC letters; defined once in src/lib/classification-labels.ts. */
export { CLASSIFICATION_LABEL, CLASSIFICATION_SHORT };

/** Badge tooltip copy, verbatim from PLAN.md §4.3. */
export const CLASSIFICATION_INFO =
  "These labels control routing inside this app. They are not official CUI markings or export-classification determinations. If a record contains CUI (including Controlled Technical Information or covered defense information), label it export_controlled here so it only reaches the local model or an allowlisted GovCloud endpoint.";

export const CLASSIFICATION_ICON: Record<Classification, LucideIcon> = {
  general: Circle,
  internal: Building2,
  customer_confidential: Handshake,
  export_controlled: ShieldAlert,
};

/**
 * Color + icon + word + shape cue, never color alone (PLAN.md §10):
 * general = outlined pill · internal = filled pill · customer-confidential = filled pill with a solid rim ·
 * export-controlled = square-cornered red block, white text, heavier weight.
 */
const STYLE: Record<Classification, string> = {
  general: "rounded-full border border-input-border bg-cls-general text-cls-general-fg",
  internal: "rounded-full border border-transparent bg-cls-internal text-cls-internal-fg",
  customer_confidential: "rounded-full border border-cls-cc-fg bg-cls-cc text-cls-cc-fg",
  export_controlled: "rounded-[3px] border-2 border-cls-ec bg-cls-ec text-cls-ec-fg font-semibold uppercase tracking-wide",
};

export interface ClassificationBadgeProps {
  level: Classification;
  /** "sm" for dense tables and lists, "md" (default) elsewhere. Both keep the full word. */
  size?: "sm" | "md";
  /**
   * true (default): the badge is a button that opens the "what these labels mean" note on click, tap or
   * Enter. Pass info={false} when the badge sits inside a link, a button or a clickable row
   * (nested interactive controls fail axe).
   */
  info?: boolean;
  className?: string;
}

function BadgeVisual({ level, size = "md", className }: Omit<ClassificationBadgeProps, "info">) {
  const Icon = CLASSIFICATION_ICON[level];
  return (
    <span
      data-classification={level}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap font-medium",
        // text-sm before leading-5: tailwind-merge drops a line-height that precedes a font-size.
        size === "sm" ? "px-2 py-px text-sm leading-5" : "px-2.5 py-0.5 text-sm leading-5",
        STYLE[level],
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn("shrink-0", size === "sm" ? "size-3.5" : "size-4")} strokeWidth={2.25} />
      <span>{CLASSIFICATION_LABEL[level]}</span>
    </span>
  );
}

/** The classification chip shown on every record that can reach a model. */
export function ClassificationBadge({ level, size = "md", info = true, className }: ClassificationBadgeProps) {
  if (!info) return <BadgeVisual level={level} size={size} className={className} />;
  return (
    <InfoPopover
      triggerLabel={`${CLASSIFICATION_LABEL[level]}: what this label means`}
      panelLabel={`${CLASSIFICATION_LABEL[level]}: what this label means`}
      // Visual stays badge-sized; the ::before is centred and --tap tall, so the hit area is 44 px (48 px on
      // coarse pointers) whatever the badge size, without growing table rows.
      triggerClassName="relative min-h-0 rounded-full p-0 hover:bg-transparent data-[state=open]:bg-transparent before:absolute before:-inset-x-1 before:top-1/2 before:h-tap before:-translate-y-1/2 before:content-['']"
      trigger={<BadgeVisual level={level} size={size} className={className} />}
    >
      <div className="mb-2">
        <BadgeVisual level={level} size="sm" />
      </div>
      <p>{CLASSIFICATION_INFO}</p>
    </InfoPopover>
  );
}

/** Just the icon for a level (aria-hidden); pair it with visible words. */
export function ClassificationIcon({ level, className }: { level: Classification; className?: string }) {
  const Icon = CLASSIFICATION_ICON[level];
  return <Icon aria-hidden="true" className={cn("size-4 shrink-0", className)} />;
}
