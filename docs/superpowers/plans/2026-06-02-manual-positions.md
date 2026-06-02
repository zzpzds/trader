# Manual Positions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "手动持仓" (non-strategy positions) and decouple price data from monitoring runs so manual and strategy positions share one price pipeline.

**Architecture:** Make `positions.strategy_id` nullable; add `price_snapshots(symbol, date, OHLCV)` time-series table; new worker `daily-price-refresh` becomes the single source of price data; existing `runMonitoringJob` reads from `price_snapshots` instead of fetching itself; manual position POST enqueues `manual-backfill` task; `/positions` page splits into 「策略持仓」 / 「手动持仓」 tabs.

**Tech Stack:** Drizzle ORM (Postgres), Next.js 15 App Router, pg-boss queue, vitest, Alpha Vantage as the active price provider.

**Spec:** `docs/superpowers/specs/2026-06-02-manual-positions-design.md`

---

## File Structure

**Modified:**
- `packages/db/src/schema.ts` — schema changes (3 areas)
- `packages/db/src/schema.test.ts` — schema tests
- `apps/worker/src/monitoring/alphavantage-fetch.ts` — outputsize=full for deep backfill
- `apps/worker/src/monitoring/job.ts` — runMonitoringJob reads from price_snapshots
- `apps/worker/src/worker.ts` — register new queues + crons
- `apps/web/app/api/positions/summary/route.ts` — read from price_snapshots
- `apps/web/app/api/positions/history/route.ts` — read from price_snapshots
- `apps/web/app/api/strategies/route.ts` — return analysisWindowDays
- `apps/web/app/api/strategies/[id]/route.ts` — accept analysisWindowDays in PUT
- `apps/web/app/strategies/[id]/page.tsx` — use shared LotForm + analysisWindowDays input
- `apps/web/app/positions/page.tsx` — tab structure

**Created:**
- `apps/worker/src/monitoring/price-snapshots.ts` — `upsertSnapshots`, `ensurePriceSnapshots`
- `apps/worker/src/monitoring/__tests__/price-snapshots.test.ts`
- `apps/worker/src/monitoring/price-refresh-job.ts` — daily-price-refresh handler
- `apps/worker/src/monitoring/__tests__/price-refresh-job.test.ts`
- `apps/worker/src/monitoring/__tests__/job.test.ts` (if not already covering refactor)
- `apps/web/lib/queue.ts` — pg-boss client singleton for web
- `apps/web/app/api/positions/manual/route.ts` — GET/POST
- `apps/web/app/api/positions/manual/__tests__/route.test.ts`
- `apps/web/app/api/positions/manual/[positionId]/route.ts` — DELETE position
- `apps/web/app/api/positions/manual/[positionId]/__tests__/route.test.ts`
- `apps/web/app/api/positions/manual/lots/[lotId]/route.ts` — DELETE lot
- `apps/web/app/api/positions/manual/lots/[lotId]/__tests__/route.test.ts`
- `apps/web/components/lot-form.tsx` — shared LotForm
- `apps/web/components/manual-positions-tab.tsx` — manual positions list/dialog/polling
- `scripts/backfill-price-snapshots.ts` — one-time migration script

---

## Phase 1 — DB Schema

### Task 1: Add `analysis_window_days` to strategies

**Files:**
- Modify: `packages/db/src/schema.ts:13-23`
- Modify: `packages/db/src/schema.test.ts`

- [ ] **Step 1: Add failing test for default value**

In `packages/db/src/schema.test.ts`, add inside the existing strategies-related describe block:

```ts
it("strategies.analysisWindowDays defaults to 60", async () => {
  const [row] = await db
    .insert(strategies)
    .values({ name: "T", symbols: ["QQQ"], content: "c", script: "s" })
    .returning();
  expect(row.analysisWindowDays).toBe(60);
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd packages/db && npx vitest run src/schema.test.ts -t "analysisWindowDays defaults"
```

Expected: FAIL — column does not exist.

- [ ] **Step 3: Add column to schema**

In `packages/db/src/schema.ts`, modify the `strategies` table:

```ts
export const strategies = pgTable("strategies", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  symbols: jsonb("symbols").notNull().$type<string[]>(),
  content: text("content").notNull(),
  script: text("script").notNull(),
  analysisWindowDays: integer("analysis_window_days").notNull().default(60),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

Add `integer` to the `pg-core` import at the top of the file if not already imported.

- [ ] **Step 4: Push schema and re-run test**

```
cd packages/db && npm run db:push -- --force
npx vitest run src/schema.test.ts -t "analysisWindowDays defaults"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add packages/db/src/schema.ts packages/db/src/schema.test.ts
git commit -m "feat(db): add analysis_window_days to strategies"
```

---

### Task 2: Make `positions.strategyId` nullable + `ON DELETE SET NULL` + `NULLS NOT DISTINCT`

**Files:**
- Modify: `packages/db/src/schema.ts:25-40`
- Modify: `packages/db/src/schema.test.ts`

- [ ] **Step 1: Add failing test for nullable strategy + manual uniqueness**

```ts
it("positions allows NULL strategyId and de-dupes by symbol when NULL", async () => {
  await db.insert(positions).values({ strategyId: null, symbol: "AAPL" });
  await expect(
    db.insert(positions).values({ strategyId: null, symbol: "AAPL" })
  ).rejects.toThrow(/unique|duplicate/i);
});

it("deleting a strategy nulls its positions instead of cascading", async () => {
  const [s] = await db
    .insert(strategies)
    .values({ name: "X", symbols: ["AAPL"], content: "c", script: "s" })
    .returning();
  const [p] = await db
    .insert(positions)
    .values({ strategyId: s.id, symbol: "AAPL" })
    .returning();

  await db.delete(strategies).where(eq(strategies.id, s.id));

  const [after] = await db.select().from(positions).where(eq(positions.id, p.id));
  expect(after.strategyId).toBeNull();
});
```

(Adjust imports — needs `eq` from drizzle-orm.)

- [ ] **Step 2: Run tests to verify failure**

```
cd packages/db && npx vitest run src/schema.test.ts -t "NULL strategyId|nulls its positions"
```

Expected: FAIL — both tests fail (constraint error or row missing/cascaded).

- [ ] **Step 3: Modify positions table**

In `packages/db/src/schema.ts`:

```ts
export const positions = pgTable(
  "positions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    strategyId: text("strategy_id").references(() => strategies.id, {
      onDelete: "set null",
    }),
    symbol: text("symbol").notNull(),
    referencePrice: numeric("reference_price", { precision: 15, scale: 4 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("positions_strategy_id_symbol_idx")
      .on(t.strategyId, t.symbol)
      .nullsNotDistinct(),
  ]
);
```

- [ ] **Step 4: Push schema and re-run tests**

```
cd packages/db && npm run db:push -- --force
npx vitest run src/schema.test.ts -t "NULL strategyId|nulls its positions"
```

Expected: PASS.

- [ ] **Step 5: Generate Drizzle migration file**

```
cd packages/db && npx drizzle-kit generate
```

This produces a new SQL file under `packages/db/drizzle/`. Inspect it briefly to confirm it includes:
- `ALTER TABLE "positions" ALTER COLUMN "strategy_id" DROP NOT NULL`
- New FK with `ON DELETE SET NULL`
- Drop & recreate of the unique index with `NULLS NOT DISTINCT`

- [ ] **Step 6: Commit**

```
git add packages/db/src/schema.ts packages/db/src/schema.test.ts packages/db/drizzle/
git commit -m "feat(db): allow null strategy_id on positions; cascade-null on strategy delete"
```

---

### Task 3: Add `price_snapshots` table

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/schema.test.ts`

- [ ] **Step 1: Failing test**

```ts
it("price_snapshots upserts by (symbol, date)", async () => {
  await db.insert(priceSnapshots).values({
    symbol: "QQQ", date: "2026-06-01",
    open: "100.00", high: "101.00", low: "99.50", close: "100.50",
    volume: 1000n,
  });
  await db
    .insert(priceSnapshots)
    .values({
      symbol: "QQQ", date: "2026-06-01",
      open: "100.00", high: "101.00", low: "99.50", close: "100.99",
      volume: 1000n,
    })
    .onConflictDoUpdate({
      target: [priceSnapshots.symbol, priceSnapshots.date],
      set: { close: "100.99" },
    });
  const rows = await db
    .select()
    .from(priceSnapshots)
    .where(and(eq(priceSnapshots.symbol, "QQQ"), eq(priceSnapshots.date, "2026-06-01")));
  expect(rows).toHaveLength(1);
  expect(rows[0].close).toBe("100.9900");
});
```

