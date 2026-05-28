# 参考价（Reference Price）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `reference_price` to the positions table, auto-initialize it from the first lot's cost price, let the LLM detect resets and write new values, and provide a manual PATCH API + inline UI edit.

**Architecture:** Single new nullable column on `positions`; `position-service.ts` sets it on first-lot creation; `analyze.ts` extended to output `reference_price_updates[]` in the structured tool response; `job.ts` applies those updates and creates notifications; a new PATCH route handles manual overrides; the strategy detail page shows the value inline with an edit button.

**Tech Stack:** Drizzle ORM (schema push), Vitest, Next.js API Routes, React state (inline edit)

---

## File Map

| Action | File |
|--------|------|
| Modify | `packages/db/src/schema.ts` |
| Modify | `packages/db/src/schema.test.ts` |
| Modify | `apps/web/lib/position-service.ts` |
| Modify | `apps/web/lib/__tests__/position-service.test.ts` |
| Modify | `apps/worker/src/monitoring/analyze.ts` |
| Modify | `apps/worker/src/monitoring/__tests__/analyze.test.ts` |
| Modify | `apps/worker/src/monitoring/job.ts` |
| Create | `apps/web/app/api/strategies/[id]/positions/[positionId]/reference-price/route.ts` |
| Create | `apps/web/app/api/strategies/[id]/positions/[positionId]/reference-price/__tests__/route.test.ts` |
| Modify | `apps/web/app/strategies/[id]/page.tsx` |

---

