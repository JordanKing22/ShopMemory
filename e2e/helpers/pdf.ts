/**
 * Just enough PDF reading for the print tests, without a new dependency: Chromium (Skia) writes page objects as
 * plain dictionaries, so the page count and every /MediaBox can be read with a regex over the bytes.
 */

export interface PdfPageInfo {
  /** Number of `/Type /Page` objects (not `/Pages`). */
  pageCount: number;
  /** [width, height] in points for every /MediaBox found. */
  mediaBoxes: [number, number][];
}

export function readPdfPages(bytes: Buffer): PdfPageInfo {
  const text = bytes.toString("latin1");
  if (!text.startsWith("%PDF-")) throw new Error("Not a PDF (missing %PDF- header).");
  const pageCount = (text.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
  const mediaBoxes: [number, number][] = [];
  for (const m of text.matchAll(/\/MediaBox\s*\[\s*([-+\d.eE\s]+?)\s*\]/g)) {
    const n = m[1].trim().split(/\s+/).map(Number);
    if (n.length === 4 && n.every(Number.isFinite)) mediaBoxes.push([n[2] - n[0], n[3] - n[1]]);
  }
  return { pageCount, mediaBoxes };
}

/** True when a [w, h] box matches the expected size within `tolerance` points. */
export function sameSize(box: [number, number], width: number, height: number, tolerance = 1): boolean {
  return Math.abs(box[0] - width) <= tolerance && Math.abs(box[1] - height) <= tolerance;
}
