/**
 * Person profile (PLAN.md §9 /people/[id]; §10 tap targets). Every "Cards" link at the end of a topic row is at
 * least one tap target wide and tall: 44 px on a fine pointer, 48 px on a coarse one (the --tap token).
 * Regression: the links had a minimum height only and measured 39 px wide.
 */
import { expect, test, type Page } from "@playwright/test";
import { waitForHydration } from "./helpers/app";

const RAY_PROFILE = "/people/PER-01";

async function expectTopicLinksAreTapTargets(page: Page, pointer: "fine" | "coarse"): Promise<void> {
  await page.goto(RAY_PROFILE);
  await waitForHydration(page);
  // Guard the premise: hasTouch must make Chromium report a coarse pointer, or the 48 px run would only check 44 px.
  const coarse = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
  expect(coarse, `(pointer: coarse) matches in the ${pointer}-pointer run`).toBe(pointer === "coarse");
  const min = coarse ? 48 : 44;
  const links = page.locator('[data-testid^="person-topic-"] a');
  const count = await links.count();
  expect(count, "Ray's profile has topic 'Cards' links").toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    await link.scrollIntoViewIfNeeded();
    const box = await link.boundingBox();
    expect(box, `topic link ${i}: has a box`).not.toBeNull();
    expect(box!.width, `topic link ${i}: width`).toBeGreaterThanOrEqual(min);
    expect(box!.height, `topic link ${i}: height`).toBeGreaterThanOrEqual(min);
  }
}

test("person profile: every topic 'Cards' link is at least 44×44 px on a fine pointer", async ({ page }) => {
  await expectTopicLinksAreTapTargets(page, "fine");
});

test.describe("coarse pointer", () => {
  test.use({ hasTouch: true });

  test("person profile: every topic 'Cards' link is at least one tap target (48 px when coarse)", async ({ page }) => {
    await expectTopicLinksAreTapTargets(page, "coarse");
  });
});
