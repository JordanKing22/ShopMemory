/**
 * Persona gate end to end (PLAN.md §4.8; docs/DATA-LAYER.md rule 2): the owner sees J-A03's prices and outcome;
 * after switching to Marv (machinist) and Devin (trainee) each field is the visible "Hidden for {Role} role" pill,
 * and neither the HTML, the page's RSC flight data nor any response the browser received contains the owner's price
 * figures or Ray's planned departure date. A hidden value must not exist in the payload at all, not just be hidden.
 */
import { expect, test, type Page, type Response } from "@playwright/test";
import { hiddenLabelFor, switchPersona, waitForHydration, type PersonaName } from "./helpers/app";

const JOB = "/jobs/J-A03";
const RAY_PROFILE = "/people/PER-01";
const PRICE_FIELDS = ["price-unit", "price-total", "price-margin"] as const;
/** Ray's planned departure (seed-data/demo/anchors.yaml pins it) in every form a page could print it. */
const RAY_DEPARTURE = ["2028-05-15", "May 15, 2028", "May 15 2028", "2028-05"];

/** "$7,019.23" → ["7,019.23", "7019.23"]; figures under four digits (a 22 % margin) are too common to scan for. */
function priceNeedles(texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    for (const token of t.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
      if (token.replace(/\D/g, "").length < 4) continue;
      out.add(token);
      out.add(token.replace(/,/g, ""));
    }
  }
  return [...out];
}

