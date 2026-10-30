/**
 * Runs last (file order): the app server ran with the no-egress preload (scripts/e2e-server.mts). Any attempt to reach a
 * non-loopback host — or Ollama's port while replaying — was logged to data/e2e-egress.log. The whole run must leave it
 * empty (PLAN.md §12).
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("the app server made no outbound connection during the E2E run", () => {
  const log = path.join(process.cwd(), "data", "e2e-egress.log");
  expect(fs.existsSync(log)).toBe(true);
  const attempts = fs.readFileSync(log, "utf8").split("\n").filter(Boolean);
  expect(attempts).toEqual([]);
});
