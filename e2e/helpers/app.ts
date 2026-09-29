/**
 * Shared Playwright helpers for the Phase 2 specs (PLAN.md §12, §13 Phase 2 exit criteria).
 *
 * - ROUTES / PRINT_ROUTES / VIEWPORTS: what routes-smoke walks.
 * - waitForHydration(): resolves once React has hydrated the page (menus and toggles only work after that).
 * - switchPersona(): drives the header persona switcher like a presenter would (the server re-reads the role).
 * - expectNoHorizontalScroll(), runAxe() / expectAxeClean(), collectConsoleErrors(): the per-page quality gates.
 *
 * Nothing here writes page content to disk or the console (CLAUDE.md hard rule 2): failures carry short, trimmed
 * messages only.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

/** App routes smoke-tested at every width (one record per detail kind, plus the demo's anchors). */
export const ROUTES = [
  "/risk",
  "/library",
  "/library/KC-001",
  "/library/KC-026",
  "/people",
  "/people/PER-01",
  "/machines",
  "/machines/m-dmu50",
  "/jobs",
  "/jobs/J-A03",
  "/jobs/Q-A01",
  "/jobs/J-A10",
] as const;

/** Print views (the (print) route group: no app shell). */
export const PRINT_ROUTES = ["/machines/m-dmu50/print", "/machines/labels"] as const;

/** PLAN.md §10: projector (1280×720 CSS px), tablet (820) and phone (390). */
export const VIEWPORTS = [
  { name: "projector 1280×720", width: 1280, height: 720 },
  { name: "tablet 820", width: 820, height: 1180 },
  { name: "phone 390", width: 390, height: 844 },
] as const;

// ---------------------------------------------------------------------------------------------------------------
// Hydration and settling
// ---------------------------------------------------------------------------------------------------------------

const PERSONA_TRIGGER = '[aria-label*="Switch persona"]';

/**
 * Resolves once React has hydrated the page: `#main` (both the app shell and the print layout render it) and, when
 * present, the persona switcher carry React's internal fiber key. Menus and toggles ignore clicks before that.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction((personaSelector) => {
    const hydrated = (el: Element | null) => !!el && Object.keys(el).some((k) => k.startsWith("__reactFiber"));
    const main = document.getElementById("main");
    if (!hydrated(main)) return false;
    const persona = document.querySelector(personaSelector);
    return persona === null || hydrated(persona);
  }, PERSONA_TRIGGER);
}

/**
 * Waits for a page to be ready for layout and a11y checks: hydrated, fonts loaded, and the network quiet (so late
 * console errors such as a 404 prefetch or a hydration error are caught). A busy network past 10 s is not a failure.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("load");
  await waitForHydration(page);
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------------------------
// Personas (seed-data/personas.yaml)
// ---------------------------------------------------------------------------------------------------------------

/** Switcher entries by full name → the trigger's "Persona: {first}, {Role}." label. */
export const PERSONAS = {
  "Dana Whitcomb": { first: "Dana", role: "Owner" },
  "Ray Delgado": { first: "Ray", role: "Quoter" },
  "Maya Chen": { first: "Maya", role: "Quoter" },
  "Marv Tollefson": { first: "Marv", role: "Machinist" },
  "Devin Okafor": { first: "Devin", role: "Trainee" },
} as const;
export type PersonaName = keyof typeof PERSONAS;

/** "Hidden for Machinist role" for a persona (the HiddenField pill text). */
export function hiddenLabelFor(name: PersonaName): string {
  return `Hidden for ${PERSONAS[name].role} role`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function personaButton(page: Page): Locator {
  return page.getByRole("button", { name: /Switch persona/ });
}

/**
 * Switches the active persona through the header menu ("Act as…") and waits until the server-rendered shell shows
 * it (the switcher's label comes from the refreshed RSC payload, so the page below has re-rendered for that role).
 * A no-op when the persona is already active.
 */
export async function switchPersona(page: Page, name: PersonaName): Promise<void> {
  const { first, role } = PERSONAS[name];
  const expected = new RegExp(`^Persona: ${escapeRegExp(first)}, ${role}\\.`);
  await waitForHydration(page);
  const button = personaButton(page);
  await expect(button).toBeVisible();
  if (expected.test((await button.getAttribute("aria-label")) ?? "")) return;
  // A click on the trigger while a previous menu is still animating closed is swallowed.
  await expect(page.getByRole("menu")).toHaveCount(0);
  await button.click();
  await page.getByRole("menuitemradio", { name: new RegExp(`^${escapeRegExp(name)}\\b`) }).click();
  await expect(button).toHaveAttribute("aria-label", expected, { timeout: 15_000 });
  await expect(button).not.toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("menu")).toHaveCount(0);
}

