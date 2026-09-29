/**
 * Print labels (PLAN.md §8.6, §10; §13 Phase 2 exit criterion "label PDF is 4×2 in"): the single-machine label
 * route prints as exactly one 288 × 144 pt page with an SVG QR code, and the 8-up label sheet prints all eight
 * machine labels on one US Letter page (612 × 792 pt). Uses Chromium's print-to-PDF with the page's own @page size.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { waitForHydration } from "./helpers/app";
import { readPdfPages, sameSize } from "./helpers/pdf";

const MACHINE_IDS = ["m-vf4", "m-st20", "m-dmu50", "m-genos", "m-integrex", "m-swiss", "m-cmm", "m-wedm"];

async function ready(page: Page): Promise<void> {
  await waitForHydration(page);
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

async function expectSvgQr(label: Locator, machineId: string): Promise<void> {
  const qr = label.locator("svg").first();
  await expect(qr).toBeVisible();
  // A real module path (e.g. "M4 4h7v1h-7z…"), not an empty or placeholder one.
  await expect(qr.locator("path").first()).toHaveAttribute("d", /^M[\d\s.,hvzHVZMm-]{200,}$/);
  await expect(qr).toHaveAttribute("data-qr-url", new RegExp(`/machines/${machineId}$`));
}

async function printPdf(page: Page) {
  const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  return readPdfPages(bytes);
}

test("the single machine label prints as one 4 × 2 in page (288 × 144 pt)", async ({ page }) => {
  const res = await page.goto("/machines/m-dmu50/print");
  expect(res?.status()).toBe(200);
  await ready(page);

  const label = page.getByTestId("machine-label");
  await expect(label).toHaveCount(1);
  await expect(label).toBeVisible();
  await expectSvgQr(label, "m-dmu50");
  // On screen the label is shown at actual size: 4 × 2 in = 384 × 192 CSS px.
  const box = (await label.boundingBox())!;
  expect(Math.abs(box.width - 384), `label width ${box.width}px`).toBeLessThanOrEqual(1);
  expect(Math.abs(box.height - 192), `label height ${box.height}px`).toBeLessThanOrEqual(1);

  const pdf = await printPdf(page);
  expect(pdf.pageCount, "PDF pages").toBe(1);
  expect(pdf.mediaBoxes.length, "PDF MediaBox entries").toBeGreaterThan(0);
  for (const b of pdf.mediaBoxes) expect(sameSize(b, 288, 144), `MediaBox ${b.join(" × ")} pt`).toBe(true);
});

test("the label sheet prints all 8 machine labels on one US Letter page (612 × 792 pt)", async ({ page }) => {
  const res = await page.goto("/machines/labels");
  expect(res?.status()).toBe(200);
  await ready(page);

  const sheet = page.getByTestId("label-sheet");
  await expect(sheet).toBeVisible();
  const labels = sheet.getByTestId("machine-label");
  await expect(labels).toHaveCount(MACHINE_IDS.length);
  for (const id of MACHINE_IDS) await expectSvgQr(sheet.locator(`[data-testid="machine-label"][data-machine-id="${id}"]`), id);

  const pdf = await printPdf(page);
  expect(pdf.pageCount, "PDF pages").toBe(1);
  expect(pdf.mediaBoxes.length, "PDF MediaBox entries").toBeGreaterThan(0);
  for (const b of pdf.mediaBoxes) expect(sameSize(b, 612, 792), `MediaBox ${b.join(" × ")} pt`).toBe(true);
});
