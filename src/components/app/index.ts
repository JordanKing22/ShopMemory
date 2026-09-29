/**
 * Shared presentational components (safe in Server and Client Components).
 * Shell pieces that read server config (Header, ProviderBadge) are imported from their own files.
 */
export {
  CLASSIFICATION_ICON,
  CLASSIFICATION_INFO,
  CLASSIFICATION_LABEL,
  CLASSIFICATION_SHORT,
  ClassificationBadge,
  ClassificationIcon,
  type ClassificationBadgeProps,
} from "./classification-badge";
export { EmptyState, type EmptyStateProps } from "./empty-state";
export { ExportControlledBanner, type ExportControlledBannerProps } from "./export-controlled-banner";
export { FICTIONAL_NOTICE_FALLBACK, FictionalBanner, type FictionalBannerProps } from "./fictional-banner";
export { GatedValue, HiddenField, type GatedLike, type GatedValueProps, type HiddenFieldProps } from "./hidden-field";
export { InfoPopover, type InfoPopoverProps } from "./info-popover";
export { LogoMark } from "./logo";
export { PageHeader, type PageHeaderProps } from "./page-header";
export { RISK_BAND_ICON, RISK_BAND_LABEL, RiskBandChip, type RiskBandChipProps } from "./risk-band-chip";
export { SpofFlag, type SpofFlagProps } from "./spof-flag";
export { StatTile, type StatTileProps } from "./stat-tile";