- [ ] **Step 2: Run to verify failure**

```
cd packages/db && npx vitest run src/schema.test.ts -t "price_snapshots upserts"
```

Expected: FAIL — `priceSnapshots` not exported.

- [ ] **Step 3: Add table to schema**

Append to `packages/db/src/schema.ts`:

```ts
export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    symbol: text("symbol").notNull(),
    date: date("date").notNull(),
    open: numeric("open", { precision: 15, scale: 4 }).notNull(),
    high: numeric("high", { precision: 15, scale: 4 }).notNull(),
    low: numeric("low", { precision: 15, scale: 4 }).notNull(),
    close: numeric("close", { precision: 15, scale: 4 }).notNull(),
    volume: bigint("volume", { mode: "bigint" }),
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.symbol, t.date] }),
    index("price_snapshots_symbol_date_desc_idx").on(t.symbol, desc(t.date)),
  ]
);
```

Add `date`, `bigint`, `primaryKey`, `index`, `desc` to imports.

- [ ] **Step 4: Push and re-run**

```
cd packages/db && npm run db:push -- --force
npx vitest run src/schema.test.ts -t "price_snapshots upserts"
```

Expected: PASS.

- [ ] **Step 5: Generate migration**

```
cd packages/db && npx drizzle-kit generate
```

- [ ] **Step 6: Commit**

```
git add packages/db/src/schema.ts packages/db/src/schema.test.ts packages/db/drizzle/
git commit -m "feat(db): add price_snapshots OHLCV time-series table"
```

---

## Phase 2 — Worker price layer

### Task 4: `upsertSnapshots` helper

**Files:**
- Create: `apps/worker/src/monitoring/price-snapshots.ts`
- Create: `apps/worker/src/monitoring/__tests__/price-snapshots.test.ts`

- [ ] **Step 1: Failing test**

`apps/worker/src/monitoring/__tests__/price-snapshots.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { upsertSnapshots } from "../price-snapshots.js";

describe("upsertSnapshots", () => {
  it("calls insert with onConflictDoUpdate per (symbol, date)", async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const db: any = { insert };

    const result = {
      AAPL: {
        latest: 100,
        bars: [
          { date: "2026-06-01", open: 99, high: 101, low: 98, close: 100, volume: 1000 },
          { date: "2026-06-02", open: 100, high: 102, low: 99, close: 101, volume: 1100 },
        ],
      },
    };

    await upsertSnapshots(db, result);

    expect(insert).toHaveBeenCalledTimes(2);
    expect(values).toHaveBeenNthCalledWith(1, expect.objectContaining({ symbol: "AAPL", date: "2026-06-01", close: "100" }));
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run failing**

```
cd apps/worker && npx vitest run src/monitoring/__tests__/price-snapshots.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement helper**

`apps/worker/src/monitoring/price-snapshots.ts`:

```ts
import { priceSnapshots } from "@trader/db";
import type { FetchResult } from "./alphavantage-fetch.js";

export async function upsertSnapshots(db: any, result: FetchResult): Promise<void> {
  for (const [symbol, data] of Object.entries(result)) {
    for (const bar of data.bars) {
      await db
        .insert(priceSnapshots)
        .values({
          symbol,
          date: bar.date,
          open: String(bar.open),
          high: String(bar.high),
          low: String(bar.low),
          close: String(bar.close),
          volume: bar.volume != null ? BigInt(bar.volume) : null,
        })
        .onConflictDoUpdate({
          target: [priceSnapshots.symbol, priceSnapshots.date],
          set: {
            open: String(bar.open),
            high: String(bar.high),
            low: String(bar.low),
            close: String(bar.close),
            volume: bar.volume != null ? BigInt(bar.volume) : null,
            fetchedAt: new Date(),
          },
        });
    }
  }
}
```

- [ ] **Step 4: Run test passes**

```
cd apps/worker && npx vitest run src/monitoring/__tests__/price-snapshots.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add apps/worker/src/monitoring/price-snapshots.ts apps/worker/src/monitoring/__tests__/price-snapshots.test.ts
git commit -m "feat(worker): add upsertSnapshots helper"
```

---

### Task 5: `ensurePriceSnapshots` helper

**Files:**
- Modify: `apps/worker/src/monitoring/price-snapshots.ts`
- Modify: `apps/worker/src/monitoring/__tests__/price-snapshots.test.ts`

- [ ] **Step 1: Failing tests**

Append to the test file:

```ts
import { ensurePriceSnapshots } from "../price-snapshots.js";

vi.mock("../alphavantage-fetch.js", () => ({
  fetchPrices: vi.fn(),
}));
import { fetchPrices } from "../alphavantage-fetch.js";

describe("ensurePriceSnapshots", () => {
  it("does nothing when existing data already covers fromDate", async () => {
    const select = vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ minDate: "2026-04-01" }]),
    }));
    const db: any = { select };
    await ensurePriceSnapshots(db, "AAPL", "2026-05-01");
    expect(fetchPrices).not.toHaveBeenCalled();
  });

  it("fetches and upserts when fromDate precedes existing min", async () => {
    const select = vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ minDate: "2026-05-01" }]),
    }));
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const db: any = { select, insert };
    (fetchPrices as any).mockResolvedValueOnce({
      AAPL: { latest: 100, bars: [{ date: "2026-04-15", open: 1, high: 1, low: 1, close: 1, volume: 1 }] },
    });
    await ensurePriceSnapshots(db, "AAPL", "2026-04-15");
    expect(fetchPrices).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run failing**

```
cd apps/worker && npx vitest run src/monitoring/__tests__/price-snapshots.test.ts -t "ensurePriceSnapshots"
```

Expected: FAIL — `ensurePriceSnapshots` not exported.

- [ ] **Step 3: Implement**

Append to `apps/worker/src/monitoring/price-snapshots.ts`:

```ts
import { eq, min } from "drizzle-orm";
import { fetchPrices } from "./alphavantage-fetch.js";

export async function ensurePriceSnapshots(
  db: any,
  symbol: string,
  fromDate: string
): Promise<void> {
  const existing = await db
    .select({ minDate: min(priceSnapshots.date) })
    .from(priceSnapshots)
    .where(eq(priceSnapshots.symbol, symbol));
  const existingMin = existing[0]?.minDate ?? null;
  if (existingMin && existingMin <= fromDate) return;

  const daysBack =
    Math.ceil((Date.now() - new Date(fromDate).getTime()) / 86_400_000) + 1;
  const result = await fetchPrices([symbol], `${daysBack}d`);
  await upsertSnapshots(db, result);
}
```

- [ ] **Step 4: Run passes**

```
cd apps/worker && npx vitest run src/monitoring/__tests__/price-snapshots.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add apps/worker/src/monitoring/price-snapshots.ts apps/worker/src/monitoring/__tests__/price-snapshots.test.ts
git commit -m "feat(worker): add ensurePriceSnapshots helper"
```

---

### Task 6: `fetchPrices` outputsize=full when daysBack > 100

**Files:**
- Modify: `apps/worker/src/monitoring/alphavantage-fetch.ts`
- Modify: `apps/worker/src/monitoring/__tests__/alphavantage-fetch.test.ts`

- [ ] **Step 1: Failing test**

Add to `alphavantage-fetch.test.ts`:

```ts
it("uses outputsize=full when period exceeds 100 days", async () => {
  globalThis.fetch = vi.fn(async (url: any) => {
    expect(String(url)).toContain("outputsize=full");
    return new Response(JSON.stringify({
      "Time Series (Daily)": {
        "2026-06-01": { "1. open": "1", "2. high": "1", "3. low": "1", "4. close": "1", "5. volume": "0" },
      },
    }), { status: 200 });
  }) as any;

  await fetchPrices(["AAPL"], "120d");
});
```

- [ ] **Step 2: Run failing**

```
cd apps/worker && npx vitest run src/monitoring/__tests__/alphavantage-fetch.test.ts -t "outputsize=full"
```

Expected: FAIL.

- [ ] **Step 3: Implement**

In `apps/worker/src/monitoring/alphavantage-fetch.ts`, locate the URL construction inside the `fetchPrices` loop and add the size param. Find the existing URL line (the one calling `TIME_SERIES_DAILY`) and modify:

```ts
const days = periodToDays(period);
const outputsize = days > 100 ? "full" : "compact";
const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&apikey=${apiKey}&outputsize=${outputsize}`;
```

