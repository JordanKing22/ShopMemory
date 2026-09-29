/**
 * Knowledge Risk (PLAN.md §8.1; demo step 1): at 1280×720 both single-point-of-failure rows (Ray on titanium and on
 * thin walls, risk 57) lead the "highest risk first" heat map and are fully on screen without scrolling; the cell
 * sheet opens on click; the departure-derived pieces (retirement chip, departing KPI, departure factor, and the
 * tenure and backup factors that would reveal it) show for the owner and are absent / "Hidden for Machinist role"
 * for Marv; the metric toggle switches cells to expertise; at 390 px, arrow-key focus never lands under the sticky
 * Topic column.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectInViewport, hiddenLabelFor, switchPersona, waitForHydration } from "./helpers/app";

test.use({ viewport: { width: 1280, height: 720 } });

const SPOF_TOPICS = ["t-mat-ti64", "t-thin-wall"];
const RAY = "PER-01";

async function openRisk(page: Page): Promise<void> {
  const res = await page.goto("/risk");
  expect(res?.status()).toBe(200);
  await waitForHydration(page);
  await expect(page.getByTestId("risk-heatmap")).toBeVisible();
}

async function openCellSheet(page: Page, personId: string, topicId: string) {
  await page.getByTestId(`risk-cell-${personId}-${topicId}`).click();
  const sheet = page.getByTestId("risk-cell-sheet");
  await expect(sheet).toBeVisible();
  return sheet;
}

async function closeCellSheet(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("risk-cell-sheet")).toHaveCount(0);
}

test("both SPOF rows lead the heat map and fit the projector viewport without scrolling", async ({ page }) => {
  await openRisk(page);

  const rowIds = await page
    .getByTestId("risk-heatmap")
    .locator('tbody tr[data-testid^="risk-row-"]')
    .evaluateAll((rows) => rows.slice(0, 2).map((r) => r.getAttribute("data-testid")));
  expect([...rowIds].sort()).toEqual(SPOF_TOPICS.map((t) => `risk-row-${t}`).sort());

  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  for (const topicId of SPOF_TOPICS) {
    const row = page.getByTestId(`risk-row-${topicId}`);
    await expect(row).toHaveAttribute("data-band", "high");
    await expect(row).toHaveAttribute("data-spof", "true");
    await expectInViewport(page, row, `risk-row-${topicId}`);
    // Ray's cell (the first column) is on screen too, horizontally as well as vertically.
    const cell = page.getByTestId(`risk-cell-${RAY}-${topicId}`);
    await expectInViewport(page, cell, `risk-cell-${RAY}-${topicId}`);
    const box = (await cell.boundingBox())!;
    expect(box.x + box.width, `risk-cell-${RAY}-${topicId}: right edge inside 1280px`).toBeLessThanOrEqual(1280);
  }
});

test("Ray's titanium cell scores 57 and opens its explanation sheet", async ({ page }) => {
  await openRisk(page);
  const cell = page.getByTestId(`risk-cell-${RAY}-t-mat-ti64`);
  await expect(cell).toHaveText("57");
  await expect(cell).toHaveAttribute("data-risk", "57");
  const sheet = await openCellSheet(page, RAY, "t-mat-ti64");
  await expect(sheet).toContainText("Ray Delgado");
  await closeCellSheet(page);
});

test("the owner sees departure-derived values; Marv sees none of them", async ({ page }) => {
  await openRisk(page);
  await switchPersona(page, "Dana Whitcomb");

  // Owner: the retirement chip on Ray's column, the departing KPI and the departure factor value.
  await expect(page.getByTestId(`retires-chip-${RAY}`)).toBeVisible();
  await expect(page.getByTestId("kpi-departing")).toBeVisible();
  for (const kpi of ["kpi-high", "kpi-spof", "kpi-approved-30d"]) await expect(page.getByTestId(kpi)).toBeVisible();
  let sheet = await openCellSheet(page, RAY, "t-mat-ti64");
  const ownerFactor = sheet.getByTestId("risk-factor-departure");
  await expect(ownerFactor).toBeVisible();
  await expect(ownerFactor).not.toContainText("Hidden for");
  await expect(ownerFactor).toContainText(/\d\.\d/);
  for (const id of ["risk-factor-tenure", "risk-factor-backup"]) await expect(sheet.getByTestId(id)).not.toContainText("Hidden for");
  await expect(sheet.getByTestId("risk-equation")).toContainText("0.83");
  await closeCellSheet(page);

  // Marv (machinist): no chip, no departing KPI; the factor is the visible pill.
  await switchPersona(page, "Marv Tollefson");
  await expect(page.getByTestId(`risk-cell-${RAY}-t-mat-ti64`)).toHaveText("57");
  await expect(page.locator('[data-testid^="retires-chip-"]')).toHaveCount(0);
  await expect(page.getByTestId("kpi-departing")).toHaveCount(0);
  for (const kpi of ["kpi-high", "kpi-spof", "kpi-approved-30d"]) await expect(page.getByTestId(kpi)).toBeVisible();
  sheet = await openCellSheet(page, RAY, "t-mat-ti64");
  const marvFactor = sheet.getByTestId("risk-factor-departure");
  await expect(marvFactor).toContainText(hiddenLabelFor("Marv Tollefson"));
  await expect(marvFactor).not.toContainText(/\d\.\d/);
  // T and D are hidden too (with risk, E and f on screen, either would let U be solved for), and the equation is
  // symbolic: no rounded factor to divide by.
  for (const id of ["risk-factor-tenure", "risk-factor-backup"]) await expect(sheet.getByTestId(id)).toContainText(hiddenLabelFor("Marv Tollefson"));
  await expect(sheet.getByTestId("risk-factor-backup")).not.toContainText(/\d/);
  await expect(sheet.getByTestId("risk-equation")).toHaveText(/^100 × \(E\/3\) × \(1 − f\) × U × T × D ≈ 57$/);
  await expect(sheet.getByTestId("risk-equation")).not.toContainText(/\d\.\d/);
  await closeCellSheet(page);

  // The same after a full reload (the server re-reads the persona cookie).
  await page.reload();
  await waitForHydration(page);
  await expect(page.locator('[data-testid^="retires-chip-"]')).toHaveCount(0);
  await expect(page.getByTestId("kpi-departing")).toHaveCount(0);

  await switchPersona(page, "Dana Whitcomb");
  await expect(page.getByTestId(`retires-chip-${RAY}`)).toBeVisible();
});

test("the metric toggle switches cells to expertise", async ({ page }) => {
  await openRisk(page);
  const cell = page.getByTestId(`risk-cell-${RAY}-t-mat-ti64`);
  await expect(cell).toHaveText("57");

  const metric = page.getByTestId("risk-metric");
  await expect(metric).toBeVisible();
  await metric.locator('[data-value="expertise"], [value="expertise"]').first().click();
  await expect(cell).toHaveText("3");
  // Risk stays the sort key and the data attribute whatever the metric.
  await expect(cell).toHaveAttribute("data-risk", "57");

  await metric.locator('[data-value="risk"], [value="risk"]').first().click();
  await expect(cell).toHaveText("57");
});

test.describe("phone width (390×844)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("arrow-key focus stays clear of the sticky Topic column and the scroller's right edge (WCAG 2.4.11)", async ({ page }) => {
    await openRisk(page);
    const RING = 4; // 2 px outline + 2 px offset (globals.css :focus-visible)
    /** Clearance of the focused cell (px): left of it the sticky row header + ring, right of it the scroller edge − ring. */
    const clearance = () =>
      page.evaluate((ring) => {
        const el = document.activeElement;
        if (!(el instanceof HTMLElement) || !el.dataset.cell) return null;
        const th = el.closest("tr")?.querySelector("th");
        const scroller = el.closest<HTMLElement>("[data-heat-scroll]");
        if (!th || !scroller) return null;
        const c = el.getBoundingClientRect();
        const s = scroller.getBoundingClientRect();
        return {
          cell: el.dataset.cell,
          left: c.left - (th.getBoundingClientRect().right + ring),
          right: s.left + scroller.clientLeft + scroller.clientWidth - ring - c.right,
        };
      }, RING);

    await page.getByTestId(`risk-cell-${RAY}-t-mat-6061`).focus();
    const visited = new Set<string>();
    const keys = [...Array<string>(7).fill("ArrowRight"), ...Array<string>(7).fill("ArrowLeft")];
    for (const [i, key] of keys.entries()) {
      await page.keyboard.press(key);
      const m = await clearance();
      expect(m, `${key} #${i + 1}: a heat-map cell has focus`).not.toBeNull();
      visited.add(m!.cell);
      // Half a pixel of slack for sub-pixel layout; the bug this guards against hid 73 of 83 px.
      expect(m!.left, `${key} #${i + 1} (${m!.cell}): clear of the sticky Topic column`).toBeGreaterThanOrEqual(-0.5);
      expect(m!.right, `${key} #${i + 1} (${m!.cell}): clear of the scroller's right edge`).toBeGreaterThanOrEqual(-0.5);
    }
    // The walk crossed all eight holders on the 6061 row and came back to Ray.
    expect(visited.size).toBe(8);
    await expect(page.getByTestId(`risk-cell-${RAY}-t-mat-6061`)).toBeFocused();
  });
});
