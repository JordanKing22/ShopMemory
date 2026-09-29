// npm run test:e2e — seeds data/e2e.db, builds the production app, then runs Playwright.
// Extra CLI args pass through to `playwright test` (e.g. `npm run test:e2e -- routes-smoke --headed`).
// Playwright's webServer starts the built app on 127.0.0.1:3100 via `npm run test:e2e:server`.
import "./lib/telemetry-off.mts";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { childEnv } from "./lib/child-env.mts";
import { out } from "./lib/out";

const bin = (...p: string[]) => path.join(process.cwd(), "node_modules", ...p);
const tsx = bin("tsx", "dist", "cli.mjs");
const e2eEnv = childEnv({ FLOORWISE_DB: "e2e" }); // never touches data/floorwise.db

const steps: [string, string[], NodeJS.ProcessEnv][] = [
  ["seed data/e2e.db", [tsx, path.join("scripts", "seed.mts")], e2eEnv],
  ["next build", [tsx, path.join("scripts", "next.mts"), "build"], e2eEnv],
  ["playwright test", [bin("@playwright", "test", "cli.js"), "test", ...process.argv.slice(2)], childEnv()],
];

for (const [name, args, env] of steps) {
  out.line(`\n▶ ${name}`);
  const started = performance.now();
  const r = spawnSync(process.execPath, args, { stdio: "inherit", env });
  if (r.status !== 0) {
    out.error(`\n✗ ${name} failed.`);
    process.exit(r.status ?? 1);
  }
  out.line(`✓ ${name} (${Math.round(performance.now() - started)} ms)`);
}
