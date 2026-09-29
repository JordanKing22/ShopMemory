// Playwright E2E config (PLAN.md §12). Run with `npm run test:e2e`, which seeds data/e2e.db and builds first;
// the webServer below only starts the built app on 127.0.0.1:3100 against data/e2e.db.
import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * PW_CHROMIUM_PATH points at a pre-installed Chromium when the Playwright CDN is blocked (e.g. the cloud container:
 * /opt/pw-browsers/chromium-1194). It may name the executable or a Playwright browser folder. Config files may read
 * process.env (CLAUDE.md hard rule 3). Unset → Playwright's own browser (`npx playwright install chromium`).
 */
function chromiumExecutable(): string | undefined {
  const p = process.env.PW_CHROMIUM_PATH?.trim();
  if (!p) return undefined;
  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) return p;
  const candidates = [
    ["chrome-linux64", "chrome"],
    ["chrome-linux", "chrome"],
    ["chrome-win64", "chrome.exe"],
    ["chrome-win", "chrome.exe"],
    ["chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"],
    ["chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"],
    ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
  ].map((parts) => path.join(p, ...parts));
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error(`PW_CHROMIUM_PATH (${p}) contains no Chromium executable.`);
  return found;
}

const executablePath = chromiumExecutable();

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    // Deliberately non-UTC so tests catch dates formatted without timeZone: 'UTC' (PLAN.md §12).
    timezoneId: "America/Chicago",
    locale: "en-US",
    // No traces/videos: they would write page and AI stream content to disk (CLAUDE.md hard rule 2).
    trace: "off",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ...(executablePath ? { launchOptions: { executablePath } } : {}) },
    },
  ],
  webServer: {
    command: "npm run test:e2e:server",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
