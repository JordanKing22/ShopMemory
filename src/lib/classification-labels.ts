/**
 * Visible words for the four classification levels (PLAN.md §4.3). Pure data so Server Components, Client
 * Components and node-env tests share one copy; ClassificationBadge re-exports these.
 */
import type { Classification } from "@/db/schema/enums";

export const CLASSIFICATION_LABEL: Readonly<Record<Classification, string>> = {
  general: "General",
  internal: "Internal",
  customer_confidential: "Customer-confidential",
  export_controlled: "Export-controlled",
};

/** Letters used by the header clearance dots (G / I / CC / EC). */
export const CLASSIFICATION_SHORT: Readonly<Record<Classification, string>> = {
  general: "G",
  internal: "I",
  customer_confidential: "CC",
  export_controlled: "EC",
};
