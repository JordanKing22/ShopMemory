/**
 * Heat-map color ramp (PLAN.md §8.1, §10): a single-hue BLUE sequential ramp, light → dark, with the number printed
 * in every cell as the secondary encoding. Steps are the dataviz reference sequential blue (100…700).
 *
 * Palette check, run with the dataviz skill's validator (categorical mode, which a sequential ramp fails by design:
 * it spans the lightness band and neighbouring steps sit close; the printed numbers are the relief channel):
 *
 *   node validate_palette.js "#cde2fb,#b7d3f6,#9ec5f4,#86b6ef,#6da7ec,#5598e7,#3987e5,#2a78d6,#256abf,#1c5cab,#184f95,#104281,#0d366b" --mode light
 *   Palette (light, surface #fcfcfb, categorical): 13 slots
 *     [FAIL] Lightness band         outside band: #cde2fb 0.905, #b7d3f6 0.858, #9ec5f4 0.812, #104281 0.385, #0d366b 0.338
 *     [FAIL] Chroma floor           below floor (reads gray): #cde2fb 0.041, #b7d3f6 0.057, #9ec5f4 0.079, #86b6ef 0.097
 *     [FAIL] CVD separation         worst adjacent #9ec5f4↔#b7d3f6 ΔE 4.5 (protan) · tritan 3.7
 *     [FAIL] Normal-vision floor    worst adjacent #2a78d6↔#3987e5 ΔE 4.7 (normal)
 *     [WARN] Contrast vs surface    below 3:1 — relief required (visible labels or table view): 100…350
 *   (--ordinal: [PASS] lightness monotone · [PASS] single hue, spread 4° · adjacent ΔL ≈ 0.047 < 0.06 and light end
 *   1.29:1 — expected for a 13-step continuous ramp whose lightest step means "near zero".)
 *
 * The relief channel is the printed value in every cell (plus the scale legend and the cell sheet), so hue is never
 * the only encoding.
 *
 * Text on each fill is ink (#16181C) or white, whichever clears WCAG 4.5:1 (tests/data-risk.test.ts recomputes it).
 * Step 450 (#2a78d6) is SKIPPED for cell fills: neither ink (4.03:1) nor white (4.42:1) reaches 4.5:1 on it.
 */

export const INK = "#16181c";
export const WHITE = "#ffffff";

/** The 13 reference steps (documentation and the palette check). */
export const REFERENCE_STEPS = [
  { step: 100, hex: "#cde2fb" },
  { step: 150, hex: "#b7d3f6" },
  { step: 200, hex: "#9ec5f4" },
  { step: 250, hex: "#86b6ef" },
  { step: 300, hex: "#6da7ec" },
  { step: 350, hex: "#5598e7" },
  { step: 400, hex: "#3987e5" },
  { step: 450, hex: "#2a78d6" },
  { step: 500, hex: "#256abf" },
  { step: 550, hex: "#1c5cab" },
  { step: 600, hex: "#184f95" },
  { step: 650, hex: "#104281" },
  { step: 700, hex: "#0d366b" },
] as const;

export interface RampStep {
  step: number;
  /** Fill color. */
  hex: string;
  /** Text color for numbers printed on this fill. */
  text: "ink" | "white";
}

/** The 12 fills the heat map uses (450 skipped, see above), light → dark. */
export const CELL_RAMP: readonly RampStep[] = [
  { step: 100, hex: "#cde2fb", text: "ink" },
  { step: 150, hex: "#b7d3f6", text: "ink" },
  { step: 200, hex: "#9ec5f4", text: "ink" },
  { step: 250, hex: "#86b6ef", text: "ink" },
  { step: 300, hex: "#6da7ec", text: "ink" },
  { step: 350, hex: "#5598e7", text: "ink" },
  { step: 400, hex: "#3987e5", text: "ink" },
  { step: 500, hex: "#256abf", text: "white" },
  { step: 550, hex: "#1c5cab", text: "white" },
  { step: 600, hex: "#184f95", text: "white" },
  { step: 650, hex: "#104281", text: "white" },
  { step: 700, hex: "#0d366b", text: "white" },
];

/** Hex of a step's text color. */
export function textHex(s: RampStep): string {
  return s.text === "ink" ? INK : WHITE;
}

/**
 * Equal-width bins over [0, max]: value / max × 12, floored, clamped to the last step. Monotone, so a darker fill
 * always means a larger value. `max` is 100 for risk and captured %, 3 for the expertise level.
 */
export function rampIndex(value: number, max: number): number {
  if (!Number.isFinite(value) || max <= 0) return 0;
  const t = Math.min(1, Math.max(0, value / max));
  return Math.min(CELL_RAMP.length - 1, Math.floor(t * CELL_RAMP.length));
}

export function rampStep(value: number, max: number): RampStep {
  return CELL_RAMP[rampIndex(value, max)]!;
}

/** WCAG 2.x relative luminance of a #rrggbb color. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #rrggbb colors (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
