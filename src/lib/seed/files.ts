/**
 * Filesystem side of the seed pipeline: read seed-data/ into normalized text, and read/write the last valid
 * bundle (data/seed-bundle.json) that `npm run seed` and Reset demo replay. Paths are static literals so
 * Turbopack doesn't trace the whole project.
 */
import fs from "node:fs";
import path from "node:path";
import { isSeedBundle, type SeedBundle } from "./bundle";
import { normalizeText, type SeedSources } from "./source";

export const SEED_DIR = path.join(process.cwd(), "seed-data");
export const BUNDLE_FILE = path.join(process.cwd(), "data", "seed-bundle.json");
export const LOCK_FILE = path.join(process.cwd(), "seed-data", "seed.lock.json");
export const AUDIT_ARCHIVE_DIR = path.join(process.cwd(), "data", "audit-archive");

const SEED_EXTENSIONS = new Set([".yaml", ".yml", ".md", ".csv"]);
const SKIP_DIRS = new Set(["demo-cache"]); // cassettes are checked by demo:verify, not the seed loader

/** Reads every seed text file (sorted, forward-slash keys relative to seed-data/), normalized to LF + NFC. */
export function readSeedSources(dir: string = SEED_DIR): SeedSources {
  const out: SeedSources = {};
  const walk = (rel: string) => {
    const abs = path.join(dir, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(childRel);
      } else if (SEED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) && entry.name !== "README.md") {
        out[childRel] = normalizeText(fs.readFileSync(path.join(dir, childRel), "utf8"));
      }
    }
  };
  walk("");
  return out;
}

/** Writes the bundle atomically (temp file + rename), so a crash never leaves a half-written bundle. */
export function writeBundle(bundle: SeedBundle, file: string = BUNDLE_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(bundle), "utf8");
  fs.renameSync(tmp, file);
}

/** Reads the last valid bundle, or null when there is none (run `npm run seed:check`). */
export function readBundle(file: string = BUNDLE_FILE): SeedBundle | null {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return isSeedBundle(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Writes redacted live-call audit rows to data/audit-archive/ before a reset deletes them. */
export function archiveAuditRows(rows: Record<string, unknown>[], nowIso: string): string {
  fs.mkdirSync(AUDIT_ARCHIVE_DIR, { recursive: true });
  const file = path.join(AUDIT_ARCHIVE_DIR, `audit-${nowIso.replace(/[:.]/g, "-")}.jsonl`);
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  return file;
}
