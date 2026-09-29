// npm run db:nuke -- --yes — deletes the database files. Only with the server STOPPED: deleting a .db file that a
// running server holds corrupts the demo (Linux keeps writing the deleted copy; Windows refuses). Use
// `npm run seed` (or Reset demo) to reset while a server runs.
import "./lib/load-env.mts";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { dbFilePath } from "@/db/client";
import { out } from "./lib/out";

const PORTS = [3000, 3100, 3443];

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    sock.setTimeout(300);
    sock.once("connect", () => (sock.destroy(), resolve(true)));
    sock.once("timeout", () => (sock.destroy(), resolve(false)));
    sock.once("error", () => resolve(false));
  });
}

const file = dbFilePath();
const rel = path.relative(process.cwd(), file);
if (!process.argv.includes("--yes")) {
  out.line(`This deletes ${rel} (and its -wal/-shm files). Stop the server first, then run: npm run db:nuke -- --yes`);
  process.exit(1);
}
for (const port of PORTS) {
  if (await portOpen(port)) {
    out.error(`Something is listening on 127.0.0.1:${port}; it may be the Floorwise server. Stop it first (or use npm run seed to reset in place).`);
    process.exit(1);
  }
}
let removed = 0;
for (const f of [file, `${file}-wal`, `${file}-shm`]) {
  if (fs.existsSync(f)) {
    fs.rmSync(f);
    removed++;
  }
}
out.line(removed ? `Deleted ${rel}. Run npm run seed to recreate it.` : `${rel} doesn't exist; nothing to delete.`);
