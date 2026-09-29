import type { MachineLabelVM } from "@/lib/data/machines";
import { cn } from "@/lib/utils";
import { MachineQr } from "./machine-qr";

/*
 * Printable QR labels (PLAN.md §8.6, §10). The geometry is plain CSS in physical units, independent of Tailwind, so
 * the printed size can't drift with utility changes. Each print route renders these rules in an inline <style>
 * (it comes after globals.css in the document, and the @page margin is !important as well, so it beats the global
 * `@page { margin: .5in }`). Inline, not a global stylesheet: the rules leave with the route on client navigation,
 * so they can never resize another page's print.
 *
 * No quotes, `<` or `>` in these strings: they are emitted verbatim inside <style>.
 */

/** One 4 × 2 in label: QR (1.6 in, quiet zone included) on the left, asset tag, name, shop and short URL on the right. */
export const LABEL_CSS = `
.fw-label {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 0.14in;
  width: 4in;
  height: 2in;
  padding: 0.2in;
  overflow: hidden;
  background: #ffffff;
  color: #000000;
  break-inside: avoid;
  page-break-inside: avoid;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.fw-label-qr { flex: none; width: 1.6in; height: 1.6in; }
.fw-label-text { display: flex; flex: 1 1 auto; min-width: 0; flex-direction: column; gap: 0.05in; }
.fw-label-tag { font-size: 26pt; font-weight: 700; line-height: 1; letter-spacing: 0.02em; }
.fw-label-name { font-size: 11pt; font-weight: 600; line-height: 1.15; overflow-wrap: anywhere; }
.fw-label-shop { font-size: 8pt; line-height: 1.2; }
.fw-label-url { font-family: var(--font-geist-mono), ui-monospace, monospace; font-size: 7pt; line-height: 1.25; overflow-wrap: anywhere; }
@media screen {
  .fw-label { outline: 1px dashed #868b94; }
}
`;

/**
 * /machines/[id]/print: the page IS the label. `preferCSSPageSize` PDFs come out as one 288 × 144 pt page; html and
 * body are clipped to the label in print so nothing (not even a 1 px live region) can spill onto a second page.
 */
export const SINGLE_LABEL_PAGE_CSS = `
@page { size: 4in 2in; margin: 0 !important; }
@media print {
  html, body {
    width: 4in !important;
    height: 2in !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    background: #ffffff !important;
  }
}
`;

/**
 * /machines/labels: 8-up on US Letter, 2 columns × 4 rows of 4 × 2 in labels. Laid out on the common 10-per-sheet
 * 4 × 2 in label stock geometry (0.5 in top and bottom margins, 0.15625 in side margins, 0.1875 in gutter), so labels
 * print at true size; the fifth row of that stock stays blank. A 0.5 in side margin would leave 7.5 in, too narrow
 * for two 4 in columns without the browser scaling them down.
 */
export const LABEL_SHEET_PAGE_CSS = `
@page { size: letter; margin: 0.5in 0.15625in !important; }
.fw-sheet {
  display: grid;
  grid-template-columns: 4in 4in;
  grid-auto-rows: 2in;
  column-gap: 0.1875in;
  row-gap: 0;
  width: 8.1875in;
}
.fw-paper {
  box-sizing: border-box;
  width: 8.5in;
  min-height: 11in;
  padding: 0.5in 0.15625in;
  background: #ffffff;
}
@media print {
  html, body { height: auto !important; min-height: 0 !important; }
  .fw-paper { width: auto; min-height: 0; padding: 0; box-shadow: none !important; }
}
`;

export interface MachineLabelProps {
  label: MachineLabelVM;
  className?: string;
}

/** A 4 × 2 in machine label (data-testid="machine-label"). The QR's accessible name carries the URL. */
export function MachineLabel({ label, className }: MachineLabelProps) {
  return (
    <div
      data-testid="machine-label"
      data-machine-id={label.id}
      className={cn("fw-label", className)}
      role="group"
      aria-label={`QR label for ${label.assetTag} ${label.name}`}
    >
      <MachineQr qr={label.qr} className="fw-label-qr" />
      <div className="fw-label-text">
        <div className="fw-label-tag">{label.assetTag}</div>
        <div className="fw-label-name">{label.name}</div>
        <div className="fw-label-shop">{label.shopLabel}</div>
        <div className="fw-label-url">{label.qr.shortUrl}</div>
      </div>
    </div>
  );
}

/** The 8-up label grid (data-testid="label-sheet"), one label per machine in the shop's usual order. */
export function LabelSheet({ labels, className }: { labels: MachineLabelVM[]; className?: string }) {
  return (
    <div
      data-testid="label-sheet"
      data-label-count={labels.length}
      role="group"
      aria-label={`QR label sheet: ${labels.length} labels`}
      className={cn("fw-sheet", className)}
    >
      {labels.map((l) => (
        <MachineLabel key={l.id} label={l} />
      ))}
    </div>
  );
}
