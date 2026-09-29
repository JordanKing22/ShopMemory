// npm run test:e2e:server — starts the already-built production app on 127.0.0.1:3100 against data/e2e.db.
// Playwright's webServer runs this; it builds nothing itself (npm run test:e2e seeds and builds first).
import "./lib/telemetry-off.mts";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { childEnv } from "./lib/child-env.mts";
import { out } from "./lib/out";

if (!fs.existsSync(path.join(process.cwd(), "data", "e2e.db"))) {
  out.error("data/e2e.db is missing. Run npm run test:e2e (it seeds and builds before starting Playwright).");
  process.exit(1);
}

const next = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
// TZ is deliberately non-UTC, west of UTC, and different from the browser's timezoneId (Asia/Tokyo, playwright.config.ts).
// Server-rendered local-time dates slip a day, so the date checks in the specs catch them, and client components that
// format in local time cause hydration mismatches (PLAN.md §12).
const env = childEnv({ FLOORWISE_DB: "e2e", TZ: "America/Chicago" });
const child = spawn(process.execPath, [next, "start", "-p", "3100", "-H", "127.0.0.1"], { stdio: "inherit", env });
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
