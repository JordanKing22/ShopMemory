/**
 * Wording and metric helpers for the Knowledge Risk screen (PLAN.md §6, §8.1). Pure and client-safe: no DB, no
 * Next.js. View-model types are imported type-only, so nothing from the data layer reaches the client bundle.
 */
import type { RiskBand } from "@/lib/coverage/params";
import type { RiskCellVM, RiskDeparture, RiskKpis, TopicCategory } from "@/lib/data/risk";
import { MINUS, formatNumber } from "@/lib/format";

export type RiskMetric = "risk" | "expertise" | "captured";
export type RiskView = "before" | "now";

export const METRICS: Readonly<Record<RiskMetric, { label: string; max: number; legend: string }>> = {
  risk: { label: "Risk", max: 100, legend: "Risk estimate, 0–100" },
  expertise: { label: "Expertise", max: 3, legend: "Tacit expertise level, 0–3" },
  captured: { label: "Captured %", max: 100, legend: "Share captured in approved cards, 0–100 %" },
};

/** Tacit level labels (seed-data/README.md). */
export const LEVEL_LABEL: Readonly<Record<0 | 1 | 2 | 3, string>> = {
  0: "none",
  1: "working knowledge",
  2: "independent; can teach the basics",
  3: "deep; the go-to person",
};

export const LEVEL_SHORT: Readonly<Record<0 | 1 | 2 | 3, string>> = {
  0: "none",
  1: "working",
  2: "independent",
  3: "deep",
};

export const CATEGORY_LABEL: Readonly<Record<TopicCategory, string>> = {
  process: "Processes",
  machine: "Machines",
  material: "Materials",
  customer: "Customers",
};

export { CARD_TYPE_LABEL } from "@/lib/card-labels";

/** The cell's value for a metric in the "now" or "before" view (captured % as a whole number). */
export function metricValue(cell: RiskCellVM, metric: RiskMetric, view: RiskView = "now"): number {
  const b = view === "before" ? cell.before : null;
  switch (metric) {
    case "risk":
      return b ? b.risk : cell.risk;
    case "expertise":
      return cell.level;
    case "captured":
      return Math.round(b ? b.capturedPct : cell.capturedPct);
  }
}

/** now − baseline for the active metric (0 without a baseline; the expertise level never changes at runtime). */
export function metricDelta(cell: RiskCellVM, metric: RiskMetric): number {
  if (!cell.before || metric === "expertise") return 0;
  return metricValue(cell, metric, "now") - metricValue(cell, metric, "before");
}

/** 1 → "1 approved card", 0 → "no approved cards". */
export function approvedCardsText(n: number): string {
  if (n === 0) return "no approved cards";
  return `${n} approved card${n === 1 ? "" : "s"}`;
}

function levelPhrase(level: 1 | 2 | 3): string {
  if (level === 3) return "holds deep knowledge of";
  if (level === 2) return "works independently on";
  return "has working knowledge of";
}

/** "Ray holds deep knowledge of Titanium · 2 approved cards · 15 % captured" (no departure information). */
export function explainCell(firstName: string, topicShortLabel: string, cell: Pick<RiskCellVM, "level" | "approvedCardIds" | "capturedPct">): string {
  return `${firstName} ${levelPhrase(cell.level)} ${topicShortLabel} · ${approvedCardsText(cell.approvedCardIds.length)} · ${formatNumber(cell.capturedPct, 0)} % captured`;
}

const BAND_WORD: Readonly<Record<RiskBand, string>> = { high: "High", elevated: "Elevated", watch: "Watch", low: "Low" };

/** Signed whole-number delta with a true minus: −16, +14, 0. */
export function signedInt(n: number): string {
  if (n > 0) return `+${formatNumber(n, 0)}`;
  if (n < 0) return `${MINUS}${formatNumber(-n, 0)}`;
  return "0";
}

/** Signed one-decimal delta: +14.0, −2.5. */
export function signedOneDecimal(n: number): string {
  const text = formatNumber(Math.abs(n), 1);
  if (text === "0.0") return "0.0";
  return `${n > 0 ? "+" : MINUS}${text}`;
}

/** Accessible name for a cell button, e.g. "Ray Delgado, Titanium: risk 57, High". */
export function cellAriaLabel(args: {
  personName: string;
  topicShortLabel: string;
  cell: RiskCellVM;
  metric: RiskMetric;
  view: RiskView;
  showDelta: boolean;
}): string {
  const { personName, topicShortLabel, cell, metric, view, showDelta } = args;
  const value = metricValue(cell, metric, view);
  const band = view === "before" && cell.before ? cell.before.band : cell.band;
  let what: string;
  if (metric === "risk") what = `risk ${value}, ${BAND_WORD[band]}`;
  else if (metric === "expertise") what = `expertise level ${value} (${LEVEL_SHORT[cell.level]})`;
  else what = `${value} % captured`;
  const delta = metricDelta(cell, metric);
  const deltaText = showDelta && delta !== 0 ? `, ${delta > 0 ? "up" : "down"} ${Math.abs(delta)} since the last reset` : "";
  return `${personName}, ${topicShortLabel}: ${what}${deltaText}`;
}

/** Column-header chip text for a visible departure: "Retires in 20 mo" / "Leaves in 20 mo". */
export function departureChipText(d: RiskDeparture): string {
  return `${d.kind === "retirement" ? "Retires" : "Leaves"} in ${d.months} mo`;
}

function monthsWords(n: number): string {
  return `${n} month${n === 1 ? "" : "s"}`;
}

/** The chip text split for a two-line chip: ["Retires", "in 20 mo"]. */
export function departureChipWords(d: RiskDeparture): [string, string] {
  return [d.kind === "retirement" ? "Retires" : "Leaves", `in ${d.months} mo`];
}

/** "retiring in 20 months" / "leaving in 3 months". */
export function departurePhrase(d: RiskDeparture): string {
  return `${d.kind === "retirement" ? "retiring" : "leaving"} in ${monthsWords(d.months)}`;
}

/**
 * The SPOF tile's supporting line. Owner/quoter: "both Ray Delgado, retiring in 20 months". Machinist/trainee get
 * the same line without the departure, because the view model has no departure for them to show.
 */
export function spofSubline(spof: RiskKpis["spof"]): string {
  if (spof.count === 0 || spof.holders.length === 0) return "No topic depends on one person right now";
  if (spof.holders.length === 1) {
    const h = spof.holders[0]!;
    const prefix = spof.count === 1 ? "" : spof.count === 2 ? "both " : `all ${spof.count}: `;
    const dep = !h.departure.hidden && h.departure.value ? `, ${departurePhrase(h.departure.value)}` : "";
    return `${prefix}${h.fullName}${dep}`;
  }
  return spof.holders
    .map((h) => {
      const dep = !h.departure.hidden && h.departure.value ? `, ${departurePhrase(h.departure.value)}` : "";
      return `${h.fullName} (${h.topics}${dep})`;
    })
    .join("; ");
}