### Task 1: Schema — add `referencePrice` to positions

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/schema.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/db/src/schema.test.ts`, update the existing "positions table has required columns" test to also assert `referencePrice`:

```typescript
it("positions table has required columns", () => {
  const columns = Object.keys(positions);
  expect(columns).toContain("id");
  expect(columns).toContain("strategyId");
  expect(columns).toContain("symbol");
  expect(columns).toContain("createdAt");
  expect(columns).toContain("updatedAt");
  expect(columns).toContain("referencePrice");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/db && pnpm test
```

Expected: FAIL — `referencePrice` not found in positions columns.

- [ ] **Step 3: Add the column to schema**

In `packages/db/src/schema.ts`, add `referencePrice` to the `positions` table (after the `symbol` field):

```typescript
export const positions = pgTable(
  "positions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    strategyId: text("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    referencePrice: numeric("reference_price", { precision: 15, scale: 4 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("positions_strategy_id_symbol_idx").on(t.strategyId, t.symbol)]
);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/db && pnpm test
```

Expected: PASS

- [ ] **Step 5: Push schema to DB and rebuild**

```bash
pnpm --filter @trader/db db:push
```

Drizzle-kit will detect the new nullable column and show a confirmation prompt — type `y` to apply.

Then rebuild so the dist types are updated:

```bash
pnpm --filter @trader/db build
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/schema.test.ts packages/db/dist/
git commit -m "feat: add reference_price column to positions table"
```

---

### Task 2: position-service — initialize referencePrice on first lot

**Files:**
- Modify: `apps/web/lib/position-service.ts`
- Modify: `apps/web/lib/__tests__/position-service.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/web/lib/__tests__/position-service.test.ts`, add a new test inside `describe("upsertPositionAndCreateLot")`:

```typescript
it("sets referencePrice from costPrice when creating new position", async () => {
  (db.query.positions.findFirst as any).mockResolvedValueOnce(undefined);

  const posInsertValues = mockValues(mockReturning([{ id: "pos-ref" }]));
  const lotInsertValues = mockValues(mockReturning([
    { id: "lot-ref", positionId: "pos-ref", shares: 10, costPrice: "250.00", lotDate: "2025-03-01" },
  ]));

  let insertCallCount = 0;
  (db.insert as any).mockImplementation(() => {
    insertCallCount++;
    if (insertCallCount === 1) return posInsertValues;
    return lotInsertValues;
  });

  const posInsertValuesSpy = posInsertValues.values as ReturnType<typeof vi.fn>;

  await upsertPositionAndCreateLot("strat-1", "ISRG", 10, "250.00", "2025-03-01");

  expect(posInsertValuesSpy).toHaveBeenCalledWith(
    expect.objectContaining({ referencePrice: "250.00" })
  );
});

it("does not overwrite referencePrice when position already exists", async () => {
  (db.query.positions.findFirst as any).mockResolvedValueOnce({
    id: "pos-existing",
    strategyId: "strat-1",
    symbol: "ISRG",
    referencePrice: "200.00",
  });

  (db.update as any).mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValueOnce([{ id: "pos-existing" }]),
      }),
    }),
  });

  const lotInsertValues = mockValues(mockReturning([
    { id: "lot-3", positionId: "pos-existing", shares: 5, costPrice: "260.00", lotDate: "2025-04-01" },
  ]));
  (db.insert as any).mockReturnValue(lotInsertValues);

  // update should NOT include referencePrice
  await upsertPositionAndCreateLot("strat-1", "ISRG", 5, "260.00", "2025-04-01");

  const updateSetSpy = (db.update as any).mock.results[0].value.set as ReturnType<typeof vi.fn>;
  expect(updateSetSpy).toHaveBeenCalledWith(
    expect.not.objectContaining({ referencePrice: expect.anything() })
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && pnpm test
```

Expected: FAIL — `referencePrice` not passed to insert values.

- [ ] **Step 3: Update position-service to set referencePrice on new position**

Replace the `else` branch in `upsertPositionAndCreateLot` in `apps/web/lib/position-service.ts`:

```typescript
export async function upsertPositionAndCreateLot(
  strategyId: string,
  symbol: string,
  shares: number,
  costPrice: string,
  lotDate: string,
  notes?: string
) {
  const existing = await db.query.positions.findFirst({
    where: and(eq(positions.strategyId, strategyId), eq(positions.symbol, symbol)),
  });

  let positionId: string;

  if (existing) {
    positionId = existing.id;
    await db
      .update(positions)
      .set({ updatedAt: new Date() })
      .where(eq(positions.id, positionId));
  } else {
    const [pos] = await db
      .insert(positions)
      .values({ strategyId, symbol, referencePrice: costPrice })
      .returning();
    positionId = pos.id;
  }

  const [lot] = await db
    .insert(positionLots)
    .values({ positionId, shares, costPrice, lotDate, notes: notes ?? null })
    .returning();

  return { positionId, lot };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && pnpm test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/position-service.ts apps/web/lib/__tests__/position-service.test.ts
git commit -m "feat: initialize referencePrice from costPrice on first lot creation"
```

---

### Task 3: analyze.ts — extend tool schema, PositionInfo, AnalysisResult, and prompt

**Files:**
- Modify: `apps/worker/src/monitoring/analyze.ts`
- Modify: `apps/worker/src/monitoring/__tests__/analyze.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/worker/src/monitoring/__tests__/analyze.test.ts`, add the `makeToolUseResponse` helper's type and two new tests. First update the helper to accept the new field, then add the tests:

```typescript
function makeToolUseResponse(input: {
  analysis: string;
  has_action_items: boolean;
  action_summary?: string;
  reference_price_updates?: Array<{ symbol: string; new_reference_price: number }>;
}) {
  return {
    content: [
      {
        type: "tool_use",
        id: "toolu_456",
        name: "report_analysis",
        input,
      },
    ],
  };
}
```

Then add two new tests inside `describe("analyzeStrategy")`:

```typescript
it("returns referencePriceUpdates when LLM outputs them", async () => {
  const client = mockClient(
    makeToolUseResponse({
      analysis: "## Analysis\nISRG hit reset threshold.",
      has_action_items: false,
      reference_price_updates: [{ symbol: "ISRG", new_reference_price: 348.5 }],
    })
  );
  const analyze = createAnalyzer(client);

  const result = await analyze(
    "T1 Strategy",
    "Reset ref price when price >= ref * 1.15",
    [{ symbol: "ISRG", totalShares: 10, avgCost: 300, referencePrice: 300, lots: [] }],
    { ISRG: { latest: 348.5, bars: [] } }
  );

  expect(result.referencePriceUpdates).toEqual([
    { symbol: "ISRG", newReferencePrice: 348.5 },
  ]);
});

it("returns empty referencePriceUpdates when LLM omits the field", async () => {
  const client = mockClient(
    makeToolUseResponse({
      analysis: "## Analysis\nAll within range.",
      has_action_items: false,
    })
  );
  const analyze = createAnalyzer(client);

  const result = await analyze(
    "T1 Strategy",
    "Reset ref price when price >= ref * 1.15",
    [{ symbol: "ISRG", totalShares: 10, avgCost: 300, referencePrice: 300, lots: [] }],
    { ISRG: { latest: 310, bars: [] } }
  );

  expect(result.referencePriceUpdates).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/worker && pnpm test
```

Expected: FAIL — `referencePrice` not accepted by `PositionInfo`, `referencePriceUpdates` not on result.

- [ ] **Step 3: Update analyze.ts**

Replace the full contents of `apps/worker/src/monitoring/analyze.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";

const REPORT_TOOL_NAME = "report_analysis";

const reportToolSchema = {
  name: REPORT_TOOL_NAME,
  description: "Submit the analysis report for a trading strategy with positions",
  input_schema: {
    type: "object" as const,
    properties: {
      analysis: {
        type: "string" as const,
        description: "Full markdown analysis report of the strategy's current state",
      },
      has_action_items: {
        type: "boolean" as const,
        description: "Whether any action items (buy/sell/adjust) are recommended",
      },
      action_summary: {
        type: "string" as const,
        description: "Brief summary of recommended actions, if any",
      },
      reference_price_updates: {
        type: "array" as const,
        description: "List of reference price resets triggered by strategy rules",
        items: {
          type: "object" as const,
          properties: {
            symbol: { type: "string" as const, description: "Stock symbol" },
            new_reference_price: { type: "number" as const, description: "New reference price value" },
          },
          required: ["symbol", "new_reference_price"],
        },
      },
    },
    required: ["analysis", "has_action_items"],
  },
};

export interface AnalysisResult {
  analysis: string;
  hasActionItems: boolean;
  actionSummary?: string;
  referencePriceUpdates: Array<{ symbol: string; newReferencePrice: number }>;
}

export interface PositionInfo {
  symbol: string;
  totalShares: number;
  avgCost: number;
  referencePrice?: number | null;
  lots: Array<{ shares: number; costPrice: number; lotDate: string; notes?: string }>;
}

export function createAnalyzer(client?: Anthropic) {
  const anthropic = client ?? new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL,
  });

  return async function analyzeStrategy(
    strategyName: string,
    strategyContent: string,
    positions: PositionInfo[],
    prices: Record<string, { latest: number; bars: Array<{ date: string; close: number }> }>
  ): Promise<AnalysisResult> {
    const positionSummary = positions
      .map((p) => {
        const priceData = prices[p.symbol];
        const latestPrice = priceData?.latest;
        const pnl = latestPrice ? ((latestPrice - p.avgCost) / p.avgCost * 100).toFixed(2) : null;
        const refLabel = p.referencePrice != null ? `$${p.referencePrice.toFixed(2)}` : "无参考价";
        return `- ${p.symbol}: ${p.totalShares} shares @ avg $${p.avgCost.toFixed(2)}, ref ${refLabel}, latest $${latestPrice ?? "N/A"}, P&L ${pnl ?? "N/A"}%`;
      })
      .join("\n");

    const recentBars = Object.entries(prices)
      .map(([symbol, data]) => {
        const last10 = data.bars.slice(-10);
        return `${symbol} recent closes: ${last10.map((b) => `${b.date}: $${b.close}`).join(", ")}`;
      })
      .join("\n");

    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "glm-5.1",
      max_tokens: 4096,
      tools: [reportToolSchema],
      messages: [
        {
          role: "user",
          content: `请分析以下交易策略及其当前持仓情况，根据策略规则判断是否需要采取操作。请用中文输出分析报告。

## 策略：${strategyName}

${strategyContent}

## 当前持仓
${positionSummary}

## 近期价格数据
${recentBars}

请分析当前市场状况是否触发了策略规则（入场、出场、仓位调整、参考价重置），并给出你的判断。若参考价需要更新，请在 reference_price_updates 中输出新值。`,
        },
      ],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === REPORT_TOOL_NAME
    );

    if (!toolUse) {
      throw new Error("LLM did not return structured analysis result");
    }

    const input = toolUse.input as {
      analysis: string;
      has_action_items: boolean;
      action_summary?: string;
      reference_price_updates?: Array<{ symbol: string; new_reference_price: number }>;
    };

    return {
      analysis: input.analysis ?? "",
      hasActionItems: input.has_action_items ?? false,
      actionSummary: input.action_summary,
      referencePriceUpdates: (input.reference_price_updates ?? []).map((u) => ({
        symbol: u.symbol,
        newReferencePrice: u.new_reference_price,
      })),
    };
  };
}

export const analyzeStrategy = createAnalyzer();
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/worker && pnpm test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/monitoring/analyze.ts apps/worker/src/monitoring/__tests__/analyze.test.ts
git commit -m "feat: extend analyze tool schema with reference_price_updates output"
```

---

### Task 4: job.ts — pass referencePrice to LLM and apply updates

**Files:**
- Modify: `apps/worker/src/monitoring/job.ts`

- [ ] **Step 1: Write the failing test**

In `apps/worker/src/monitoring/__tests__/job.test.ts`, add a test that verifies `positions.update` is called when the analyze mock returns `referencePriceUpdates`. Replace the full test file:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runMonitoringJob } from "../job.js";

const mockFetchPrices = vi.fn().mockResolvedValue({
  QQQ: { latest: 185.0, bars: [{ date: "2025-05-01", close: 185.0, open: 183, high: 186, low: 182, volume: 50000000 }] },
});

vi.mock("../alphavantage-fetch.js", () => ({
  fetchPrices: mockFetchPrices,
}));

const mockAnalyze = vi.fn().mockResolvedValue({
  analysis: "## Report\nAll good",
  hasActionItems: false,
  referencePriceUpdates: [],
});

vi.mock("../analyze.js", () => ({
  createAnalyzer: () => mockAnalyze,
}));

vi.mock("@trader/db", () => ({
  strategies: {},
  positions: {},
  positionLots: {},
  monitoringRuns: {},
  notifications: {},
  eq: vi.fn(),
  and: vi.fn(),
}));

describe("runMonitoringJob", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips when no strategies with lots found", async () => {
    const mockDb = {
      query: {
        strategies: { findMany: vi.fn().mockResolvedValue([]) },
      },
      insert: vi.fn(),
      update: vi.fn(),
    } as any;

    await runMonitoringJob(mockDb);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("updates referencePrice in DB when LLM returns reference_price_updates", async () => {
    mockAnalyze.mockResolvedValueOnce({
      analysis: "ISRG hit reset threshold.",
      hasActionItems: false,
      referencePriceUpdates: [{ symbol: "ISRG", newReferencePrice: 348.5 }],
    });

    const whereChain = { returning: vi.fn().mockResolvedValue([{ id: "run-1" }]) };
    const setChain = { where: vi.fn().mockReturnValue(whereChain) };
    const updateChain = { set: vi.fn().mockReturnValue(setChain) };

    const insertReturning = vi.fn().mockResolvedValue([{ id: "run-1" }]);
    const insertWhere = { returning: insertReturning };
    const insertValues = { values: vi.fn().mockReturnValue(insertWhere) };

    const mockDb = {
      query: {
        strategies: {
          findMany: vi.fn().mockResolvedValue([
            { id: "strat-1", name: "T1", content: "ref reset at +15%", symbols: ["ISRG"] },
          ]),
        },
        positions: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "pos-1",
              symbol: "ISRG",
              referencePrice: "300.0000",
              positionLots: [{ shares: 10, costPrice: "300.00", lotDate: "2025-01-01", notes: null }],
            },
          ]),
        },
      },
      insert: vi.fn().mockReturnValue(insertValues),
      update: vi.fn().mockReturnValue(updateChain),
    } as any;

    await runMonitoringJob(mockDb);

    // update called at least twice: once for monitoringRun status, once for referencePrice
    const updateCalls = updateChain.set.mock.calls;
    const refPriceCall = updateCalls.find(
      (call: any[]) => call[0]?.referencePrice !== undefined
    );
    expect(refPriceCall).toBeDefined();
    expect(refPriceCall[0].referencePrice).toBe("348.5000");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/worker && pnpm test
```

Expected: FAIL — `referencePrice` update not called.

- [ ] **Step 3: Update job.ts**

Replace the full contents of `apps/worker/src/monitoring/job.ts`:

```typescript
import { eq, and } from "drizzle-orm";
import { strategies, positions, positionLots, monitoringRuns, notifications } from "@trader/db";
import { fetchPrices, type FetchResult } from "./alphavantage-fetch.js";
import { createAnalyzer, type PositionInfo } from "./analyze.js";
import type { drizzle } from "drizzle-orm/postgres-js";
import type * as schema from "@trader/db";
import pLimit from "p-limit";

type DbType = ReturnType<typeof drizzle<typeof schema>>;

const CONCURRENCY_LIMIT = 3;
const ANALYZE_MAX_ATTEMPTS = 3;
const ANALYZE_RETRY_BASE_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts: number, baseDelayMs: number, label: string): Promise<T> {
  let lastErr: Error = new Error("unknown");
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * attempt;
        console.warn(`[monitoring] ${label} attempt ${attempt}/${maxAttempts} failed: ${lastErr.message}, retrying in ${delay / 1000}s`);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

export async function runMonitoringJob(db: DbType, strategyId?: string) {
  const limit = pLimit(CONCURRENCY_LIMIT);
  const analyze = createAnalyzer();

  const strategiesWithLots = await findStrategiesWithLots(db, strategyId);

  if (strategiesWithLots.length === 0) {
    console.log("[monitoring] No strategies with lots found, skipping");
    return;
  }

  const allSymbols = [
    ...new Set(strategiesWithLots.flatMap((s) => s.positions.map((p) => p.symbol))),
  ];

  let allPrices: FetchResult = {};
  try {
    allPrices = await fetchPrices(allSymbols, "60d");
  } catch (err) {
    console.error("[monitoring] Failed to fetch prices:", err instanceof Error ? err.message : String(err));
  }

  const tasks = strategiesWithLots.map((strategy) =>
    limit(() => processStrategy(db, strategy, analyze, allPrices))
  );

  await Promise.allSettled(tasks);
}

interface StrategyWithLots {
  id: string;
  name: string;
  content: string;
  symbols: string[];
  positions: Array<{
    id: string;
    symbol: string;
    referencePrice: string | null;
    positionLots: Array<{
      shares: number;
      costPrice: string;
      lotDate: string;
      notes: string | null;
    }>;
  }>;
}

async function findStrategiesWithLots(db: DbType, strategyId?: string): Promise<StrategyWithLots[]> {
  const allStrategies = strategyId
    ? await db.query.strategies.findMany({ where: eq(strategies.id, strategyId) })
    : await db.query.strategies.findMany();

  const result: StrategyWithLots[] = [];

  for (const strategy of allStrategies) {
    const pos = await db.query.positions.findMany({
      where: eq(positions.strategyId, strategy.id),
      with: { positionLots: true },
    });

    const posWithLots = pos.filter((p) => p.positionLots.length > 0);
    if (posWithLots.length > 0) {
      result.push({
        id: strategy.id,
        name: strategy.name,
        content: strategy.content,
        symbols: (strategy.symbols as string[]) ?? [],
        positions: posWithLots.map((p) => ({
          id: p.id,
          symbol: p.symbol,
          referencePrice: p.referencePrice ?? null,
          positionLots: p.positionLots.map((l) => ({
            shares: l.shares,
            costPrice: l.costPrice,
            lotDate: l.lotDate,
            notes: l.notes,
          })),
        })),
      });
    }
  }

  return result;
}

async function processStrategy(
  db: DbType,
  strategy: StrategyWithLots,
  analyze: ReturnType<typeof createAnalyzer>,
  prefetchedPrices: FetchResult
) {
  const today = new Date().toISOString().slice(0, 10);

  const [run] = await db
    .insert(monitoringRuns)
    .values({
      strategyId: strategy.id,
      runDate: today,
      status: "pending",
    })
    .returning();

  try {
    const symbols = strategy.positions.map((p) => p.symbol);
    const prices: FetchResult = {};
    const missing: string[] = [];
    for (const symbol of symbols) {
      if (prefetchedPrices[symbol]) {
        prices[symbol] = prefetchedPrices[symbol];
      } else {
        missing.push(symbol);
      }
    }
    if (Object.keys(prices).length === 0) {
      throw new Error(`All symbols failed: ${missing.join(", ")}`);
    }
    if (missing.length > 0) {
      console.warn(`[monitoring] Strategy ${strategy.name}: missing prices for ${missing.join(", ")}`);
    }

    const positionInfos: PositionInfo[] = strategy.positions.map((p) => {
      const totalShares = p.positionLots.reduce((s, l) => s + l.shares, 0);
      const totalCost = p.positionLots.reduce(
        (s, l) => s + l.shares * parseFloat(l.costPrice),
        0
      );
      const avgCost = totalShares > 0 ? totalCost / totalShares : 0;

      return {
        symbol: p.symbol,
        totalShares,
        avgCost,
        referencePrice: p.referencePrice !== null ? parseFloat(p.referencePrice) : null,
        lots: p.positionLots.map((l) => ({
          shares: l.shares,
          costPrice: parseFloat(l.costPrice),
          lotDate: l.lotDate,
          notes: l.notes ?? undefined,
        })),
      };
    });

    const priceSnapshots: Record<string, number> = {};
    for (const [symbol, data] of Object.entries(prices)) {
      priceSnapshots[symbol] = data.latest;
    }

    const analysis = await withRetry(
      () => analyze(strategy.name, strategy.content, positionInfos, prices),
      ANALYZE_MAX_ATTEMPTS,
      ANALYZE_RETRY_BASE_MS,
      `analyze(${strategy.name})`
    );

    await db
      .update(monitoringRuns)
      .set({
        status: "completed",
        analysis: analysis.analysis,
        hasActionItems: analysis.hasActionItems,
        prices: priceSnapshots,
      })
      .where(eq(monitoringRuns.id, run.id));

    // Apply reference price updates
    const refPriceUpdates = analysis.referencePriceUpdates;
    for (const update of refPriceUpdates) {
      await db
        .update(positions)
        .set({ referencePrice: update.newReferencePrice.toFixed(4) })
        .where(and(
          eq(positions.strategyId, strategy.id),
          eq(positions.symbol, update.symbol)
        ));
      console.log(`[monitoring] Strategy ${strategy.name}: ${update.symbol} referencePrice updated to ${update.newReferencePrice}`);
    }

    const refPriceNote = refPriceUpdates.length > 0
      ? "\n\n**参考价变更：**\n" + refPriceUpdates.map((u) => `- ${u.symbol} 参考价已更新为 $${u.newReferencePrice.toFixed(2)}`).join("\n")
      : "";

    if (analysis.hasActionItems) {
      await db.insert(notifications).values({
        monitoringRunId: run.id,
        title: analysis.actionSummary ?? "Action required",
        content: (analysis.analysis.slice(0, 400) + refPriceNote).slice(0, 500),
        isRead: false,
      });
    } else if (refPriceUpdates.length > 0) {
      await db.insert(notifications).values({
        monitoringRunId: run.id,
        title: "参考价更新",
        content: refPriceNote.trim().slice(0, 500),
        isRead: false,
      });
    }

    console.log(`[monitoring] Strategy ${strategy.name}: completed, actionItems=${analysis.hasActionItems}, refPriceUpdates=${refPriceUpdates.length}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(monitoringRuns)
      .set({ status: "failed", error: message })
      .where(eq(monitoringRuns.id, run.id));
    console.error(`[monitoring] Strategy ${strategy.name}: failed - ${message}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/worker && pnpm test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/monitoring/job.ts apps/worker/src/monitoring/__tests__/job.test.ts
git commit -m "feat: pass referencePrice to LLM and apply reference_price_updates in job"
```

---

### Task 5: PATCH API — manual reference price override

**Files:**
- Create: `apps/web/app/api/strategies/[id]/positions/[positionId]/reference-price/route.ts`
- Create: `apps/web/app/api/strategies/[id]/positions/[positionId]/reference-price/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/api/strategies/[id]/positions/[positionId]/reference-price/__tests__/route.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPositionsFindFirst, mockPositionsUpdate } = vi.hoisted(() => ({
  mockPositionsFindFirst: vi.fn(),
  mockPositionsUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      positions: { findFirst: mockPositionsFindFirst },
    },
    update: mockPositionsUpdate,
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _type: "and", args }),
  eq: (col: unknown, val: unknown) => ({ _type: "eq", col, val }),
}));

vi.mock("@trader/db", () => ({
  positions: { id: "id", strategyId: "strategyId" },
}));

import { PATCH } from "../route";

function makeRequest(body: object, strategyId = "strat-1", positionId = "pos-1") {
  return {
    request: new Request(`http://localhost/api/strategies/${strategyId}/positions/${positionId}/reference-price`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: Promise.resolve({ id: strategyId, positionId }),
  };
}