(Replace whatever the current URL string is. If it already has `outputsize=compact`, replace that.)

- [ ] **Step 4: Run test passes**

```
cd apps/worker && npx vitest run src/monitoring/__tests__/alphavantage-fetch.test.ts
```

Expected: ALL PASS (existing tests + new one).

- [ ] **Step 5: Commit**

```
git add apps/worker/src/monitoring/alphavantage-fetch.ts apps/worker/src/monitoring/__tests__/alphavantage-fetch.test.ts
git commit -m "feat(worker): use outputsize=full for deep backfill"
```

---

### Task 7: `daily-price-refresh` queue + cron

**Files:**
- Create: `apps/worker/src/monitoring/price-refresh-job.ts`
- Create: `apps/worker/src/monitoring/__tests__/price-refresh-job.test.ts`
- Modify: `apps/worker/src/worker.ts`

- [ ] **Step 1: Failing test**

`apps/worker/src/monitoring/__tests__/price-refresh-job.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("../alphavantage-fetch.js", () => ({ fetchPrices: vi.fn() }));
vi.mock("../price-snapshots.js", () => ({ upsertSnapshots: vi.fn() }));

import { runPriceRefreshJob } from "../price-refresh-job.js";
import { fetchPrices } from "../alphavantage-fetch.js";
import { upsertSnapshots } from "../price-snapshots.js";

describe("runPriceRefreshJob", () => {
  it("collects DISTINCT symbols across all positions and upserts results", async () => {
    const symbolsRows = [{ symbol: "AAPL" }, { symbol: "QQQ" }];
    const select = vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockResolvedValue(symbolsRows),
    }));
    const db: any = { select };
    (fetchPrices as any).mockResolvedValueOnce({
      AAPL: { latest: 1, bars: [] },
      QQQ: { latest: 1, bars: [] },
    });

    await runPriceRefreshJob(db);

    expect(fetchPrices).toHaveBeenCalledWith(["AAPL", "QQQ"], "5d");
    expect(upsertSnapshots).toHaveBeenCalled();
  });

  it("does nothing when no symbols", async () => {
    const select = vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockResolvedValue([]),
    }));
    const db: any = { select };
    await runPriceRefreshJob(db);
    expect(fetchPrices).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run failing**

```
cd apps/worker && npx vitest run src/monitoring/__tests__/price-refresh-job.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement job**

`apps/worker/src/monitoring/price-refresh-job.ts`:

```ts
import { eq } from "drizzle-orm";
import { positions, positionLots } from "@trader/db";
import { fetchPrices } from "./alphavantage-fetch.js";
import { upsertSnapshots } from "./price-snapshots.js";

export async function runPriceRefreshJob(db: any): Promise<void> {
  const rows = await db
    .select({ symbol: positions.symbol })
    .from(positions)
    .innerJoin(positionLots, eq(positionLots.positionId, positions.id))
    .groupBy(positions.symbol);
  const symbols = rows.map((r: any) => r.symbol);
  if (symbols.length === 0) {
    console.log("[price-refresh] no symbols, skipping");
    return;
  }
  const result = await fetchPrices(symbols, "5d");
  await upsertSnapshots(db, result);
}
```

- [ ] **Step 4: Run test passes**

```
cd apps/worker && npx vitest run src/monitoring/__tests__/price-refresh-job.test.ts
```

Expected: PASS.

- [ ] **Step 5: Register queue and cron in worker**

Modify `apps/worker/src/worker.ts`. Add import at top:

```ts
import { runPriceRefreshJob } from "./monitoring/price-refresh-job.js";
import { ensurePriceSnapshots } from "./monitoring/price-snapshots.js";
```

Inside `start()`, before the existing daily-monitoring queue registration:

```ts
await boss.createQueue("daily-price-refresh");
await boss.work("daily-price-refresh", async () => {
  console.log("[worker] daily-price-refresh job triggered");
  await runPriceRefreshJob(db);
});
await boss.schedule("daily-price-refresh", "0 1 * * *");
console.log("[worker] daily-price-refresh cron registered (0 1 * * * UTC)");

await boss.createQueue("manual-backfill");
await boss.work<{ symbol: string; fromDate: string }>(
  "manual-backfill",
  async (jobs) => {
    const { symbol, fromDate } = jobs[0].data;
    console.log(`[worker] manual-backfill triggered: ${symbol} from ${fromDate}`);
    await ensurePriceSnapshots(db, symbol, fromDate);
  }
);
```

- [ ] **Step 6: Commit**

```
git add apps/worker/src/monitoring/price-refresh-job.ts apps/worker/src/monitoring/__tests__/price-refresh-job.test.ts apps/worker/src/worker.ts
git commit -m "feat(worker): daily-price-refresh and manual-backfill queues"
```

---

## Phase 3 — Monitoring decoupling

### Task 8: Refactor `runMonitoringJob` to read from `price_snapshots`

**Files:**
- Modify: `apps/worker/src/monitoring/job.ts`
- Modify: `apps/worker/src/monitoring/__tests__/job.test.ts` (create if missing)

- [ ] **Step 1: Add failing test**

If `job.test.ts` doesn't exist, create with:

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("../alphavantage-fetch.js", () => ({ fetchPrices: vi.fn() }));
import { fetchPrices } from "../alphavantage-fetch.js";

describe("runMonitoringJob", () => {
  it("reads bars from price_snapshots within strategy.analysisWindowDays", async () => {
    const strategiesWithLots = [{
      id: "s1", name: "S", content: "c",
      analysisWindowDays: 30,
      symbols: ["AAPL"],
      positions: [{ id: "p1", symbol: "AAPL", referencePrice: null, positionLots: [
        { shares: 1, costPrice: "100", lotDate: "2026-05-01", notes: null },
      ] }],
    }];

    const snapshotRows = [
      { symbol: "AAPL", date: "2026-05-15", open: "1", high: "1", low: "1", close: "100", volume: 0n },
      { symbol: "AAPL", date: "2026-05-16", open: "1", high: "1", low: "1", close: "101", volume: 0n },
    ];

    // db mock: sequence of calls — strategiesWithLots fetch, then per-strategy snapshot select, then update
    const select = vi.fn();
    select
      .mockReturnValueOnce({ from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockResolvedValue(snapshotRows) });

    const update = vi.fn(() => ({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) }));
    const insert = vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([{ id: "run1" }]) })) }));

    const db: any = {
      select, update, insert,
      query: { strategies: { findMany: vi.fn().mockResolvedValue([]) } },
    };

    // analyze mock
    vi.doMock("../analyze.js", () => ({
      createAnalyzer: () => async () => ({ analysis: "ok", hasActionItems: false }),
    }));

    const { processStrategy } = await import("../job.js");
    await processStrategy(db, strategiesWithLots[0]);

    // fetchPrices NOT called from runMonitoringJob (snapshots are the source)
    expect(fetchPrices).not.toHaveBeenCalled();
  });
});
```

This test requires `processStrategy` to be exported from `job.ts`. Step 3 below adds the `export` keyword to its declaration.

- [ ] **Step 2: Run failing**

```
cd apps/worker && npx vitest run src/monitoring/__tests__/job.test.ts
```

Expected: FAIL — exports/behavior don't match yet.

- [ ] **Step 3: Refactor `runMonitoringJob`**

In `apps/worker/src/monitoring/job.ts`:

1. Remove the global `fetchPrices(allSymbols, "60d")` call and `prefetchedPrices` plumbing in `runMonitoringJob` (lines 47-60 area).

2. Add an export of a per-strategy helper that reads from `price_snapshots`:

```ts
import { priceSnapshots } from "@trader/db";
import { and, asc, gte, inArray } from "drizzle-orm";

interface PriceBar { date: string; open: number; high: number; low: number; close: number; volume: number }
interface FetchResultLocal { [symbol: string]: { latest: number; bars: PriceBar[] } }

