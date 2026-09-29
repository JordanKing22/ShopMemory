# Data layer guide (Phase 2 onward)

How pages get data from SQLite without leaking role-hidden fields. Read this before adding a page or a query.
It puts CLAUDE.md hard rule 7 (roles are enforced server-side) and PLAN.md §4.8 into practice.

## The pattern in one picture

```
page.tsx (Server Component)
  └─ await getJobDetail(id)                  src/server/queries/jobs.ts   ("server-only", async)
       ├─ await connection()                 keeps the route dynamic (never prerenders seed data)
       ├─ const actor = await requireActor() role comes from the DB, never the cookie
       └─ jobDetail(getDb(), actor, id)       src/lib/data/jobs.ts          (pure, sync, testable)
            └─ returns a plain view model with hidden fields already dropped
```

- **Pure query functions** live in `src/lib/data/<area>.ts`. The signature is `(db: Db, actor: { role: Role; personId: string | null }, ...args)`.
  They are synchronous (better-sqlite3), import nothing from Next.js, and never import `server-only`, so Vitest and tsx can run them.
  An `Actor` from `src/server/actor.ts` satisfies the actor parameter structurally. Take `import type { Db } from "@/db/client"` and tables from `@/db/schema`.
- **Server wrappers** live in `src/server/queries/<area>.ts`. The file starts with `import "server-only";`. Each wrapper does three things in this order:
  `await connection()` (from `next/server`), then `requireActor()`, then the pure function with `getDb()` from `@/server/db`.
- **Pages** call only the wrappers. Client Components get the view model through props. They never import `@/db`, `@/lib/data` or `@/server/*`.

## Rules

1. **`await connection()` comes first** in every wrapper, before any DB read. A sync SQLite read without it runs during prerendering, and the
   page would ship stale seed data. `next build` must show `ƒ` (dynamic) for every DB route. Keep `cacheComponents` off and never use `use cache` on DB data.
   To share one lookup between a layout and a page in the same request, wrap the server function in React `cache()`.
2. **Hidden values never reach the client.** A gated field in a view model is typed `Gated<T>`
   (`{ hidden: true; label: string } | { hidden: false; value: T }`) and built with `gated(actor.role, field, value)` from `src/lib/data/gate.ts`.
   The page renders `<HiddenField label={...} />` (the visible "Hidden for Machinist role" pill) when `hidden` is true.
   **Never hide a value with CSS or conditional rendering alone.** If the value is in the RSC payload, it has leaked.
3. **Don't even select pricing columns** unless `canSee(actor.role, "prices")`. Only then join `quote_financials`.
   For machinist and trainee, no `quote_financials` column and no `customer_accounts` column may appear in the query or the view model,
   not even as a hidden placeholder that holds the value.
4. **Gate derived values too.** A departure date is hidden, and so is everything computed from it: months until departure, the departure factor
   in a risk explanation, the "departing within 24 months" KPI and the "⌛ Retires in 20 mo" chip. The same goes for margins computed from prices
   and for win rates computed from outcomes. **Don't sort or filter by a hidden field** for a role that can't see it, because the order leaks it.
5. **Every record view model carries `classification`**, including list rows. It comes from the row's own `classification` column and is never recomputed in the page.
   Render it with `<ClassificationBadge level={...} />`. An export-controlled detail page also shows `<ExportControlledBanner />`.
6. **View models are plain serializable data**: strings, numbers, booleans, null, arrays and plain objects. No `Date`, `Map`, class instances, functions
   or drizzle rows passed through unchanged. Dates stay ISO strings (`YYYY-MM-DD`) and are formatted at render time with `formatDate()` from `@/lib/format`
   (en-US, UTC). A test can check this with `JSON.parse(JSON.stringify(vm))` deep-equal `vm`.
7. **Domain "today" comes from the demo clock**: `shop_profile.demo_today` (via `await getDemoToday()` from `src/server/queries/shell.ts`; pure code takes the date as a parameter and uses `src/lib/time.ts`), never `new Date()`. There is no
   `Date.now()`, `Math.random()` or locale-dependent formatting in render paths. Use the one `monthsBetween()` for month maths.
8. **Search input is sanitized** with `src/lib/retrieval/fts-query.ts` before any FTS5 `MATCH`. Raw text like `thin-wall` throws.
   `search_*` columns never contain prices or account data.
9. **Not found stays not found.** A pure function returns `null` for an unknown ID. The page calls `notFound()`.
   Route params are async in Next 16: `const { id } = await params;`.
10. **Mutations are not in the data layer.** They are Server Actions (`src/app/actions/*`) wrapped in `withSafeErrors()`. Each one starts with
    `requireActor()` + `assertCan(actor, ...)` and then calls `revalidatePath`.

## Gated fields (PLAN.md §4.8)

| `GatedField` | Columns / values | owner | quoter | machinist | trainee |
|---|---|---|---|---|---|
| `prices` | all of `quote_financials` (shop rate, material cost, outside processing, risk adder hours, scrap allowance, unit/total price, margin) and any amount computed from them | ✓ | ✓ | hidden | hidden |
| `winLoss` | `quotes.outcome`, `quotes.lost_reason`, win rates | ✓ | ✓ | hidden | hidden |
| `contacts` | all of `customer_accounts` (contact name/email, payment terms, annual spend, pricing notes) | ✓ | ✓ | hidden | hidden |
| `departure` | `people.planned_departure_date`, `people.departure_kind`, months-to-departure, departure factor, "departing within 24 months" | ✓ | ✓ | hidden | hidden |

