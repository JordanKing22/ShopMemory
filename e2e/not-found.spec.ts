/**
 * Not-found boundaries (PLAN.md §9; CLAUDE.md UI conventions): a bad record ID renders "Record not found" INSIDE
 * the shell, so the header keeps the mode, provider badge and nav; an unmatched URL gets the root 404, which
 * carries its own fictional banner. Both are axe clean.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function seriousViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

/** Every detail route with a bad ID (Phase 2 builds all four). */
const DETAIL_ROUTES = [
  { list: "/library", bad: "/library/KC-999" },
  { list: "/jobs", bad: "/jobs/RJ-00-0000" },
  { list: "/people", bad: "/people/PER-99" },
  { list: "/machines", bad: "/machines/m-no-such-machine" },
];

for (const r of DETAIL_ROUTES) {
  test(`a bad record ID (${r.bad}) renders Record not found inside the app shell`, async ({ page, request }) => {
    const built = (await request.get(r.list, { maxRedirects: 0 })).status() === 200;
    test.skip(!built, `${r.list} is not built yet.`);

    const res = await page.goto(r.bad);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Record not found" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.locator("[data-provider-badge]")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
    await expect(page.locator("[data-fictional-banner]")).toHaveCount(1);
    expect(await seriousViolations(page)).toEqual([]);
  });
}

test("an unmatched URL renders the root 404 with the fictional banner", async ({ page }) => {
  const res = await page.goto("/no-such-page-in-the-demo");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.locator("[data-fictional-banner]")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});