async function readSnapshotsForStrategy(
  db: any,
  symbols: string[],
  windowDays: number
): Promise<FetchResultLocal> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select()
    .from(priceSnapshots)
    .where(and(inArray(priceSnapshots.symbol, symbols), gte(priceSnapshots.date, since)))
    .orderBy(asc(priceSnapshots.date));

  const grouped: FetchResultLocal = {};
  for (const r of rows) {
    if (!grouped[r.symbol]) grouped[r.symbol] = { latest: 0, bars: [] };
    grouped[r.symbol].bars.push({
      date: r.date,
      open: parseFloat(r.open),
      high: parseFloat(r.high),
      low: parseFloat(r.low),
      close: parseFloat(r.close),
      volume: r.volume != null ? Number(r.volume) : 0,
    });
  }
  for (const sym of Object.keys(grouped)) {
    const bars = grouped[sym].bars;
    grouped[sym].latest = bars.length > 0 ? bars[bars.length - 1].close : 0;
  }
  return grouped;
}
```

3. In `processStrategy`, replace the prefetch lookup (the `if (prefetchedPrices[symbol]) ...` block) with:

```ts
const window = (strategy as any).analysisWindowDays ?? 60;
const prices = await readSnapshotsForStrategy(db, strategy.positions.map((p: any) => p.symbol), window);
```

4. Remove the `prices: priceSnapshots` field from the `monitoringRuns` update at the end of `processStrategy` (i.e. don't write `monitoringRuns.prices` anymore).

5. Add a fallback: if `prices` is empty for ALL symbols of the strategy, log a warning and call `fetchPrices(strategy.positions.map(p => p.symbol), \`${window}d\`)` once as a tide-over (for the rollout window). This stays in until removed in a later cleanup.

6. Add `export` to the existing `processStrategy` function declaration so the test can import it.

- [ ] **Step 4: Run tests**

```
cd apps/worker && npx vitest run src/monitoring/__tests__/job.test.ts
```

Expected: PASS.

- [ ] **Step 5: Make sure existing finnhub/alphavantage tests still pass**

```
cd apps/worker && npx vitest run
```

Expected: all green.

- [ ] **Step 6: Commit**

```
git add apps/worker/src/monitoring/job.ts apps/worker/src/monitoring/__tests__/job.test.ts
git commit -m "feat(worker): runMonitoringJob reads from price_snapshots"
```

---

## Phase 4 — Web queue + manual position APIs

### Task 9: pg-boss client singleton for web

**Files:**
- Create: `apps/web/lib/queue.ts`
- Modify: `apps/web/package.json` (if pg-boss not yet a dep)

- [ ] **Step 1: Check dep**

```
grep -q '"pg-boss"' apps/web/package.json && echo present || echo missing
```

If missing:

```
cd apps/web && npm install pg-boss
```

- [ ] **Step 2: Implement singleton**

`apps/web/lib/queue.ts`:

```ts
import PgBoss from "pg-boss";

let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const b = new PgBoss({ connectionString: url });
  await b.start();
  boss = b;
  return boss;
}
```

- [ ] **Step 3: Commit**

```
git add apps/web/lib/queue.ts apps/web/package.json apps/web/package-lock.json
git commit -m "feat(web): add pg-boss queue client"
```

---

### Task 10: `GET /api/positions/manual`

**Files:**
- Create: `apps/web/app/api/positions/manual/route.ts`
- Create: `apps/web/app/api/positions/manual/__tests__/route.test.ts`

- [ ] **Step 1: Failing test**

`apps/web/app/api/positions/manual/__tests__/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

const { findMany, snapshotSelect } = vi.hoisted(() => ({
  findMany: vi.fn(),
  snapshotSelect: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: { positions: { findMany } },
    select: snapshotSelect,
  },
}));

import { GET } from "../route";

function req() {
  return new Request("http://localhost/api/positions/manual");
}

describe("GET /api/positions/manual", () => {
  it("returns only NULL-strategy positions with latestPrice", async () => {
    findMany.mockResolvedValueOnce([
      {
        id: "p1", symbol: "AAPL", strategyId: null,
        positionLots: [{ id: "l1", shares: "10", costPrice: "150", lotDate: "2026-05-01", notes: null }],
      },
    ]);
    snapshotSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ close: "175.00" }]),
    });

    const res = await GET(req());
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      id: "p1", symbol: "AAPL", latestPrice: 175,
    });
  });

  it("returns latestPrice null when no snapshot", async () => {
    findMany.mockResolvedValueOnce([
      { id: "p2", symbol: "TSLA", strategyId: null,
        positionLots: [{ id: "l2", shares: "1", costPrice: "200", lotDate: "2026-05-01", notes: null }] },
    ]);
    snapshotSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    });

    const res = await GET(req());
    const data = await res.json();
    expect(data[0].latestPrice).toBeNull();
  });
});
```

- [ ] **Step 2: Run failing**

```
cd apps/web && npx vitest run app/api/positions/manual/__tests__/route.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/web/app/api/positions/manual/route.ts`:

```ts
export const dynamic = "force-dynamic";
import { eq, isNull, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions, priceSnapshots } from "@trader/db";

export async function GET(_request: Request) {
  const rows = await db.query.positions.findMany({
    where: isNull(positions.strategyId),
    with: { positionLots: true },
  });

  const result = await Promise.all(
    rows.map(async (p: any) => {
      const snap = await db
        .select({ close: priceSnapshots.close })
        .from(priceSnapshots)
        .where(eq(priceSnapshots.symbol, p.symbol))
        .orderBy(desc(priceSnapshots.date))
        .limit(1);

      const totalShares = p.positionLots.reduce((s: number, l: any) => s + parseFloat(l.shares), 0);
      const totalCost = p.positionLots.reduce(
        (s: number, l: any) => s + parseFloat(l.shares) * parseFloat(l.costPrice),
        0
      );
      const avgCost = totalShares > 0 ? totalCost / totalShares : 0;
      const latestPrice = snap[0]?.close != null ? parseFloat(snap[0].close) : null;

      return {
        id: p.id,
        symbol: p.symbol,
        totalShares: totalShares.toString(),
        avgCost: avgCost.toFixed(4),
        latestPrice,
        lots: p.positionLots.map((l: any) => ({
          id: l.id, shares: l.shares, costPrice: l.costPrice, lotDate: l.lotDate, notes: l.notes,
        })),
      };
    })
  );

  return Response.json(result);
}
```

- [ ] **Step 4: Run passes**

```
cd apps/web && npx vitest run app/api/positions/manual/__tests__/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add apps/web/app/api/positions/manual/route.ts apps/web/app/api/positions/manual/__tests__/route.test.ts
git commit -m "feat(api): GET /api/positions/manual"
```

---

### Task 11: `POST /api/positions/manual`

**Files:**
- Modify: `apps/web/app/api/positions/manual/route.ts`
- Modify: `apps/web/app/api/positions/manual/__tests__/route.test.ts`
- Modify: `apps/web/lib/position-service.ts` (extend to support null strategyId)

- [ ] **Step 1: Failing test**

Append to existing test file:

```ts
import { POST } from "../route";

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));
vi.mock("@/lib/queue", () => ({ getBoss: async () => ({ send: mockSend }) }));

const { mockUpsert } = vi.hoisted(() => ({ mockUpsert: vi.fn() }));
vi.mock("@/lib/position-service", () => ({ upsertPositionAndCreateLot: mockUpsert }));

describe("POST /api/positions/manual", () => {
  it("creates position with null strategyId, inserts lot, enqueues backfill", async () => {
    mockUpsert.mockResolvedValueOnce({ positionId: "p1", lot: { id: "l1" } });
    const res = await POST(new Request("http://localhost/api/positions/manual", {
      method: "POST",
      body: JSON.stringify({ symbol: "AAPL", shares: 5, costPrice: "170.50", lotDate: "2026-06-01" }),
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toEqual({ positionId: "p1", lotId: "l1" });
    expect(mockUpsert).toHaveBeenCalledWith(null, "AAPL", 5, "170.50", "2026-06-01", undefined);
    expect(mockSend).toHaveBeenCalledWith("manual-backfill", { symbol: "AAPL", fromDate: "2026-06-01" });
  });

  it("rejects future lotDate", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const res = await POST(new Request("http://localhost/api/positions/manual", {
      method: "POST",
      body: JSON.stringify({ symbol: "AAPL", shares: 1, costPrice: "1", lotDate: future }),
    }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run failing**

```
cd apps/web && npx vitest run app/api/positions/manual/__tests__/route.test.ts -t "POST /api/positions/manual"
```

Expected: FAIL.

- [ ] **Step 3: Update `upsertPositionAndCreateLot` to accept null strategyId**

In `apps/web/lib/position-service.ts:5-15`, change signature and where clause:

```ts
import { eq, and, isNull } from "drizzle-orm";
// ...
export async function upsertPositionAndCreateLot(
  strategyId: string | null,
  symbol: string,
  shares: number,
  costPrice: string,
  lotDate: string,
  notes?: string
) {
  const existing = await db.query.positions.findFirst({
    where: strategyId === null
      ? and(isNull(positions.strategyId), eq(positions.symbol, symbol))
      : and(eq(positions.strategyId, strategyId), eq(positions.symbol, symbol)),
  });
  // ... rest of existing logic
  // change the insert values too:
  // .values({ strategyId, symbol, referencePrice: costPrice })
  // strategyId is now string|null which is OK for drizzle insert
}
```

- [ ] **Step 4: Implement POST**

Append to `apps/web/app/api/positions/manual/route.ts`:

```ts
import { upsertPositionAndCreateLot } from "@/lib/position-service";
import { getBoss } from "@/lib/queue";

export async function POST(request: Request) {
  const body = await request.json();
  const { symbol, shares, costPrice, lotDate, notes } = body ?? {};

  if (typeof symbol !== "string" || symbol.trim() === "") {
    return Response.json({ error: "symbol required" }, { status: 400 });
  }
  if (typeof shares !== "number" || shares <= 0) {
    return Response.json({ error: "shares must be > 0" }, { status: 400 });
  }
  if (typeof costPrice !== "string" || parseFloat(costPrice) <= 0) {
    return Response.json({ error: "costPrice must be > 0" }, { status: 400 });
  }
  const today = new Date().toISOString().slice(0, 10);
  if (typeof lotDate !== "string" || lotDate > today) {
    return Response.json({ error: "lotDate must be on or before today" }, { status: 400 });
  }

  const { positionId, lot } = await upsertPositionAndCreateLot(
    null, symbol.trim(), shares, costPrice, lotDate, notes
  );

  const boss = await getBoss();
  await boss.send("manual-backfill", { symbol: symbol.trim(), fromDate: lotDate });

  return Response.json({ positionId, lotId: lot.id }, { status: 201 });
}
```

- [ ] **Step 5: Run tests pass**

```
cd apps/web && npx vitest run app/api/positions/manual/__tests__/route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```
git add apps/web/app/api/positions/manual/route.ts apps/web/app/api/positions/manual/__tests__/route.test.ts apps/web/lib/position-service.ts
git commit -m "feat(api): POST /api/positions/manual with backfill enqueue"
```

---

### Task 12: `DELETE` lot and position endpoints

**Files:**
- Create: `apps/web/app/api/positions/manual/lots/[lotId]/route.ts`
- Create: `apps/web/app/api/positions/manual/lots/[lotId]/__tests__/route.test.ts`
- Create: `apps/web/app/api/positions/manual/[positionId]/route.ts`
- Create: `apps/web/app/api/positions/manual/[positionId]/__tests__/route.test.ts`

- [ ] **Step 1: Failing tests for lot delete**

`apps/web/app/api/positions/manual/lots/[lotId]/__tests__/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  deleteLots: vi.fn(),
  countLots: vi.fn(),
  deletePos: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      positionLots: { findFirst: h.findFirst },
      positions: { findFirst: vi.fn() },
    },
    delete: vi.fn((table: any) => ({ where: vi.fn(async () => undefined) })),
    select: vi.fn(() => ({ from: vi.fn().mockReturnThis(), where: h.countLots })),
  },
}));

import { DELETE } from "../route";

describe("DELETE /api/positions/manual/lots/:lotId", () => {
  it("returns 404 if lot not on a NULL-strategy position", async () => {
    h.findFirst.mockResolvedValueOnce(null);
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ lotId: "l1" }) });
    expect(res.status).toBe(404);
  });

  it("deletes lot and reports remaining count", async () => {
    h.findFirst.mockResolvedValueOnce({ id: "l1", positionId: "p1", position: { strategyId: null } });
    h.countLots.mockResolvedValueOnce([{ count: 2 }]);
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ lotId: "l1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ deletedPosition: false });
  });

  it("deletes position when last lot removed", async () => {
    h.findFirst.mockResolvedValueOnce({ id: "l1", positionId: "p1", position: { strategyId: null } });
    h.countLots.mockResolvedValueOnce([{ count: 0 }]);
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ lotId: "l1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ deletedPosition: true });
  });
});
```

- [ ] **Step 2: Implement lot delete**

`apps/web/app/api/positions/manual/lots/[lotId]/route.ts`:

```ts
export const dynamic = "force-dynamic";
import { eq, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { positionLots, positions } from "@trader/db";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ lotId: string }> }
) {
  const { lotId } = await params;

  const lot = await db.query.positionLots.findFirst({
    where: eq(positionLots.id, lotId),
    with: { position: true },
  });

  if (!lot || (lot as any).position?.strategyId !== null) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  await db.delete(positionLots).where(eq(positionLots.id, lotId));

  const [{ count: remaining }] = await db
    .select({ count: count() })
    .from(positionLots)
    .where(eq(positionLots.positionId, (lot as any).positionId));

  if (Number(remaining) === 0) {
    await db.delete(positions).where(eq(positions.id, (lot as any).positionId));
    return Response.json({ deletedPosition: true });
  }
  return Response.json({ deletedPosition: false });
}
```

- [ ] **Step 3: Failing test for position delete**

`apps/web/app/api/positions/manual/[positionId]/__tests__/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ findFirst: vi.fn(), deleteWhere: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    query: { positions: { findFirst: h.findFirst } },
    delete: vi.fn(() => ({ where: h.deleteWhere })),
  },
}));

import { DELETE } from "../route";

describe("DELETE /api/positions/manual/:positionId", () => {
  it("404 when position has a strategy", async () => {
    h.findFirst.mockResolvedValueOnce({ id: "p1", strategyId: "s1" });
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ positionId: "p1" }) });
    expect(res.status).toBe(404);
  });

  it("deletes when strategyId is null", async () => {
    h.findFirst.mockResolvedValueOnce({ id: "p1", strategyId: null });
    h.deleteWhere.mockResolvedValueOnce(undefined);
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ positionId: "p1" }) });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 4: Implement position delete**

`apps/web/app/api/positions/manual/[positionId]/route.ts`:

```ts
export const dynamic = "force-dynamic";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions } from "@trader/db";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ positionId: string }> }
) {
  const { positionId } = await params;
  const pos = await db.query.positions.findFirst({ where: eq(positions.id, positionId) });
  if (!pos || pos.strategyId !== null) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  await db.delete(positions).where(eq(positions.id, positionId));
  return Response.json({ ok: true });
}
```

- [ ] **Step 5: Run all tests pass**

```
cd apps/web && npx vitest run app/api/positions/manual/
```

Expected: PASS.

- [ ] **Step 6: Commit**

```
git add apps/web/app/api/positions/manual/lots/ apps/web/app/api/positions/manual/[positionId]/
git commit -m "feat(api): DELETE manual lot and position"
```

---

## Phase 5 — Modified existing APIs

### Task 13: Rewrite `GET /api/positions/summary` to use `price_snapshots`

**Files:**
- Modify: `apps/web/app/api/positions/summary/route.ts`
- Modify: `apps/web/app/api/positions/summary/__tests__/route.test.ts` (create if missing)

- [ ] **Step 1: Failing test**

`apps/web/app/api/positions/summary/__tests__/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ findMany: vi.fn(), select: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    query: { positions: { findMany: h.findMany } },
    select: h.select,
  },
}));

