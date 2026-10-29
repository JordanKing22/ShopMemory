/**
 * No-egress guard (PLAN.md §12): preloaded with `--require` (Playwright's server, demo:verify). Blocks every socket and
 * DNS lookup that isn't loopback, and records each attempt (host, port — never payloads) to the file named by
 * NO_EGRESS_LOG, so tests can assert zero attempts. Connections to Ollama's port 11434 are also recorded when
 * NO_EGRESS_FLAG_OLLAMA=1 (in replay mode the local model must not be contacted either).
 */
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload loaded with node --require */
const net = require("node:net");
const dns = require("node:dns");
const fs = require("node:fs");

if (!globalThis.__floorwiseNoEgress) {
  globalThis.__floorwiseNoEgress = true;
  const logFile = process.env.NO_EGRESS_LOG || "";
  const flagOllama = process.env.NO_EGRESS_FLAG_OLLAMA === "1";

  const isLoopback = (host) => {
    if (!host) return true; // unix sockets / default localhost
    const h = String(host).toLowerCase().replace(/^\[|\]$/g, "");
    return h === "localhost" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) || h === "::ffff:127.0.0.1";
  };
  const record = (kind, host, port) => {
    if (!logFile) return;
    try {
      fs.appendFileSync(logFile, `${JSON.stringify({ kind, host: String(host), port: port == null ? null : Number(port) })}\n`);
    } catch {
      // never let the guard itself break the server
    }
  };
  const blocked = (host, port) => {
    const err = new Error("Network egress is blocked in this run.");
    err.code = "ENETUNREACH";
    record("blocked", host, port);
    return err;
  };

  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function connect(...args) {
    let host;
    let port;
    const a0 = args[0];
    if (a0 && typeof a0 === "object" && !Array.isArray(a0)) {
      host = a0.host;
      port = a0.port;
      if (a0.path) return origConnect.apply(this, args);
    } else if (typeof a0 === "number" || (typeof a0 === "string" && /^\d+$/.test(a0))) {
      port = a0;
      host = typeof args[1] === "string" ? args[1] : "localhost";
    } else if (typeof a0 === "string") {
      return origConnect.apply(this, args); // IPC path
    }
    if (!isLoopback(host)) {
      const err = blocked(host, port);
      process.nextTick(() => this.destroy(err));
      return this;
    }
    if (flagOllama && Number(port) === 11434) record("ollama_port", host, port);
    return origConnect.apply(this, args);
  };

  const origLookup = dns.lookup;
  dns.lookup = function lookup(hostname, options, callback) {
    const cb = typeof options === "function" ? options : callback;
    if (!isLoopback(hostname)) {
      const err = blocked(hostname, null);
      if (typeof cb === "function") process.nextTick(() => cb(err));
      return;
    }
    return origLookup.apply(this, arguments);
  };
  const origPromisesLookup = dns.promises.lookup;
  dns.promises.lookup = function lookup(hostname, options) {
    if (!isLoopback(hostname)) return Promise.reject(blocked(hostname, null));
    return origPromisesLookup.call(this, hostname, options);
  };
}
