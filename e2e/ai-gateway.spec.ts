/**
 * Phase 3 (PLAN.md §13): the Settings test prompt runs through the real gateway in DEMO_MODE and writes a tokenized
 * REPLAY audit row; the owner sees every row, other personas their own; Reveal resolves only the row's own tokens;
 * export works per role; switching to Local changes the header and the destination. No egress (see no-egress.spec.ts).
 */
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { switchPersona, waitForHydration } from "./helpers/app";

const TOKEN = /\[\[PERSON_[0-9A-Z]{4}\]\]/;

async function sendTestPrompt(page: Page) {
  await page.goto("/settings");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Send test prompt" }).click();
  await expect(page.getByTestId("test-prompt-done")).toBeVisible({ timeout: 15_000 });
}

async function setMode(page: Page, mode: "Cloud" | "Local") {
  await page.goto("/settings");
  await waitForHydration(page);
  const form = page.getByTestId("routing-form");
  const radio = form.getByRole("radio", { name: new RegExp(`^${mode}\\b`) });
  if (await radio.isChecked()) return;
  await radio.check();
  await form.getByRole("button", { name: "Save routing" }).click();
  await expect(page.locator("[data-provider-badge] [data-mode]")).toHaveAttribute("data-mode", mode.toLowerCase(), { timeout: 15_000 });
}

test.describe("AI gateway: Settings test prompt and the audit log", () => {
  test("Owner: a REPLAY row with the name tokenized; Reveal shows it to the owner", async ({ page }) => {
    await sendTestPrompt(page);
    const route = page.getByTestId("test-prompt-route");
    await expect(route).toContainText("Anthropic API · claude-sonnet-5-5");
    await expect(route).toContainText("REPLAY · scripted (not model output)");
    await expect(page.getByTestId("test-prompt-answer")).toHaveText("Received. This short reply confirms the connectivity check came through.");

    await page.getByTestId("test-prompt-done").getByRole("link").click();
    const detail = page.getByTestId("audit-detail");
    await expect(detail).toBeVisible();
    const payload = page.getByTestId("audit-payload");
    await expect(payload).toContainText(TOKEN);
    await expect(payload).not.toContainText("Dana");
    await expect(payload).not.toContainText("Whitcomb");
    await detail.getByRole("button", { name: /^Reveal 1 token$/ }).click();
    await expect(page.getByTestId("audit-reveal")).toContainText("Dana Whitcomb");
  });

  test("Maya sees only her own rows, can reveal and export them; the owner's rows stay out", async ({ page }) => {
    await page.goto("/settings");
    await switchPersona(page, "Maya Chen");
    await sendTestPrompt(page);
    await page.goto("/audit");
    await waitForHydration(page);
    await expect(page.getByTestId("audit-count")).toContainText("your own calls");
    const rows = page.getByTestId("audit-rows").locator("li");
    expect(await rows.count()).toBeGreaterThan(0);
    for (const t of await rows.allInnerTexts()) expect(t).toContain("Maya Chen");

    await rows.first().getByRole("button").click();
    await page.getByTestId("audit-detail").getByRole("button", { name: /^Reveal \d+ tokens?$/ }).click();
    await expect(page.getByTestId("audit-reveal")).toContainText("Maya Chen");
    await page.keyboard.press("Escape");

    const download = page.waitForEvent("download");
    await page.getByTestId("audit-export-csv").click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^floorwise-audit-[a-z-]+-\d{8}\.csv$/);
    const csv = fs.readFileSync((await file.path())!, "utf8");
    expect(csv.split("\r\n")[0]).toContain("request_payload_redacted");
    expect(csv).toMatch(TOKEN);
    for (const name of ["Maya Chen", "Dana Whitcomb", "Aerovance"]) expect(csv).not.toContain(name);
    expect(csv).not.toContain("P-OWNER");
  });

  test("Owner: searching a customer name finds its tokenized rows (the seeded examples)", async ({ page }) => {
    await page.goto("/audit");
    await waitForHydration(page);
    await expect(page.getByTestId("audit-count")).toContainText("every persona's calls");
    await page.getByLabel(/Search text/).fill("Aerovance");
    await page.getByRole("button", { name: "Apply filters" }).click();
    const rows = page.getByTestId("audit-rows").locator("li");
    await expect(rows.first()).toBeVisible();
    await expect(rows.first()).toContainText("Seeded example (fictional)");
    expect(page.url()).not.toContain("Aerovance");
  });

  test("Local mode: the header and the destination change; Bedrock without configuration is disabled with the reason", async ({ page }) => {
    try {
      await setMode(page, "Local");
      await expect(page.locator("[data-provider-badge]")).toContainText("Ollama");
      await expect(page.getByTestId("routing-form").getByRole("radio", { name: /Amazon Bedrock/ })).toBeDisabled();
      await expect(page.getByTestId("routing-form")).toContainText("AWS_REGION and BEDROCK_MODEL_ID");
      await page.getByRole("button", { name: "Send test prompt" }).click();
      await expect(page.getByTestId("test-prompt-route")).toContainText("Ollama · qwen3.5:4b · this computer (not contacted: replay)", { timeout: 15_000 });
      await expect(page.getByTestId("test-prompt-answer")).toHaveText("Received. The local model confirms the connectivity check.");
    } finally {
      await setMode(page, "Cloud");
    }
  });
});