import { GET } from "../route";

describe("GET /api/positions/summary", () => {
  it("aggregates strategy + manual positions; reads latest price from price_snapshots", async () => {
    h.findMany.mockResolvedValueOnce([
      { id: "p1", symbol: "AAPL", strategyId: "s1", positionLots: [{ shares: "10", costPrice: "100" }] },
      { id: "p2", symbol: "TSLA", strategyId: null,  positionLots: [{ shares: "5", costPrice: "200" }] },
    ]);
    h.select.mockReturnValueOnce({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { symbol: "AAPL", close: "120" },
        { symbol: "TSLA", close: "220" },
      ]),
    });

    const res = await GET();
    const data = await res.json();
    expect(data.totalCost).toBe(2000);          // 10*100 + 5*200
    expect(data.totalValue).toBe(2300);         // 10*120 + 5*220
    expect(data.absolutePnl).toBe(300);
  });
});
```

- [ ] **Step 2: Run failing**

```
cd apps/web && npx vitest run app/api/positions/summary/__tests__/route.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Rewrite endpoint**

`apps/web/app/api/positions/summary/route.ts`:

```ts
export const dynamic = "force-dynamic";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { priceSnapshots } from "@trader/db";

export async function GET() {
  const allPositions = await db.query.positions.findMany({ with: { positionLots: true } });

  const symbols = [...new Set(allPositions.map((p: any) => p.symbol))];
  const latest = symbols.length === 0
    ? []
    : await db
        .select({ symbol: priceSnapshots.symbol, close: priceSnapshots.close })
        .from(priceSnapshots)
        .where(sql`(${priceSnapshots.symbol}, ${priceSnapshots.date}) IN (
          SELECT symbol, MAX(date) FROM price_snapshots WHERE symbol IN ${inArray(priceSnapshots.symbol, symbols) as any}
          GROUP BY symbol
        )`);
  // simpler alternative if the SQL above is finicky: fetch each symbol latest individually (N small queries).
  const priceBySymbol: Record<string, number> = {};
  for (const r of latest as any[]) priceBySymbol[r.symbol] = parseFloat(r.close);

  let totalCost = 0, coveredCost = 0, totalValue = 0, coveredPositions = 0;
  const totalPositions = allPositions.length;
  for (const pos of allPositions as any[]) {
    if (pos.positionLots.length === 0) continue;
    const shares = pos.positionLots.reduce((s: number, l: any) => s + parseFloat(l.shares), 0);
    const cost = pos.positionLots.reduce((s: number, l: any) => s + parseFloat(l.shares) * parseFloat(l.costPrice), 0);
    totalCost += cost;
    const price = priceBySymbol[pos.symbol];
    if (price !== undefined) {
      coveredCost += cost;
      totalValue += shares * price;
      coveredPositions++;
    }
  }
  const absolutePnl = totalValue - coveredCost;
  const percentPnl = coveredCost > 0 ? (absolutePnl / coveredCost) * 100 : 0;

  return Response.json({
    totalCost: Math.round(totalCost * 100) / 100,
    totalValue: Math.round(totalValue * 100) / 100,
    absolutePnl: Math.round(absolutePnl * 100) / 100,
    percentPnl: Math.round(percentPnl * 10000) / 10000,
    coveredPositions,
    totalPositions,
  });
}
```

