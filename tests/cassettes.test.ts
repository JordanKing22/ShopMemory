/**
 * The committed cassettes (seed-data/demo-cache): they parse, contain no seed name or record number, cite only sources
 * that are sent, match the manifest, and every manifest request replays EXACTLY through the gateway with no provider
 * (the same check as `npm run demo:verify`).
 */
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import fs from "node:fs";
import path from "node:path";
import { cassetteFromYaml, cassetteToYaml } from "@/lib/ai/replay/cassette";
import { DEMO_CACHE_DIR, readCassetteDir, readManifest } from "@/lib/ai/replay/store";
import { dictionaryHits, tokensIn } from "@/lib/redaction";
import { isToken } from "@/lib/redaction/patterns";
import { verifyCassettes } from "../scripts/demo-verify.mts";
import { seedRedactionDictionary } from "./helpers/dictionary";

const files = readCassetteDir();
const manifest = readManifest();
const dict = seedRedactionDictionary();

describe("cassettes", () => {
  it("exist for Phase 3 (smoke.cloud required) and round-trip through the YAML codec", () => {
    expect(files.map((f) => f.id)).toEqual(expect.arrayContaining(["smoke.cloud", "smoke.local"]));
    for (const f of files) {
      const again = cassetteFromYaml(`${f.id}.yaml`, parse(cassetteToYaml(f)));
      expect(again).toEqual(f);
      const raw = fs.readFileSync(path.join(DEMO_CACHE_DIR, `${f.id}.yaml`), "utf8");
      expect(raw.startsWith("# "), `${f.id} starts with an explanatory comment`).toBe(true);
    }
  });

  it("are tokenized: no dictionary surface, only grammar tokens", () => {
    for (const f of files) {
      for (const e of f.entries) {
        const texts = [e.response.text, e.question ?? "", e.note ?? ""];
        for (const t of texts) {
          expect(dictionaryHits(t, dict), `${f.id}#${e.id}`).toEqual([]);
          for (const tok of tokensIn(t)) expect(isToken(tok)).toBe(true);
        }
      }
    }
  });

  it("cite only sources the entry lists, and the manifest points at existing entries", () => {
    for (const f of files) {
      for (const e of f.entries) {
        const keys = new Set(e.sources.map((s) => s.key));
        for (const m of e.response.text.matchAll(/\[(S[1-9][0-9]{0,2})\]/g)) expect(keys.has(m[1]), `${f.id}#${e.id} cites ${m[1]}`).toBe(true);
      }
    }
    for (const m of manifest) {
      const [fid, eid] = m.expect.split("#");
      expect(files.find((f) => f.id === fid)?.entries.some((e) => e.id === eid), m.id).toBe(true);
    }
  });

  it("every manifest request replays exactly through the gateway with no network (demo:verify)", async () => {
    const r = await verifyCassettes();
    expect(r.failures).toEqual([]);
    expect(r.checked).toBe(manifest.length);
    expect(r.checked).toBeGreaterThanOrEqual(10);
  });
});
