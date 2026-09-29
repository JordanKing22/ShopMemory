/**
 * The read-only list and detail pages (PLAN.md §9; §13 Phase 2 scope): every seeded holder and machine has a row,
 * the jobs list covers quotes with jobs, quotes without one and internal work orders, and a row opens its detail
 * page (machine QR code, job hours bar and prices section, person departure field).
 */
import { expect, test } from "@playwright/test";
import { waitForHydration } from "./helpers/app";

const PEOPLE = ["PER-01", "PER-02", "PER-03", "PER-04", "PER-05", "PER-06", "PER-07", "PER-08"];
const MACHINES = ["m-vf4", "m-st20", "m-dmu50", "m-genos", "m-integrex", "m-swiss", "m-cmm", "m-wedm"];

test("people: one row per knowledge holder; Ray's row opens his profile", async ({ page }) => {
  await page.goto("/people");
  await waitForHydration(page);
  for (const id of PEOPLE) await expect(page.getByTestId(`person-row-${id}`)).toHaveCount(1);
  // Owner (the default persona) sees Ray's planned retirement in the list.
  await expect(page.getByTestId("person-row-PER-01").getByTestId("person-departure")).toContainText("2028");

  await page.getByTestId("person-row-PER-01").getByRole("link").first().click();
  await expect(page).toHaveURL(/\/people\/PER-01$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Ray Delgado");
  await expect(page.getByTestId("person-departure").first()).toContainText("May 15, 2028");
});

test("machines: one row per machine; the DMU 50 page shows its QR code", async ({ page }) => {
  await page.goto("/machines");
  await waitForHydration(page);
  for (const id of MACHINES) await expect(page.getByTestId(`machine-row-${id}`)).toHaveCount(1);

  await page.getByTestId("machine-row-m-dmu50").getByRole("link").first().click();
  await expect(page).toHaveURL(/\/machines\/m-dmu50$/);
  const qr = page.getByTestId("machine-qr");
  await expect(qr).toBeVisible();
  await expect(qr.locator("svg")).toBeVisible();
  await expect(qr).toHaveAttribute("data-qr-url", /\/machines\/m-dmu50$/);
});

test("jobs: quotes with and without a job and internal work orders are listed; J-A03 opens its job page", async ({ page }) => {
  await page.goto("/jobs");
  await waitForHydration(page);
  for (const id of ["J-A03", "Q-A01", "J-A10", "J-I01"]) await expect(page.getByTestId(`job-row-${id}`)).toHaveCount(1);

  await page.getByTestId("job-row-J-A03").getByRole("link").first().click();
  await expect(page).toHaveURL(/\/jobs\/J-A03$/);
  await expect(page.getByTestId("hours-bar")).toBeVisible();
  await expect(page.getByTestId("job-financials")).toBeVisible();
  await expect(page.getByTestId("price-unit")).not.toContainText("Hidden for");
});

test("an export-controlled job carries the export-controlled banner", async ({ page }) => {
  const res = await page.goto("/jobs/J-A10");
  expect(res?.status()).toBe(200);
  await waitForHydration(page);
  await expect(page.getByRole("region", { name: "Export-controlled record" })).toBeVisible();
});

/**
 * Regression (jobs list clipped at 1280 px): the list used to switch to its 8-column table layout at xl (1280 px), where
 * the table needs ~1081 px but its card is ~1007–1022 px wide, so the Status · outcome column was cut off mid-word and no
 * keyboard user could scroll it into view. Whichever layout a width gets (cards below 1440 px, the table from 1440 px),
 * nothing may overflow the list's container. A 15 px right gutter stands in for a classic (Windows) scrollbar, which
 * headless Chromium hides; it only makes the container narrower, so it is the worst case.
 */
for (const vp of [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
]) {
  test(`jobs: the list fits its container at ${vp.width}×${vp.height} with a classic scrollbar (no clipped column)`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto("/jobs");
    await waitForHydration(page);
    await page.addStyleTag({ content: "html { padding-right: 15px; }" });

    const table = page.getByTestId("jobs-table");
    const parent = await table.evaluate((el) => {
      const p = el.parentElement as HTMLElement;
      return { scrollWidth: p.scrollWidth, clientWidth: p.clientWidth, right: p.getBoundingClientRect().right };
    });
    expect(parent.scrollWidth, "the jobs list overflows its container").toBeLessThanOrEqual(parent.clientWidth);

    const cell = await table.locator("tbody tr:first-child td:last-child").boundingBox();
    expect(cell, "the first row has a Status · outcome cell").not.toBeNull();
    expect((cell?.x ?? 0) + (cell?.width ?? 0), "the Status · outcome cell is cut off").toBeLessThanOrEqual(parent.right + 0.5);
  });
}

/**
 * Regression (breadcrumb back links too narrow): the "Jobs" / "People" / "Knowledge Library" breadcrumb link is the main
 * way back on a phone, but it had only a height minimum, so "Jobs" was 32 px wide (and "People" 45 px on a coarse
 * pointer). On a 390 px touch phone every breadcrumb link must be at least 48×48 px (PLAN.md §10).
 */
test.describe("breadcrumbs on a touch phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  for (const route of ["/jobs/J-A03", "/people/PER-01", "/library/KC-001"]) {
    test(`${route}: the breadcrumb back link is at least 48×48 px`, async ({ page }) => {
      await page.goto(route);
      await waitForHydration(page);
      const link = page.locator('nav[aria-label="Breadcrumb"] a');
      await expect(link).toHaveCount(1);
      const box = await link.boundingBox();
      expect(box, "the breadcrumb link has a box").not.toBeNull();
      expect(box!.width, "breadcrumb link width").toBeGreaterThanOrEqual(48);
      expect(box!.height, "breadcrumb link height").toBeGreaterThanOrEqual(48);
    });
  }
});
