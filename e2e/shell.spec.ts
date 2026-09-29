/**
 * App shell (PLAN.md §9, §10, §13 Phase 2 exit criteria): no horizontal scroll at 1280/820/390, axe clean
 * (no serious/critical) including with the persona menu and the provider-badge panel open, no hydration or
 * console errors, and the persona switcher changes the server-side actor (Owner → Marv → Owner).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SIZES = [
  { name: "projector 1280×720", width: 1280, height: 720 },
  { name: "tablet 820", width: 820, height: 1180 },
  { name: "phone 390", width: 390, height: 844 },
] as const;

/** Nav destinations. A route that isn't built yet 404s on prefetch; only those prefetches are tolerated. */
const NAV_ROUTES = ["/risk", "/library", "/people", "/machines", "/jobs"];

async function seriousViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

/** Resolves once React has hydrated the persona switcher (menus only open after hydration). */
async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const el = document.querySelector('[aria-label*="Switch persona"]');
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactFiber"));
  });
}

const personaButton = (page: Page) => page.getByRole("button", { name: /Switch persona/ });

async function switchPersona(page: Page, item: RegExp, expected: RegExp): Promise<void> {
  await personaButton(page).click();
  await page.getByRole("menuitemradio", { name: item }).click();
  await expect(personaButton(page)).toHaveAttribute("aria-label", expected);
}

for (const size of SIZES) {
  test(`shell at ${size.name}`, async ({ page, request }) => {
    const missing = new Set<string>();
    for (const route of NAV_ROUTES) {
      const res = await request.get(route, { maxRedirects: 0 });
      if (res.status() === 404) missing.add(route);
    }
    if (missing.size > 0) test.info().annotations.push({ type: "pending-routes", description: [...missing].join(" ") });

    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.name}`));
    page.on("console", (m) => {
      if (m.type() !== "error" && m.type() !== "warning") return;
      const url = m.location()?.url ?? "";
      const path = url ? new URL(url).pathname : "";
      if (/status of 404/.test(m.text()) && url.includes("_rsc=") && missing.has(path)) return;
      problems.push(`${m.type()}: ${m.text().slice(0, 200)}`);
    });

    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/risk");
    await waitForHydration(page);

    await expect(page.locator("[data-fictional-banner]")).toBeVisible();
    await expect(page.locator("[data-provider-badge]")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    // PLAN.md §4.11: the header clearance dots are visible on tablets (768 px and up); phones move them to the panel.
    const dots = page.locator("[data-provider-badge] > ul");
    if (size.width >= 768) {
      await expect(dots).toBeVisible();
      await expect(dots.locator("li")).toHaveCount(4);
    } else {
      await expect(dots).toBeHidden();
    }
    await expectNoHorizontalScroll(page);
    expect(await seriousViolations(page)).toEqual([]);

    // Persona menu open: still axe clean and no sideways scroll.
    await personaButton(page).click();
    await expect(page.getByRole("menu")).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await expectNoHorizontalScroll(page);
    await page.keyboard.press("Escape");
    // Wait out the close animation: a click on the trigger while the old menu is still mounted is swallowed.
    await expect(page.getByRole("menu")).toHaveCount(0);

    // Owner → Marv (machinist); the choice survives a reload because the server re-reads the signed cookie.
    await switchPersona(page, /Marv Tollefson/, /Marv, Machinist/);
    await page.reload();
    await waitForHydration(page);
    await expect(personaButton(page)).toHaveAttribute("aria-label", /Marv, Machinist/);

    // Provider badge details: a named dialog, axe clean.
    await page.locator("[data-provider-badge] button").first().click();
    const details = page.getByRole("dialog", { name: "AI routing details" });
    await expect(details).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await expectNoHorizontalScroll(page);
    await page.keyboard.press("Escape");
    await expect(details).toHaveCount(0);

    // Back to the owner.
    await switchPersona(page, /Dana Whitcomb/, /Dana, Owner/);

    expect(problems).toEqual([]);
  });
}