If the `IN (symbol, MAX(date))` SQL gets ugly with the drizzle helpers, fall back to N independent queries — one `SELECT close FROM price_snapshots WHERE symbol = ? ORDER BY date DESC LIMIT 1` per symbol.

- [ ] **Step 4: Run tests pass**

```
cd apps/web && npx vitest run app/api/positions/summary/__tests__/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add apps/web/app/api/positions/summary/
git commit -m "feat(api): summary reads from price_snapshots; includes manual positions"
```

---

### Task 14: Rewrite `GET /api/positions/history` to use `price_snapshots`

**Files:**
- Modify: `apps/web/app/api/positions/history/route.ts`
- Modify or create: `apps/web/app/api/positions/history/__tests__/route.test.ts`

- [ ] **Step 1: Failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ findMany: vi.fn(), select: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    query: { positions: { findMany: h.findMany } },
    select: h.select,
  },
}));

import { GET } from "../route";

describe("GET /api/positions/history", () => {
  it("computes daily percentPnl from price_snapshots over all positions", async () => {
    h.findMany.mockResolvedValueOnce([
      { id: "p1", symbol: "AAPL", strategyId: null,  positionLots: [{ shares: "10", costPrice: "100" }] },
    ]);
    h.select.mockReturnValueOnce({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([
        { symbol: "AAPL", date: "2026-06-01", close: "100" },
        { symbol: "AAPL", date: "2026-06-02", close: "110" },
      ]),
    });

    const res = await GET(new Request("http://localhost/api/positions/history?range=1m"));
    const data = await res.json();
    expect(data).toEqual([
      { date: "2026-06-01", percentPnl: 0 },
      { date: "2026-06-02", percentPnl: 10 },
    ]);
  });
});
```

- [ ] **Step 2: Run failing**

```
cd apps/web && npx vitest run app/api/positions/history/__tests__/route.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Rewrite endpoint**

`apps/web/app/api/positions/history/route.ts`:

```ts
export const dynamic = "force-dynamic";
import { and, asc, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { priceSnapshots } from "@trader/db";

function getCutoff(range: string): string | null {
  if (range === "all") return null;
  const d = new Date();
  d.setDate(d.getDate() - (range === "3m" ? 90 : 30));
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cutoff = getCutoff(searchParams.get("range") ?? "1m");

  const allPositions = await db.query.positions.findMany({ with: { positionLots: true } });

  // symbol → { shares, cost }  (cross all positions of all strategies + manual)
  const bySymbol = new Map<string, { shares: number; cost: number }>();
  for (const pos of allPositions as any[]) {
    if (pos.positionLots.length === 0) continue;
    const shares = pos.positionLots.reduce((s: number, l: any) => s + parseFloat(l.shares), 0);
    const cost = pos.positionLots.reduce((s: number, l: any) => s + parseFloat(l.shares) * parseFloat(l.costPrice), 0);
    const cur = bySymbol.get(pos.symbol) ?? { shares: 0, cost: 0 };
    cur.shares += shares;
    cur.cost += cost;
    bySymbol.set(pos.symbol, cur);
  }
  const symbols = [...bySymbol.keys()];
  if (symbols.length === 0) return Response.json([]);

  const where = cutoff
    ? and(inArray(priceSnapshots.symbol, symbols), gte(priceSnapshots.date, cutoff))
    : inArray(priceSnapshots.symbol, symbols);

  const rows = await db
    .select({ symbol: priceSnapshots.symbol, date: priceSnapshots.date, close: priceSnapshots.close })
    .from(priceSnapshots)
    .where(where)
    .orderBy(asc(priceSnapshots.date));

  // date → symbol → close
  const byDate = new Map<string, Map<string, number>>();
  for (const r of rows as any[]) {
    if (!byDate.has(r.date)) byDate.set(r.date, new Map());
    byDate.get(r.date)!.set(r.symbol, parseFloat(r.close));
  }

  const result: Array<{ date: string; percentPnl: number }> = [];
  for (const date of [...byDate.keys()].sort()) {
    const prices = byDate.get(date)!;
    let value = 0, cost = 0;
    for (const [symbol, agg] of bySymbol) {
      const px = prices.get(symbol);
      if (px === undefined) continue;
      value += agg.shares * px;
      cost += agg.cost;
    }
    if (cost === 0) continue;
    result.push({
      date,
      percentPnl: Math.round(((value - cost) / cost) * 10000) / 100,
    });
  }
  return Response.json(result);
}
```

- [ ] **Step 4: Run pass**

```
cd apps/web && npx vitest run app/api/positions/history/
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add apps/web/app/api/positions/history/
git commit -m "feat(api): history reads from price_snapshots; includes manual positions"
```

---

### Task 15: `GET /api/strategies` and `PUT /api/strategies/:id` for `analysisWindowDays`

**Files:**
- Modify: `apps/web/app/api/strategies/route.ts`
- Modify: `apps/web/app/api/strategies/[id]/route.ts`
- Modify: corresponding tests if they exist

- [ ] **Step 1: Inspect & extend GET to expose the field**

Open `apps/web/app/api/strategies/route.ts`. The findMany already returns the row including new column once schema includes it. Verify the response mapping (if any) preserves `analysisWindowDays`.

If there's an explicit pick/map, add `analysisWindowDays` to the projected fields.

- [ ] **Step 2: Extend PUT to accept analysisWindowDays**

In `apps/web/app/api/strategies/[id]/route.ts` PUT handler, accept the new field with validation:

```ts
const { name, content, script, symbols, analysisWindowDays } = body;
if (analysisWindowDays !== undefined &&
    (typeof analysisWindowDays !== "number" || !Number.isInteger(analysisWindowDays) || analysisWindowDays < 1)) {
  return Response.json({ error: "analysisWindowDays must be a positive integer" }, { status: 400 });
}

// build update set conditionally
const set: any = { updatedAt: new Date() };
if (name !== undefined) set.name = name;
if (content !== undefined) set.content = content;
if (script !== undefined) set.script = script;
if (symbols !== undefined) set.symbols = symbols;
if (analysisWindowDays !== undefined) set.analysisWindowDays = analysisWindowDays;
await db.update(strategies).set(set).where(eq(strategies.id, id));
```

