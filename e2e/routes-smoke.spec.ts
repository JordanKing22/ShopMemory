/**
 * routes-smoke (PLAN.md §12; §13 Phase 2 exit criteria): every Phase 2 route at 1280×720, 820 and 390 px returns
 * 200, logs no console error or hydration warning, has no horizontal page scroll and is axe clean (no serious or
 * critical violation). One browser context per width; each route is one navigation in it.
 */
import { expect, test } from "@playwright/test";
import { PRINT_ROUTES, ROUTES, VIEWPORTS, collectConsoleErrors, horizontalOverflow, runAxe, settle } from "./helpers/app";

const ALL_ROUTES = [...ROUTES, ...PRINT_ROUTES];

for (const vp of VIEWPORTS) {
  test(`every route at ${vp.name}`, async ({ page }) => {
    test.setTimeout(60_000 + ALL_ROUTES.length * 20_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const errors = collectConsoleErrors(page);

    for (const route of ALL_ROUTES) {
      await test.step(route, async () => {
        errors.take();
        const res = await page.goto(route);
        expect.soft(res?.status(), `${route}: HTTP status`).toBe(200);
        await settle(page);
        await expect.soft(page.locator("[data-fictional-banner]"), `${route}: fictional banner`).toBeVisible();
        await expect.soft(page.getByRole("heading", { level: 1 }), `${route}: exactly one h1`).toHaveCount(1);
        expect.soft(await horizontalOverflow(page), `${route}: horizontal page scroll at ${vp.width}px`).toBeNull();
        expect.soft(await runAxe(page), `${route}: axe serious/critical violations`).toEqual([]);
        expect.soft(errors.take(), `${route}: console errors / hydration warnings`).toEqual([]);
      });
    }
  });
}
