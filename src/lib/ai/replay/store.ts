/**
 * Cassette stores. The file store reads seed-data/demo-cache/*.yaml (a static path literal, so Turbopack traces only
 * that folder) once per process; the memory store serves tests.
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { CassetteFile, CassetteStore, ManifestRequest } from "../types";
import { cassetteFromYaml } from "./cassette";
import { manifestFromYaml } from "./manifest";

export const DEMO_CACHE_DIR = path.join(process.cwd(), "seed-data", "demo-cache");
export const MANIFEST_FILE = "manifest.yaml";

export function readCassetteDir(dir: string = DEMO_CACHE_DIR): CassetteFile[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") && f !== MANIFEST_FILE)
    .sort()
    .map((f) => {
      const file = cassetteFromYaml(f, parse(fs.readFileSync(path.join(dir, f), "utf8")));
      if (`${file.id}.yaml` !== f) throw new Error(`${f}: the id must match the file name`);
      return file;
    });
}

export function readManifest(dir: string = DEMO_CACHE_DIR): ManifestRequest[] {
  const f = path.join(dir, MANIFEST_FILE);
  if (!fs.existsSync(f)) return [];
  return manifestFromYaml(parse(fs.readFileSync(f, "utf8")));
}

export function memoryCassetteStore(files: CassetteFile[]): CassetteStore {
  return { files: () => files };
}

const slot = globalThis as typeof globalThis & { __floorwiseCassettes?: CassetteFile[] };

/** Reads the cassette folder once per process. A broken cassette fails loudly at first use (demo:verify catches it). */
export function fsCassetteStore(): CassetteStore {
  return {
    files: () => (slot.__floorwiseCassettes ??= readCassetteDir()),
  };
}
