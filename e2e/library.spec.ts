/**
 * Knowledge Library (PLAN.md §8.3; demo steps 3 and 6): free-text search posts through a Server Action, so the
 * query never reaches a URL; "thin-wall Ti" finds Ray's KC-001. The card page shows the evidence quotes and the
 * "Contributed by Ray Delgado" credit.
 */
import { expect, test } from "@playwright/test";
import { waitForHydration } from "./helpers/app";

const QUERY = "thin-wall Ti";
/** The query in any URL spelling (raw, %20, +, encoded hyphen). */
const QUERY_IN_URL = /thin(-|%2d|%20|\+|\s)wall/i;

test("searching “thin-wall Ti” finds KC-001 without putting the query in any URL", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (r) => requested.push(r.url()));

  const res = await page.goto("/library");
  expect(res?.status()).toBe(200);
  await waitForHydration(page);

  const rows = page.locator('[data-testid^="card-result-"]');
  await expect(rows.first()).toBeVisible();
  const before = await rows.count();

  const search = page.getByTestId("library-search");
  await search.fill(QUERY);
  await search.press("Enter");

  await expect(page.getByTestId("card-result-KC-001")).toBeVisible();
  await expect.poll(() => rows.count(), { message: "the search narrows the list" }).toBeLessThan(before);
  await expect(page.getByTestId("card-result-KC-001")).toBeVisible();
  await expect(search).toHaveValue(QUERY);

  expect(decodeURIComponent(page.url())).not.toMatch(QUERY_IN_URL);
  expect(page.url()).not.toMatch(/[?&]q=/);
  expect(requested.filter((u) => QUERY_IN_URL.test(u) || QUERY_IN_URL.test(decodeURIComponent(u)))).toEqual([]);
});

test("a card page shows its evidence and credits the contributor", async ({ page }) => {
  const res = await page.goto("/library/KC-002");
  expect(res?.status()).toBe(200);
  await waitForHydration(page);

  const evidence = page.getByTestId("card-evidence");
  await expect(evidence).toBeVisible();
  await expect(evidence.locator("li").first()).toBeVisible();
  await expect(page.getByTestId("card-contributor")).toContainText("Ray Delgado");
});
