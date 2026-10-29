// Shared harness for demo:record and demo:verify: a fresh in-memory database built from seed-data/ (deterministic, so
// payload hashes don't depend on the state of data/floorwise.db) and gateways with injected policy and providers.
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDb, type Db } from "@/db/client";
import { resetDatabase } from "@/db/reset";
import { abortableSleep } from "@/lib/ai/deps";
import { createGateway, type Gateway } from "@/lib/ai/gateway";
import { createTransportResolver } from "@/lib/ai/replay/lookup";
import type {
  AIActor,
  CassetteStore,
  GatewayDeps,
  ManifestRequest,
  ProviderFactory,
  ResolvedTransport,
  TransportPolicy,
  TransportResolver,
} from "@/lib/ai/types";
import { getPersonaWithRole } from "@/lib/data/personas";
import type { Env } from "@/lib/env";
import { buildSeedBundle } from "@/lib/seed/build";
import { readSeedSources } from "@/lib/seed/files";
import { out } from "./out";

export function freshDemoDb(): Db {
  const result = buildSeedBundle(readSeedSources());
  if (!result.bundle) {
    out.error("seed-data has errors: run npm run seed:check first.");
    process.exit(1);
  }
  const db = openDb({ file: ":memory:", create: true });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  resetDatabase(db.$client, result.bundle, { nowIso: `${result.bundle.demoToday}T12:00:00.000Z` });
  return db;
}

export function actorOf(db: Db, personaId: string): AIActor {
  const p = getPersonaWithRole(db, personaId);
  if (!p) {
    out.error(`Unknown persona ${personaId} in manifest.yaml.`);
    process.exit(1);
  }
  return { personaId: p.id, personId: p.personId, role: p.role };
}

/** A provider factory whose adapters refuse every call (no egress is possible through it). */
export const refusingProviders: ProviderFactory = (d) => ({
  descriptor: d,
  caps: { nativeJsonSchema: true, supportsEffort: true, maxContextTokens: 8192 },
  async *stream() {
    throw new Error("A live provider was called during an offline run.");
  },
  async complete() {
    throw new Error("A live provider was called during an offline run.");
  },
  async health() {
    throw new Error("A live provider was probed during an offline run.");
  },
});

/** Wraps a resolver so the caller can see which cassette entry served the last call. */
export function spyResolver(inner: TransportResolver): { resolver: TransportResolver; last: () => ResolvedTransport | null } {
  let last: ResolvedTransport | null = null;
  return {
    resolver: { resolve: (l, c) => (last = inner.resolve(l, c)) },
    last: () => last,
  };
}

export function gatewayFor(
  db: Db,
  env: Env,
  m: Pick<ManifestRequest, "mode" | "cloudProvider">,
  opts: { providers: ProviderFactory; store: CassetteStore; policy: Partial<TransportPolicy>; transports?: TransportResolver; now?: () => Date },
): Gateway {
  let n = 0;
  const deps: GatewayDeps = {
    db,
    env,
    now: opts.now ?? (() => new Date()),
    newRequestId: () => `req_demo_${++n}`,
    providers: opts.providers,
    transports: opts.transports ?? createTransportResolver(opts.store),
    sleep: abortableSleep,
    routingOverride: { mode: m.mode, cloudProvider: m.cloudProvider },
    transportPolicyOverride: opts.policy,
  };
  return createGateway(deps);
}