(Adapt to the existing handler's structure.)

- [ ] **Step 3: Run existing strategies tests; verify still green**

```
cd apps/web && npx vitest run app/api/strategies/
```

- [ ] **Step 4: Commit**

```
git add apps/web/app/api/strategies/
git commit -m "feat(api): expose and update analysisWindowDays on strategies"
```

---

## Phase 6 — UI

### Task 16: Extract `<LotForm>` shared component

**Files:**
- Create: `apps/web/components/lot-form.tsx`
- Modify: `apps/web/app/strategies/[id]/page.tsx`

- [ ] **Step 1: Create component**

`apps/web/components/lot-form.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface LotFormValues {
  symbol: string;
  shares: string;
  costPrice: string;
  lotDate: string;
  notes: string;
}

interface Props {
  initial?: Partial<LotFormValues>;
  showSymbol?: boolean;        // strategy detail uses true; manual uses true. set false to hide for fixed-symbol use cases.
  symbolLocked?: boolean;
  submitLabel?: string;
  onSubmit: (values: LotFormValues) => Promise<void> | void;
  onCancel?: () => void;
}

export function LotForm({ initial, showSymbol = true, symbolLocked = false, submitLabel = "保存", onSubmit, onCancel }: Props) {
  const [values, setValues] = useState<LotFormValues>({
    symbol: initial?.symbol ?? "",
    shares: initial?.shares ?? "",
    costPrice: initial?.costPrice ?? "",
    lotDate: initial?.lotDate ?? new Date().toISOString().slice(0, 10),
    notes: initial?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);

  function set<K extends keyof LotFormValues>(k: K, v: LotFormValues[K]) {
    setValues((s) => ({ ...s, [k]: v }));
  }

  async function handleSubmit() {
    if (!values.symbol || !values.shares || !values.costPrice || !values.lotDate) return;
    setBusy(true);
    try {
      await onSubmit(values);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {showSymbol && (
            <div>
              <label className="text-xs text-muted-foreground">股票代码</label>
              <Input value={values.symbol} disabled={symbolLocked}
                onChange={(e) => set("symbol", e.target.value.toUpperCase())} placeholder="QQQ" />
            </div>
          )}
          <div>
            <label className="text-xs text-muted-foreground">股数</label>
            <Input type="number" step="0.0001" value={values.shares}
              onChange={(e) => set("shares", e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">成本价</label>
            <Input type="number" step="0.01" value={values.costPrice}
              onChange={(e) => set("costPrice", e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">建仓日期</label>
            <Input type="date" value={values.lotDate}
              onChange={(e) => set("lotDate", e.target.value)} />
          </div>
          <div className="col-span-1 md:col-span-2">
            <label className="text-xs text-muted-foreground">备注</label>
            <Input value={values.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <Button size="sm" onClick={handleSubmit} disabled={busy}>{submitLabel}</Button>
          {onCancel && <Button size="sm" variant="outline" onClick={onCancel}>取消</Button>}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Replace inline form on strategy detail page**

In `apps/web/app/strategies/[id]/page.tsx`, replace the JSX block at lines ~590-621 (the `{showAddLot && <Card>…</Card>}`) with:

```tsx
{showAddLot && (
  <LotForm
    initial={{ symbol: lotSymbol }}
    onSubmit={async (v) => {
      const res = await fetch(`/api/strategies/${id}/positions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: v.symbol,
          shares: parseFloat(v.shares),
          costPrice: v.costPrice,
          lotDate: v.lotDate,
          notes: v.notes || undefined,
        }),
      });
      if (res.ok) {
        setShowAddLot(false);
        await refresh();  // call existing refetch
      }
    }}
    onCancel={() => setShowAddLot(false)}
  />
)}
```

Also add `import { LotForm } from "@/components/lot-form";` at the top.

Remove the now-unused `lotSymbol`/`lotShares`/`lotPrice`/`lotDate`/`lotNotes` `useState`s and the old `handleAddLot` function — but keep whichever your refresh function is named (audit before removing).

- [ ] **Step 3: Manual smoke check**

```
cd apps/web && npm run dev
```

Open `/strategies/<some-id>`, click 新增批次, fill, save. Verify a lot appears.

- [ ] **Step 4: Commit**

```
git add apps/web/components/lot-form.tsx apps/web/app/strategies/[id]/page.tsx
git commit -m "refactor(web): extract <LotForm> shared component"
```

---

### Task 17: Add tab structure to `/positions` page

**Files:**
- Modify: `apps/web/app/positions/page.tsx`

- [ ] **Step 1: Add tab state + URL sync**

Refactor the page so the existing per-strategy list moves under a "策略持仓" tab and a placeholder "手动持仓" tab is added. Use `next/navigation`'s `useSearchParams` and `useRouter` to sync `?tab=`.

Pseudocode skeleton:

```tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
// (Verify which tabs primitive is in use; if absent, fall back to a basic two-button toggle.)

export default function PositionsPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const tab = sp.get("tab") === "manual" ? "manual" : "strategies";
  function setTab(next: "strategies" | "manual") {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    router.replace(url.pathname + "?" + url.searchParams.toString());
  }

  // ...existing summary + chart fetch...

  return (
    <div>
      {/* summary card */}
      {/* chart */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="strategies">策略持仓</TabsTrigger>
          <TabsTrigger value="manual">手动持仓</TabsTrigger>
        </TabsList>
        <TabsContent value="strategies">
          {/* existing per-strategy list */}
        </TabsContent>
        <TabsContent value="manual">
          {/* placeholder for now; Task 18 fills */}
          <p className="text-muted-foreground py-10 text-center">即将到来</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

If `@/components/ui/tabs` doesn't exist, scaffold it with Radix UI (already used in this project for Select):

```
cd apps/web && npm install @radix-ui/react-tabs
```

…and create `apps/web/components/ui/tabs.tsx` mirroring the Select pattern (a thin Radix wrapper).

- [ ] **Step 2: Verify in browser**

```
cd apps/web && npm run dev
```

Open `/positions`, confirm tabs render and URL updates. Refresh on `?tab=manual` keeps tab. Strategy positions list still works under its tab.

- [ ] **Step 3: Commit**

```
git add apps/web/app/positions/page.tsx apps/web/components/ui/tabs.tsx apps/web/package.json apps/web/package-lock.json
git commit -m "feat(web): add tabs to /positions page"
```

---

### Task 18: Manual positions tab content (list, add dialog, polling)

**Files:**
- Create: `apps/web/components/manual-positions-tab.tsx`
- Modify: `apps/web/app/positions/page.tsx`

- [ ] **Step 1: Implement tab component**

`apps/web/components/manual-positions-tab.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, Plus } from "lucide-react";
import { LotForm } from "@/components/lot-form";

interface ManualPosition {
  id: string; symbol: string; totalShares: string; avgCost: string;
  latestPrice: number | null;
  lots: Array<{ id: string; shares: string; costPrice: string; lotDate: string; notes: string | null }>;
}

export function ManualPositionsTab() {
  const [data, setData] = useState<ManualPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [pendingSymbols, setPendingSymbols] = useState<Set<string>>(new Set());

  async function load() {
    const res = await fetch("/api/positions/manual", { cache: "no-store" });
    const json = await res.json();
    setData(json);
    setLoading(false);
    // drop "loading" markers for symbols whose price arrived
    setPendingSymbols((prev) => {
      const next = new Set(prev);
      for (const p of json) if (p.latestPrice !== null) next.delete(p.symbol);
      return next;
    });
  }

  useEffect(() => { load(); }, []);

  // poll every 5s while any symbol is pending; max 60s (12 polls)
  useEffect(() => {
    if (pendingSymbols.size === 0) return;
    let polls = 0;
    const id = setInterval(() => {
      polls += 1;
      if (polls > 12) { clearInterval(id); return; }
      load();
    }, 5000);
    return () => clearInterval(id);
  }, [pendingSymbols.size]);

  async function handleAdd(v: any) {
    const res = await fetch("/api/positions/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: v.symbol, shares: parseFloat(v.shares),
        costPrice: v.costPrice, lotDate: v.lotDate, notes: v.notes || undefined,
      }),
    });
    if (!res.ok) return;
    setPendingSymbols((s) => new Set(s).add(v.symbol));
    setShowAdd(false);
    await load();
  }

  async function handleDeleteLot(lotId: string) {
    await fetch(`/api/positions/manual/lots/${lotId}`, { method: "DELETE" });
    await load();
  }

  async function handleDeletePosition(positionId: string) {
    await fetch(`/api/positions/manual/${positionId}`, { method: "DELETE" });
    await load();
  }

  if (loading) return <p className="text-muted-foreground py-10 text-center">加载中…</p>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowAdd(!showAdd)}>
          <Plus size={14} className="mr-1" /> 添加持仓
        </Button>
      </div>
      {showAdd && (
        <LotForm onSubmit={handleAdd} onCancel={() => setShowAdd(false)} />
      )}
      {data.length === 0 && !showAdd && (
        <p className="text-muted-foreground py-10 text-center">暂无手动持仓</p>
      )}
      {data.map((p) => {
        const totalShares = parseFloat(p.totalShares);
        const avg = parseFloat(p.avgCost);
        const cost = totalShares * avg;
        const value = p.latestPrice != null ? totalShares * p.latestPrice : null;
        const pnl = value != null ? value - cost : null;
        return (
          <Card key={p.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="font-medium">{p.symbol}</div>
                  <div className="text-xs text-muted-foreground">
                    {totalShares} 股 · 均价 ${avg.toFixed(2)}
                  </div>
                </div>
                <div className="text-right">
                  {p.latestPrice == null ? (
                    <span className="text-xs text-muted-foreground">价格加载中…</span>
                  ) : (
                    <>
                      <div className="tabular-nums">${p.latestPrice.toFixed(2)}</div>
                      <div className={`text-xs tabular-nums ${pnl! >= 0 ? "text-red-600" : "text-green-600"}`}>
                        {pnl! >= 0 ? "+" : ""}${pnl!.toFixed(2)} ({((pnl! / cost) * 100).toFixed(2)}%)
                      </div>
                    </>
                  )}
                </div>
                <Button variant="ghost" size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDeletePosition(p.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-3 space-y-1 text-xs">
                {p.lots.map((l) => (
                  <div key={l.id} className="flex justify-between">
                    <span>{l.lotDate} · {parseFloat(l.shares)} 股 · ${parseFloat(l.costPrice).toFixed(2)}</span>
                    <button onClick={() => handleDeleteLot(l.id)} className="text-muted-foreground hover:text-destructive">删除</button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Mount in tab**

In `apps/web/app/positions/page.tsx`, replace the placeholder under `<TabsContent value="manual">`:

```tsx
import { ManualPositionsTab } from "@/components/manual-positions-tab";
...
<TabsContent value="manual">
  <ManualPositionsTab />
</TabsContent>
```

- [ ] **Step 3: Smoke test**

```
cd apps/web && npm run dev
```

`/positions?tab=manual` → 添加 AAPL 5 股 @ $170 lotDate=今天 → 卡片即时出现并显示"价格加载中…" → 后台 manual-backfill 完成后 5s 内价格出现。

- [ ] **Step 4: Commit**

```
git add apps/web/components/manual-positions-tab.tsx apps/web/app/positions/page.tsx
git commit -m "feat(web): manual positions tab with add dialog and polling"
```

---

### Task 19: Add `analysisWindowDays` input to strategy edit page

**Files:**
- Modify: `apps/web/app/strategies/[id]/page.tsx` (or wherever the edit form lives)

- [ ] **Step 1: Locate the form**

```
grep -n "PUT\|edit\|analysis" apps/web/app/strategies/\[id\]/page.tsx | head
```

- [ ] **Step 2: Add the input**

In the strategy edit form (the section that submits `PUT /api/strategies/:id`), add after the existing `name` / `content` / `symbols` inputs:

```tsx
<div>
  <label className="text-xs text-muted-foreground">分析窗口(天)</label>
  <Input type="number" min={1} step={1}
    value={analysisWindowDays} onChange={(e) => setAnalysisWindowDays(parseInt(e.target.value, 10) || 60)} />
</div>
```

Add `const [analysisWindowDays, setAnalysisWindowDays] = useState<number>(60);` at the top, and seed it from the GET response when the strategy data loads. Include it in the PUT body.

- [ ] **Step 3: Smoke test**

Open a strategy edit page, change the value to 30, save, refresh — value persists. Trigger a monitoring run for that strategy and verify the LLM context length matches.

- [ ] **Step 4: Commit**

```
git add apps/web/app/strategies/[id]/page.tsx
git commit -m "feat(web): editable analysisWindowDays per strategy"
```

---

## Phase 7 — Migration

### Task 20: One-time backfill script

**Files:**
- Create: `scripts/backfill-price-snapshots.ts`

- [ ] **Step 1: Implement script**

`scripts/backfill-price-snapshots.ts`:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "@trader/db";
import { ensurePriceSnapshots } from "../apps/worker/src/monitoring/price-snapshots.js";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sqlClient = postgres(url, { max: 5 });
  const db = drizzle(sqlClient, { schema });

  // Symbol → earliest needed date
  const rows = await db.execute(sql`
    SELECT
      p.symbol,
      LEAST(
        (SELECT MIN(l.lot_date::date) FROM position_lots l JOIN positions q ON q.id = l.position_id WHERE q.symbol = p.symbol),
        (CURRENT_DATE - (COALESCE(MAX(s.analysis_window_days), 60) || ' days')::interval)::date
      ) AS from_date
    FROM positions p
    LEFT JOIN strategies s ON s.id = p.strategy_id
    GROUP BY p.symbol
  `);

  for (const r of rows as any[]) {
    const symbol = r.symbol as string;
    const fromDate = String(r.from_date).slice(0, 10);
    console.log(`[backfill] ${symbol} from ${fromDate}`);
    try {
      await ensurePriceSnapshots(db, symbol, fromDate);
    } catch (err) {
      console.error(`[backfill] ${symbol} failed:`, err instanceof Error ? err.message : err);
    }
  }

  await sqlClient.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

Add to root `package.json`:

```json
"scripts": {
  ...
  "backfill:prices": "tsx scripts/backfill-price-snapshots.ts"
}
```

(Install `tsx` as a dev dep if not present: `npm install -D tsx`.)

- [ ] **Step 3: Dry-run on staging**

```
DATABASE_URL=<staging-url> npm run backfill:prices
```

Verify rows landing in `price_snapshots`.

- [ ] **Step 4: Commit**

```
git add scripts/backfill-price-snapshots.ts package.json package-lock.json
git commit -m "feat(scripts): one-time price_snapshots backfill"
```

---

## Phase 8 — Final integration test

### Task 21: End-to-end smoke

- [ ] **Step 1: Bring up stack against a clean local DB**

```
docker-compose up -d postgres
cd packages/db && npm run db:push -- --force
DATABASE_URL=<local> npm run backfill:prices    # noop on empty DB
```

- [ ] **Step 2: Start worker and web**

```
npm run dev
```

- [ ] **Step 3: Manual flow**

1. Visit `/positions` — tabs render, default = 策略持仓.
2. Switch to 手动持仓 → 添加持仓 → AAPL, 5 股, $170, 今天 → 卡片显示"价格加载中".
3. Within ~30s, latestPrice appears (assuming Alpha Vantage quota healthy).
4. 总览 totalCost 增加 5×170;价格就位后 totalValue 也跟着加。
5. PnL 历史曲线在今天那个点反映含 AAPL 的总账户 PnL。
6. 删除单条 lot → 该 lot 消失;若是最后一条,position 整体消失。
7. 编辑某个策略,把 analysisWindowDays 改为 30 → 触发 monitoring run → 检查 LLM 上下文长度。

- [ ] **Step 4: Commit any small adjustments uncovered**

```
git status
# fix anything; commit per fix
```

---

## Self-review checklist

After implementation, re-run all test suites:

```
npm test                                    # all workspaces
```

Manually verify:

- `monitoringRuns.prices` not written by new code (grep for `prices: priceSnapshots` in `apps/worker/src/monitoring/job.ts` — should not exist).
- The strategy detail page lot form is replaced by `<LotForm>` (no duplicated form JSX).
- A manual position survives strategy deletion (CASCADE replaced by SET NULL): create position under strategy A, delete strategy A, see position appear in 手动持仓 tab.
- Two manual positions with the same symbol are forbidden (NULLS NOT DISTINCT works).

If anything fails, return to the relevant task instead of patching forward.