// ---------------------------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------------------------

export interface HorizontalOverflow {
  scrollWidth: number;
  clientWidth: number;
  /** Up to five elements whose right edge passes the viewport (debugging aid). */
  offenders: string[];
}

/** Null when the page has no horizontal scroll; otherwise the widths and the widest offenders. */
export async function horizontalOverflow(page: Page): Promise<HorizontalOverflow | null> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const scrollWidth = Math.max(root.scrollWidth, document.body.scrollWidth);
    const clientWidth = root.clientWidth;
    if (scrollWidth <= clientWidth) return null;
    const describe = (el: Element) => {
      const id = el.id ? `#${el.id}` : "";
      const testId = el.getAttribute("data-testid");
      const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
      return `${el.tagName.toLowerCase()}${id}${testId ? `[data-testid=${testId}]` : ""}${cls ? `.${cls}` : ""}`;
    };
    const offenders: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (offenders.length >= 5) break;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > clientWidth + 1) offenders.push(`${describe(el)} (right ${Math.round(r.right)})`);
    }
    return { scrollWidth, clientWidth, offenders };
  });
}

/** Fails when the page scrolls sideways (inner scroll containers, like the heat map's card, are fine). */
export async function expectNoHorizontalScroll(page: Page, label = page.url()): Promise<void> {
  expect(await horizontalOverflow(page), `${label}: horizontal page scroll`).toBeNull();
}

/** Asserts that a locator's box lies fully inside the current viewport (no scrolling needed to see it). */
export async function expectInViewport(page: Page, locator: Locator, label: string): Promise<void> {
  const box = await locator.boundingBox();
  const vp = page.viewportSize();
  expect(box, `${label}: has a box`).not.toBeNull();
  expect(vp, "viewport size").not.toBeNull();
  const b = box!;
  expect(b.y, `${label}: top edge inside the viewport`).toBeGreaterThanOrEqual(0);
  expect(b.y + b.height, `${label}: bottom edge inside the ${vp!.height}px viewport`).toBeLessThanOrEqual(vp!.height);
  expect(b.x, `${label}: left edge inside the viewport`).toBeGreaterThanOrEqual(0);
}

// ---------------------------------------------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------------------------------------------

/** axe-core violations with impact serious or critical, as "rule: target, target" strings (empty = clean). */
export async function runAxe(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 5).map((n) => n.target.join(" ")).join(", ")}`);
}

export async function expectAxeClean(page: Page, label = page.url()): Promise<void> {
  expect(await runAxe(page), `${label}: axe serious/critical violations`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------------------------------------------------

const HYDRATION = /hydrat|did not match|server rendered (html|text)|Minified React error #(418|419|421|422|423|425)/i;

export interface ConsoleErrors {
  /** Everything collected since the last take(), then clears the list. */
  take(): string[];
  /** Everything collected so far (does not clear). */
  peek(): string[];
}

/**
 * Collects uncaught page errors, console errors and hydration warnings for a page. Call take() per route and expect
 * it to be empty. Messages are trimmed; nothing is written anywhere.
 */
export function collectConsoleErrors(page: Page): ConsoleErrors {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.name}: ${e.message.slice(0, 160)}`));
  page.on("console", (m) => {
    const type = m.type();
    if (type !== "error" && type !== "warning") return;
    const text = m.text();
    if (type === "warning" && !HYDRATION.test(text)) return;
    const where = m.location()?.url ? ` @ ${new URL(m.location().url).pathname}` : "";
    problems.push(`console.${type}: ${text.slice(0, 200)}${where}`);
  });
  return {
    take: () => problems.splice(0, problems.length),
    peek: () => [...problems],
  };
}
