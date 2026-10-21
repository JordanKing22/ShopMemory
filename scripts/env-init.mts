/**
 * npm run env:init — creates .env.local from .env.example so you can paste your keys into it.
 * Never overwrites an existing .env.local and never prints its contents. .env.local is gitignored.
 */
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { out } from "./lib/out";

const root = process.cwd();
const example = path.join(root, ".env.example");
const local = path.join(root, ".env.local");

if (existsSync(local)) {
  out.line(`.env.local already exists (left unchanged): ${local}`);
} else {
  copyFileSync(example, local);
  out.line(`Created ${local} from .env.example.`);
}
out.line("Open it in a text editor (e.g. Notepad), put your key after ANTHROPIC_API_KEY= and save.");
out.line("The file is gitignored, so it is never committed. Restart the app (or rerun the script) to pick it up.");
