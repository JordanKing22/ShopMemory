// npm run dev / build / start — runs the Next.js CLI with telemetry disabled. Doesn't pre-load .env files:
// Next.js loads the right ones for dev and production itself.
import "./lib/telemetry-off.mts";
import { spawn } from "node:child_process";
import path from "node:path";

const bin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [bin, ...process.argv.slice(2)], { stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