describe("PATCH /api/strategies/[id]/positions/[positionId]/reference-price", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when referencePrice is missing", async () => {
    const { request, params } = makeRequest({});
    const res = await PATCH(request, { params });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("referencePrice") });
  });

  it("returns 404 when position not found", async () => {
    mockPositionsFindFirst.mockResolvedValueOnce(undefined);
    const { request, params } = makeRequest({ referencePrice: "350.00" });
    const res = await PATCH(request, { params });
    expect(res.status).toBe(404);
  });

  it("updates referencePrice and returns updated position", async () => {
    const existingPos = { id: "pos-1", strategyId: "strat-1", symbol: "ISRG", referencePrice: "300.00" };
    const updatedPos = { ...existingPos, referencePrice: "350.00" };

    mockPositionsFindFirst.mockResolvedValueOnce(existingPos);
    mockPositionsUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValueOnce([updatedPos]),
        }),
      }),
    });

    const { request, params } = makeRequest({ referencePrice: "350.00" });
    const res = await PATCH(request, { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ referencePrice: "350.00" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web && pnpm test
```

Expected: FAIL — route file does not exist.

- [ ] **Step 3: Create the route**

Create `apps/web/app/api/strategies/[id]/positions/[positionId]/reference-price/route.ts`:

```typescript
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions } from "@trader/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; positionId: string }> }
) {
  const { id: strategyId, positionId } = await params;
  const body = await request.json();
  const { referencePrice } = body as { referencePrice?: string };

  if (!referencePrice) {
    return Response.json(
      { error: "referencePrice is required" },
      { status: 400 }
    );
  }

  const existing = await db.query.positions.findFirst({
    where: and(eq(positions.id, positionId), eq(positions.strategyId, strategyId)),
  });

  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const [updated] = await db
    .update(positions)
    .set({ referencePrice })
    .where(eq(positions.id, positionId))
    .returning();

  return Response.json(updated);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && pnpm test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/strategies/[id]/positions/[positionId]/reference-price/
git commit -m "feat: add PATCH endpoint for manual reference price override"
```

---

### Task 6: UI — display and inline-edit referencePrice in strategy positions tab

**Files:**
- Modify: `apps/web/app/strategies/[id]/page.tsx`

- [ ] **Step 1: Add `referencePrice` to the `Position` interface**

In `apps/web/app/strategies/[id]/page.tsx`, update the `Position` interface (line ~25):

```typescript
interface Position {
  id: string;
  symbol: string;
  referencePrice: string | null;
  latestPrice: number | null;
  positionLots: Lot[];
}
```

- [ ] **Step 2: Add inline-edit state variables**

Inside `StrategyDetailPage`, after the existing state declarations, add:

```typescript
const [editingRefPriceId, setEditingRefPriceId] = useState<string | null>(null);
const [refPriceInput, setRefPriceInput] = useState("");
```

- [ ] **Step 3: Add the save handler**

Inside `StrategyDetailPage`, after `handleDeleteLot`:

```typescript
async function handleSaveRefPrice(positionId: string) {
  const trimmed = refPriceInput.trim();
  if (!trimmed) {
    setEditingRefPriceId(null);
    return;
  }
  await fetch(`/api/strategies/${id}/positions/${positionId}/reference-price`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ referencePrice: trimmed }),
  });
  setEditingRefPriceId(null);
  fetchPositions();
}
```

- [ ] **Step 4: Update the position card header to show referencePrice**

Inside the `{tab === "positions"}` block, in the position card header section, replace the existing header `<div>` that shows symbol/shares/avgCost and pnl (lines ~612–629) with:

```tsx
<div key={pos.id} className="rounded-lg border bg-card p-4">
  <div className="flex items-center justify-between flex-wrap gap-1 mb-3">
    <div className="flex items-center gap-2 flex-wrap">
      <span className="font-semibold">{pos.symbol}</span>
      <span className="text-sm text-muted-foreground">
        {formatShares(totalShares)} 股 @ ${avgCost.toFixed(2)}
      </span>
      <span className="text-xs text-muted-foreground flex items-center gap-1">
        参考价：
        {editingRefPriceId === pos.id ? (
          <>
            <input
              className="w-24 text-xs border-b border-primary bg-transparent outline-none tabular-nums"
              value={refPriceInput}
              autoFocus
              onChange={(e) => setRefPriceInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveRefPrice(pos.id);
                if (e.key === "Escape") setEditingRefPriceId(null);
              }}
            />
            <button
              className="text-primary hover:text-primary/80 text-xs"
              onClick={() => handleSaveRefPrice(pos.id)}
            >
              确认
            </button>
            <button
              className="text-muted-foreground hover:text-foreground text-xs"
              onClick={() => setEditingRefPriceId(null)}
            >
              取消
            </button>
          </>
        ) : (
          <>
            <span className="tabular-nums">
              {pos.referencePrice ? `$${parseFloat(pos.referencePrice).toFixed(2)}` : "未设定"}
            </span>
            <button
              aria-label="edit reference price"
              className="text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => {
                setRefPriceInput(pos.referencePrice ?? "");
                setEditingRefPriceId(pos.id);
              }}
            >
              <Edit2 size={11} />
            </button>
          </>
        )}
      </span>
    </div>
    {pos.latestPrice !== null ? (
      <span className={`text-sm font-medium ${pnlPositive ? "text-red-600" : "text-green-500"}`}>
        ${pos.latestPrice} &nbsp;
        <span className={`text-xs px-1.5 py-0.5 rounded ${pnlPositive ? "bg-red-50 text-red-700" : "bg-green-50 text-green-600"}`}>
          {pnlPositive ? "+" : ""}{pnl}%
        </span>
      </span>
    ) : (
      <span className="text-sm text-muted-foreground">--</span>
    )}
  </div>
  <div className="divide-y">
    {pos.positionLots.map((lot) => (
      <div key={lot.id} className="flex items-center justify-between py-2 first:pt-0 last:pb-0 hover:bg-muted/40 transition-colors">
        <div className="flex items-center gap-3 text-sm">
          <span className="tabular-nums">{lot.lotDate}</span>
          <span className="tabular-nums">{formatShares(lot.shares)}股</span>
          <span className="tabular-nums">${parseFloat(lot.costPrice).toFixed(2)}</span>
          {lot.notes && (
            <span className="text-muted-foreground text-xs">{lot.notes}</span>
          )}
        </div>
        <button
          className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
          onClick={() => handleDeleteLot(lot.id)}
        >
          <Trash2 size={13} />
        </button>
      </div>
    ))}
  </div>
</div>
```

- [ ] **Step 5: Verify the UI works in the browser**

Start the dev server:

```bash
cd apps/web && pnpm dev
```

Open a strategy with positions. Verify:
1. Each position shows "参考价: $xxx.xx" (or "未设定" for null)
2. Clicking the pencil icon opens inline edit
3. Entering a value and pressing Enter (or clicking "确认") calls the PATCH API and refreshes
4. Pressing Escape cancels without saving

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/strategies/[id]/page.tsx
git commit -m "feat: display and inline-edit referencePrice in strategy positions tab"
```
