/**
 * Visible words for knowledge-card types and statuses (PLAN.md §5, §8.3). Pure data with no DB imports, so data
 * modules, Server Components, Client Components and node-env tests share one copy.
 */
import type { CardStatus, CardType } from "@/db/schema/enums";

export const CARD_TYPE_LABEL: Readonly<Record<CardType, string>> = {
  quoting_rule: "Quoting rule",
  setup_tip: "Setup tip",
  machine_quirk: "Machine quirk",
  customer_quirk: "Customer quirk",
  inspection_gotcha: "Inspection gotcha",
  failure_story: "Failure story",
};

export const CARD_STATUS_LABEL: Readonly<Record<CardStatus, string>> = {
  approved: "Approved",
  pending_review: "Pending review",
  draft: "Draft",
  rejected: "Rejected",
  superseded: "Superseded",
};