/** Records the bodies of every same-origin HTML / RSC / JSON response while attached. */
function recordResponses(page: Page) {
  const bodies: Promise<{ url: string; body: string }>[] = [];
  const onResponse = (r: Response) => {
    const url = new URL(r.url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return;
    const type = r.headers()["content-type"] ?? "";
    if (!/text\/html|text\/x-component|application\/json|text\/plain/.test(type)) return;
    bodies.push(
      r
        .text()
        .then((body) => ({ url: url.pathname + url.search, body }))
        .catch(() => ({ url: url.pathname, body: "" })),
    );
  };
  page.on("response", onResponse);
  return {
    stop: async () => {
      page.off("response", onResponse);
      return Promise.all(bodies);
    },
  };
}

/** The route's RSC flight payload for the current persona (same cookies as the page). */
async function fetchFlight(page: Page, route: string): Promise<string> {
  // `?_rsc` with an empty hash matches a request that sends no router-state headers (Next's cache-busting check).
  const res = await page.request.get(`${route}?_rsc`, { headers: { RSC: "1" } });
  expect(res.status(), `${route} RSC status`).toBe(200);
  expect(res.headers()["content-type"] ?? "", `${route} RSC content type`).toContain("text/x-component");
  return res.text();
}

function expectAbsent(haystacks: { where: string; text: string }[], needles: string[], what: string): void {
  const hits: string[] = [];
  for (const { where, text } of haystacks) for (const n of needles) if (text.includes(n)) hits.push(`${where} contains ${what} "${n}"`);
  expect(hits).toEqual([]);
}

async function expectHiddenJob(page: Page, persona: PersonaName, ownerNeedles: string[]): Promise<void> {
  const label = hiddenLabelFor(persona);
  const recorder = recordResponses(page);

  const nav = await page.goto(JOB);
  expect(nav?.status()).toBe(200);
  await waitForHydration(page);
  await expect(page.getByTestId("job-financials")).toBeVisible();
  for (const id of PRICE_FIELDS) await expect(page.getByTestId(id), `${id} as ${persona}`).toContainText(label);
  await expect(page.getByTestId("quote-outcome")).toContainText(label);
  // Quoted vs actual hours stay visible to every role.
  await expect(page.getByTestId("hours-bar")).toBeVisible();
  expect(await page.locator("main").innerText(), `no dollar amount on ${JOB} as ${persona}`).not.toMatch(/\$\s?\d/);

  const html = await nav!.text();
  const dom = await page.content();
  const flight = await fetchFlight(page, JOB);
  const responses = await recorder.stop();
  expectAbsent(
    [
      { where: `${JOB} HTML`, text: html },
      { where: `${JOB} DOM`, text: dom },
      { where: `${JOB} RSC`, text: flight },
      ...responses.map((r) => ({ where: `response ${r.url}`, text: r.body })),
    ],
    ownerNeedles,
    "an owner price",
  );
}

async function expectHiddenDeparture(page: Page, persona: PersonaName): Promise<void> {
  const nav = await page.goto(RAY_PROFILE);
  expect(nav?.status()).toBe(200);
  await waitForHydration(page);
  await expect(page.getByTestId("person-departure").first()).toContainText(hiddenLabelFor(persona));
  const html = await nav!.text();
  const flight = await fetchFlight(page, RAY_PROFILE);
  expectAbsent(
    [
      { where: `${RAY_PROFILE} HTML`, text: html },
      { where: `${RAY_PROFILE} DOM`, text: await page.content() },
      { where: `${RAY_PROFILE} RSC`, text: flight },
    ],
    RAY_DEPARTURE,
    "Ray's planned departure",
  );
  expect(await page.locator("main").innerText()).not.toMatch(/\bretir(es|ing)\s+in\s+\d/i);
  // The same pill on the people list.
  await page.goto("/people");
  await waitForHydration(page);
  await expect(page.getByTestId("person-row-PER-01").getByTestId("person-departure")).toContainText(hiddenLabelFor(persona));
}

test("prices, outcome and departure are hidden from Marv and Devin, down to the RSC payload", async ({ page }) => {
  test.setTimeout(120_000);

  // Owner: capture what the gated fields show.
  await page.goto(JOB);
  await switchPersona(page, "Dana Whitcomb");
  await expect(page.getByTestId("job-financials")).toBeVisible();
  const ownerTexts: string[] = [];
  for (const id of PRICE_FIELDS) {
    const field = page.getByTestId(id);
    await expect(field).not.toContainText("Hidden for");
    await expect(field).toContainText(/\d/);
    ownerTexts.push(await field.innerText());
  }
  await expect(page.getByTestId("price-unit")).toContainText(/\$\s?[\d,]+\.\d{2}/);
  await expect(page.getByTestId("quote-outcome")).not.toContainText("Hidden for");
  await expect(page.getByTestId("quote-outcome")).toContainText(/won/i);
  const needles = priceNeedles(ownerTexts);
  expect(needles.length, "owner price figures to scan for").toBeGreaterThanOrEqual(2);
  // Positive control: the owner's own payload does carry them.
  expect(await fetchFlight(page, JOB)).toContain(needles.find((n) => !n.includes(","))!);

  await page.goto(RAY_PROFILE);
  await waitForHydration(page);
  await expect(page.getByTestId("person-departure").first()).toContainText("May 15, 2028");
  // Positive control: the owner's own payload carries the date (the page renders it server-side, so the RSC holds
  // the formatted text rather than the ISO value).
  const ownerProfileFlight = await fetchFlight(page, RAY_PROFILE);
  expect(RAY_DEPARTURE.filter((n) => ownerProfileFlight.includes(n)), "Ray's departure in the owner's RSC").not.toEqual([]);

  // Marv (machinist), then Devin (trainee): same pills, no values anywhere.
  for (const persona of ["Marv Tollefson", "Devin Okafor"] as const) {
    await page.goto(JOB);
    await switchPersona(page, persona);
    await expectHiddenJob(page, persona, needles);
    await expectHiddenDeparture(page, persona);
  }

  // Back to the owner: the values return.
  await page.goto(JOB);
  await switchPersona(page, "Dana Whitcomb");
  for (const id of PRICE_FIELDS) await expect(page.getByTestId(id)).not.toContainText("Hidden for");
  await expect(page.getByTestId("price-unit")).toHaveText(ownerTexts[0]);
});
