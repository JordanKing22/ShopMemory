/**
 * Architecture rules from CLAUDE.md, enforced by scanning the source tree. Phase 1 skeleton: rules for modules
 * that don't exist yet (providers, tasks, route handlers) pass vacuously and start biting when those land.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function filesUnder(dir: string, exts = [".ts", ".tsx", ".mts", ".mjs", ".js"]): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (exts.includes(path.extname(e.name))) out.push(path.relative(ROOT, p).split(path.sep).join("/"));
    }
  };
  walk(abs);
  return out.sort();
}

const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
/** Source without comments, so rules match code rather than prose about the rule. */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const APP = [...filesUnder("src"), ...filesUnder("scripts")];

function offenders(files: string[], pattern: RegExp, allowed: (f: string) => boolean = () => false): string[] {
  return files.filter((f) => !allowed(f) && pattern.test(code(f)));
}

describe("architecture rules", () => {
  it("only src/lib/env.ts reads process.env (telemetry-off.mts only sets telemetry off; child-env.mts only copies it for child processes)", () => {
    const allowed = ["src/lib/env.ts", "scripts/lib/telemetry-off.mts", "scripts/lib/child-env.mts"];
    expect(offenders(APP, /process\.env/, (f) => allowed.includes(f))).toEqual([]);
    expect(code("scripts/lib/telemetry-off.mts").match(/process\.env\.[A-Z_]+/g)).toEqual(["process.env.NEXT_TELEMETRY_DISABLED"]);
    expect(code("scripts/lib/child-env.mts").match(/process\.env\S*/g)).toEqual(["process.env,"]);
  });

  it("every npm script that runs Next.js goes through the telemetry-off wrapper", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    for (const [name, s] of Object.entries(pkg.scripts)) expect(s, name).not.toMatch(/^next\b/);
  });

  it("deterministic modules never sort with locale rules", () => {
    const files = [...filesUnder("src/lib/seed"), ...filesUnder("src/lib/coverage"), ...filesUnder("src/lib/retrieval"), ...filesUnder("src/db")];
    expect(offenders(files, /\.localeCompare\(/)).toEqual([]);
  });

  it("only src/lib/log.ts and scripts/lib/out.ts write to the console", () => {
    expect(offenders(APP, /\bconsole\.(log|info|warn|error|debug|trace)\b/, (f) => f === "src/lib/log.ts" || f === "scripts/lib/out.ts")).toEqual([]);
  });

  it("provider SDKs are imported only inside src/lib/ai/providers/", () => {
    const sdk = /from\s+["'](@anthropic-ai\/(sdk|bedrock-sdk)|@aws-sdk\/[^"']+)["']|require\(\s*["'](@anthropic-ai|@aws-sdk)/;
    expect(offenders(APP, sdk, (f) => f.startsWith("src/lib/ai/providers/"))).toEqual([]);
  });

  it("no telemetry or exporter libraries, and no onRequestError hook", () => {
    expect(offenders(APP, /from\s+["'](@opentelemetry|@sentry)\//)).toEqual([]);
    expect(offenders(APP, /\bonRequestError\b/)).toEqual([]);
  });

  it("server-only is never imported by src/db or the pure lib modules (it throws under tsx)", () => {
    const pure = [...filesUnder("src/db"), ...filesUnder("src/lib")];
    expect(offenders(pure, /["']server-only["']/)).toEqual([]);
  });

  it("task prompt builders never import the database or the data layer", () => {
    expect(offenders(filesUnder("src/lib/ai/tasks"), /from\s+["']@\/(db|lib\/data)(\/|["'])/)).toEqual([]);
  });

  it("seed, coverage, retrieval, interview, policy and classification code is deterministic", () => {
    const deterministic = [
      ...filesUnder("src/lib/seed"),
      ...filesUnder("src/lib/coverage"),
      ...filesUnder("src/lib/retrieval"),
      ...filesUnder("src/lib/interview"),
      ...filesUnder("src/lib/policy"),
      "src/db/classification.ts",
      "src/db/reset.ts",
    ];
    expect(offenders(deterministic, /Math\.random\(|Date\.now\(|new Date\(\)/)).toEqual([]);
  });

  it("nothing provider-related uses a NEXT_PUBLIC_ variable", () => {
    expect(offenders(APP, /NEXT_PUBLIC_[A-Z_]*(ANTHROPIC|BEDROCK|AWS|OLLAMA|LLM|MODEL|AI_)/)).toEqual([]);
  });

  it("never sets OLLAMA_DEBUG_LOG_REQUESTS", () => {
    expect(offenders(APP, /OLLAMA_DEBUG_LOG_REQUESTS\s*[:=]/)).toEqual([]);
  });

  it("the DB path is one of two static literals", () => {
    const client = code("src/db/client.ts");
    expect(client).toMatch(/path\.join\(process\.cwd\(\), "data", "floorwise\.db"\)/);
    expect(client).toMatch(/path\.join\(process\.cwd\(\), "data", "e2e\.db"\)/);
  });

  it("dependencies are pinned exactly and no script uses drizzle-kit push", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string>; scripts: Record<string, string> };
    for (const [name, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) expect(v, name).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.dependencies["better-sqlite3"]).toMatch(/^12\./);
    for (const s of Object.values(pkg.scripts)) expect(s).not.toMatch(/drizzle-kit push/);
  });

  it("the dev and start servers bind to 127.0.0.1 (LAN access only through serve-https with DEMO_PIN)", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    // Next's CLI defaults to 0.0.0.0 (every interface) when -H is missing.
    for (const name of ["dev", "start"]) expect(pkg.scripts[name], name).toMatch(/\s-H 127\.0\.0\.1(\s|$)/);
    expect(code("scripts/e2e-server.mts")).toMatch(/"-H", "127\.0\.0\.1"/);
  });

  it("error boundaries exist above the app layout and never show or log error.message", () => {
    const boundaries = ["src/app/error.tsx", "src/app/global-error.tsx", "src/app/(app)/error.tsx"];
    for (const f of boundaries) {
      expect(fs.existsSync(path.join(ROOT, f)), f).toBe(true);
      expect(read(f).trimStart(), f).toMatch(/^"use client";/);
      expect(code(f), f).not.toMatch(/\.message\b/);
      expect(code(f), f).not.toMatch(/\bconsole\./);
    }
    // (app)/error.tsx doesn't wrap (app)/layout.tsx: the root boundaries render outside the shell, so they
    // carry the fictional banner themselves (hard rule 10).
    for (const f of ["src/app/error.tsx", "src/app/global-error.tsx"]) expect(code(f), f).toMatch(/<FictionalBanner\b/);
    // global-error replaces the root layout: it brings its own document, styles and light theme.
    const g = code("src/app/global-error.tsx");
    expect(g).toMatch(/<html lang="en"/);
    expect(g).toMatch(/<body\b/);
    expect(g).toMatch(/import "\.\/globals\.css"/);
    expect(g).toMatch(/colorScheme: "light"/);
    expect(code("src/components/app/error-fallback.tsx")).not.toMatch(/\.message\b|\bconsole\./);
  });

  it("notFound() in app pages renders inside the shell (no DB reads, no second banner)", () => {
    const f = "src/app/(app)/not-found.tsx";
    expect(fs.existsSync(path.join(ROOT, f))).toBe(true);
    expect(code(f)).not.toMatch(/from\s+["']@\/(db|server|lib\/data)(\/|["'])/);
    expect(code(f)).not.toMatch(/FictionalBanner/);
    expect(code(f)).toMatch(/Record not found/);
    // The root 404 is for unmatched URLs only and keeps its own banner.
    expect(code("src/app/not-found.tsx")).toMatch(/<FictionalBanner\b/);
    expect(code("src/app/not-found.tsx")).not.toMatch(/record it points to/);
  });

  it("npm scripts run under cmd.exe (no inline env vars, rm -rf or single quotes)", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    for (const [name, s] of Object.entries(pkg.scripts)) {
      expect(s, name).not.toMatch(/^[A-Z_]+=\S+\s|\brm -rf\b|'/);
    }
  });
});