Quoted vs actual hours, setup and cycle times, customer names and documented customer quirks are visible to every role.

## Example: a job detail

```ts
// src/lib/data/jobs.ts: pure
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { customers, jobs, quoteFinancials, quotes, type Classification } from "@/db/schema";
import { canSee, type Role } from "@/lib/auth/roles";
import { gated, type Gated } from "@/lib/data/gate";

export interface JobDetailVM {
  id: string;
  classification: Classification;          // always present
  customerName: string;                     // visible to all roles
  quotedHours: number;
  actualHours: number | null;
  outcome: Gated<string>;                   // winLoss
  unitPriceUsd: Gated<number>;              // prices
}

export function jobDetail(db: Db, actor: { role: Role; personId: string | null }, id: string): JobDetailVM | null {
  const row = db
    .select({
      id: jobs.id, classification: jobs.classification, customerName: customers.name,
      quotedHours: quotes.quotedHours, actualHours: jobs.actualHours, outcome: quotes.outcome, quoteId: quotes.id,
    })
    .from(jobs)
    .innerJoin(quotes, eq(quotes.id, jobs.quoteId))
    .innerJoin(customers, eq(customers.id, quotes.customerId))
    .where(eq(jobs.id, id))
    .get();
  if (!row) return null;

  // Pricing is queried only for roles that may see it (rule 3), and the value is gated either way.
  const price = canSee(actor.role, "prices")
    ? db.select({ unit: quoteFinancials.unitPriceUsd }).from(quoteFinancials).where(eq(quoteFinancials.quoteId, row.quoteId)).get()?.unit ?? null
    : null;

  return {
    id: row.id,
    classification: row.classification,
    customerName: row.customerName,
    quotedHours: row.quotedHours,
    actualHours: row.actualHours,
    outcome: gated(actor.role, "winLoss", row.outcome),
    unitPriceUsd: gated(actor.role, "prices", price ?? 0),
  };
}
```

```ts
// src/server/queries/jobs.ts: server wrapper
import "server-only";
import { connection } from "next/server";
import { jobDetail, type JobDetailVM } from "@/lib/data/jobs";
import { requireActor } from "@/server/actor";
import { getDb } from "@/server/db";

export async function getJobDetail(id: string): Promise<JobDetailVM | null> {
  await connection();
  const actor = await requireActor();
  return jobDetail(getDb(), actor, id);
}
```

```tsx
// src/app/(app)/jobs/[id]/page.tsx
import { notFound } from "next/navigation";
import { getJobDetail } from "@/server/queries/jobs";
import { ClassificationBadge, ExportControlledBanner, HiddenField } from "@/components/app";
import { formatMoneyUSD } from "@/lib/format";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJobDetail(id);
  if (!job) notFound();
  return (
    <>
      {job.classification === "export_controlled" && <ExportControlledBanner />}
      <ClassificationBadge level={job.classification} />
      {job.unitPriceUsd.hidden ? <HiddenField label={job.unitPriceUsd.label} /> : formatMoneyUSD(job.unitPriceUsd.value)}
    </>
  );
}
```

(Column names in the example are illustrative. Check `src/db/schema/*` for the real ones.)

## Existing modules

| Module | What it gives you |
|---|---|
| `src/lib/data/gate.ts` | `gated()`, `gatedValue()`, types `Gated<T>`, `Hidden`, `Visible<T>` |
| `src/lib/auth/roles.ts` | `Role`, `ROLE_LABEL`, `canSee()`, `hiddenLabel()`, `can()`, `GatedField`, `Capability` |
| `src/lib/data/personas.ts` | pure `listSwitcherPersonas(db)`, `getPersonaWithRole(db, id)`, `getDefaultOwnerPersona(db)`, `isSwitchablePersona(db, id)`. These establish the actor, so they take no actor |
| `src/server/queries/personas.ts` | `listPersonas()` (awaits `connection()`), `getPersonaWithRole(id)`, `getDefaultOwnerPersona()`, `isSwitchablePersona(id)`; `src/server/actor.ts` resolves the actor through these |
| `src/server/queries/shell.ts` | `getShellInfo()` (React `cache`): shop name, fictional notice and `demoToday` for the app shell; `getDemoToday()`: the demo clock's YYYY-MM-DD |
| `src/lib/policy/summary.ts` | `getRoutingSummary(getEnv())`: mode, provider, host, clearance dots, per-label `routes` (primary · secondary · local · blocked) and config problems for the header badge (pure, reads config only) |
| `src/lib/policy/matrix.ts` | `ROUTING_MATRIX`, `matrixRows()`, `allowed()`: the routing table the Privacy page renders; `crossRegionOf()` (unknown Bedrock profile scope counts as global) |
| `src/lib/routing-copy.ts` | `modeSentence()`, `clearanceText()`, `ecHeaderLabel()`, `CROSS_REGION_TEXT` …: routing wording for the badge, Settings and Privacy. Never names a destination the policy blocks; reuse it instead of writing new routing sentences |
| `src/lib/classification-labels.ts` | `CLASSIFICATION_LABEL`, `CLASSIFICATION_SHORT` (also re-exported by `ClassificationBadge`) |

## Testing a data function

Pure functions run against a real schema in a temp DB: `openDb({ file, create: true })`, then `migrate(...)` and
`resetDatabase(db.$client, buildSeedBundle(readSeedSources()).bundle!, { nowIso })` (see `tests/seed-pipeline.test.ts`).
Assert for machinist and trainee that the serialized view model contains no price or contact value:
`expect(JSON.stringify(vm)).not.toContain(String(price))`.
