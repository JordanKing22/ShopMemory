// npm run check — the pre-commit gate: route types, ESLint, TypeScript, Vitest, then seed:check.
// Runs each tool through `node <bin>` so it works the same under cmd.exe, PowerShell and bash.
import "./lib/load-env.mts";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { out } from "./lib/out";

const bin = (...p: string[]) => path.join(process.cwd(), "node_modules", ...p);
const steps: [string, string[]][] = [
  ["next typegen", [bin("next", "dist", "bin", "next"), "typegen"]],
  ["eslint", [bin("eslint", "bin", "eslint.js"), "--max-warnings=0"]],
  ["tsc", [bin("typescript", "bin", "tsc"), "--noEmit"]],
  ["vitest", [bin("vitest", "vitest.mjs"), "run"]],
  ["seed:check", [bin("tsx", "dist", "cli.mjs"), path.join("scripts", "seed-check.mts")]],
];

for (const [name, args] of steps) {
  out.line(`\n▶ ${name}`);
  const started = performance.now();
  const r = spawnSync(process.execPath, args, { stdio: "inherit" }); // inherits NEXT_TELEMETRY_DISABLED from load-env
  if (r.status !== 0) {
    out.error(`\n✗ ${name} failed.`);
    process.exit(r.status ?? 1);
  }
  out.line(`✓ ${name} (${Math.round(performance.now() - started)} ms)`);
}
out.line("\nAll checks passed.");
