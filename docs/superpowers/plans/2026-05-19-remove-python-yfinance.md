# Remove Python yfinance — Replace with yahoo-finance2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Python `yfinance` subprocess with the `yahoo-finance2` npm package, eliminating the Python runtime dependency.

**Architecture:** Rewrite `yahoo-fetch.ts` to call `yahoo-finance2`'s `chart()` method directly. The exported interface (`fetchPrices`, `FetchResult`, `PriceData`) stays identical, so `job.ts` and `analyze.ts` are untouched. Rewrite the test to mock `yahoo-finance2` instead of `child_process`. Delete `yahoo_fetch.py` and `requirements.txt`.

**Tech Stack:** yahoo-finance2 ^3.14.1, vitest, TypeScript

---

### Task 1: Install yahoo-finance2 and rewrite yahoo-fetch.ts

**Files:**
- Modify: `apps/worker/package.json` (add yahoo-finance2 dependency)
- Modify: `apps/worker/src/monitoring/yahoo-fetch.ts` (full rewrite)

- [ ] **Step 1: Install yahoo-finance2**

```bash
cd /Users/didi/code/trader && npm install yahoo-finance2 -w apps/worker
```

- [ ] **Step 2: Rewrite yahoo-fetch.ts**

Replace the entire content of `apps/worker/src/monitoring/yahoo-fetch.ts` with:

```typescript
import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();

export interface PriceData {
  latest: number;
  bars: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

export interface FetchResult {
  [symbol: string]: PriceData;
}

function periodToStartDate(period: string): Date {
  const match = period.match(/^(\d+)(d|wk|mo|y)$/);
  if (!match) return new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const now = Date.now();

  switch (unit) {
    case "d":
      return new Date(now - value * 24 * 60 * 60 * 1000);
    case "wk":
      return new Date(now - value * 7 * 24 * 60 * 60 * 1000);
    case "mo":
      return new Date(now - value * 30 * 24 * 60 * 60 * 1000);
    case "y":
      return new Date(now - value * 365 * 24 * 60 * 60 * 1000);
    default:
      return new Date(now - 60 * 24 * 60 * 60 * 1000);
  }
}

export async function fetchPrices(
  symbols: string[],
  period: string = "60d"
): Promise<FetchResult> {
  const result: FetchResult = {};
  const startDate = periodToStartDate(period);

  for (const symbol of symbols) {
    const chart = await yahooFinance.chart(symbol, {
      period1: startDate,
      period2: new Date(),
    });

    const quotes = chart.quotes.filter((q) => q.close != null);
    if (quotes.length === 0) {
      throw new Error(`No data returned for ${symbol}`);
    }

    const lastQuote = quotes[quotes.length - 1];
    result[symbol] = {
      latest: lastQuote.close!,
      bars: quotes.map((q) => ({
        date: q.date.toISOString().slice(0, 10),
        open: q.open ?? 0,
        high: q.high ?? 0,
        low: q.low ?? 0,
        close: q.close ?? 0,
        volume: q.volume ?? 0,
      })),
    };
  }

  return result;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/didi/code/trader/apps/worker && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/package.json apps/worker/package-lock.json apps/worker/src/monitoring/yahoo-fetch.ts
git commit -m "feat(worker): replace Python yfinance subprocess with yahoo-finance2 npm package"
```

---

### Task 2: Rewrite yahoo-fetch tests

**Files:**
- Modify: `apps/worker/src/monitoring/__tests__/yahoo-fetch.test.ts` (full rewrite)

- [ ] **Step 1: Rewrite the test file**

Replace the entire content of `apps/worker/src/monitoring/__tests__/yahoo-fetch.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChart = vi.fn();

vi.mock("yahoo-finance2", () => ({
  default: class {
    chart = mockChart;
  },
}));

import { fetchPrices } from "../yahoo-fetch.js";

function createMockChartResult(
  symbol: string,
  quotes: Array<{
    date: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
  }>
) {
  return {
    meta: {
      currency: "USD",
      symbol,
      exchangeName: "NMS",
      instrumentType: "EQUITY",
      firstTradeDate: null,
      regularMarketTime: new Date(),
      gmtoffset: -14400,
      timezone: "America/New_York",
      exchangeTimezoneName: "America/New_York",
      regularMarketPrice: quotes[quotes.length - 1]?.close ?? 0,
      priceHint: 2,
      currentTradingPeriod: { pre: {}, regular: {}, post: {} },
      dataGranularity: "1d",
      range: "60d",
      validRanges: ["1d", "5d", "60d"],
    },
    quotes: quotes.map((q) => ({
      date: new Date(q.date),
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume,
    })),
  };
}

describe("fetchPrices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed price data on success", async () => {
    mockChart.mockResolvedValue(
      createMockChartResult("QQQ", [
        { date: "2025-01-02", open: 180, high: 186, low: 179, close: 185.42, volume: 50000000 },
      ])
    );

    const result = await fetchPrices(["QQQ"]);

    expect(result.QQQ.latest).toBe(185.42);
    expect(result.QQQ.bars[0].date).toBe("2025-01-02");
    expect(result.QQQ.bars[0].close).toBe(185.42);
  });

  it("throws when no data returned for symbol", async () => {
    mockChart.mockResolvedValue(createMockChartResult("BAD", []));

    await expect(fetchPrices(["BAD"])).rejects.toThrow("No data returned for BAD");
  });

  it("throws on yahoo-finance2 error", async () => {
    mockChart.mockRejectedValue(new Error("yahoo-finance2 error"));

    await expect(fetchPrices(["QQQ"])).rejects.toThrow("yahoo-finance2 error");
  });

  it("filters out quotes with null close prices", async () => {
    mockChart.mockResolvedValue({
      meta: {
        currency: "USD",
        symbol: "QQQ",
        exchangeName: "NMS",
        instrumentType: "EQUITY",
        firstTradeDate: null,
        regularMarketTime: new Date(),
        gmtoffset: -14400,
        timezone: "America/New_York",
        exchangeTimezoneName: "America/New_York",
        regularMarketPrice: 185,
        priceHint: 2,
        currentTradingPeriod: { pre: {}, regular: {}, post: {} },
        dataGranularity: "1d",
        range: "60d",
        validRanges: ["1d"],
      },
      quotes: [
        { date: new Date("2025-01-01"), open: null, high: null, low: null, close: null, volume: null },
        { date: new Date("2025-01-02"), open: 180, high: 186, low: 179, close: 185, volume: 50000000 },
      ],
    });

    const result = await fetchPrices(["QQQ"]);

    expect(result.QQQ.bars.length).toBe(1);
    expect(result.QQQ.bars[0].close).toBe(185);
    expect(result.QQQ.latest).toBe(185);
  });

  it("passes period1 to chart based on period string", async () => {
    mockChart.mockResolvedValue(
      createMockChartResult("SPY", [
        { date: "2025-05-01", open: 500, high: 510, low: 498, close: 505, volume: 80000000 },
      ])
    );

    await fetchPrices(["SPY"], "30d");

    expect(mockChart).toHaveBeenCalledWith("SPY", expect.objectContaining({ period1: expect.any(Date) }));
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/didi/code/trader/apps/worker && npx vitest run src/monitoring/__tests__/yahoo-fetch.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/monitoring/__tests__/yahoo-fetch.test.ts
git commit -m "test(worker): rewrite yahoo-fetch tests to mock yahoo-finance2 instead of child_process"
```

---

### Task 3: Run full test suite and verify job/analyze tests still pass

**Files:** None modified (verification only)

- [ ] **Step 1: Run all worker tests**

```bash
cd /Users/didi/code/trader/apps/worker && npx vitest run
```

Expected: All tests pass (yahoo-fetch, analyze, job).

- [ ] **Step 2: Run full project tests**

```bash
cd /Users/didi/code/trader && npm test
```

Expected: All tests pass across all workspaces.

---

### Task 4: Delete Python files and clean up

**Files:**
- Delete: `apps/worker/yahoo_fetch.py`
- Delete: `requirements.txt` (root)

- [ ] **Step 1: Delete yahoo_fetch.py**

```bash
rm apps/worker/yahoo_fetch.py
```

- [ ] **Step 2: Delete root requirements.txt**

```bash
rm requirements.txt
```

- [ ] **Step 3: Verify no Python references remain**

```bash
grep -r "python3\|yfinance\|yahoo_fetch\.py\|pandas\|akshare" --include="*.ts" --include="*.js" --include="*.json" apps/ packages/ .
```

Expected: No matches (except possibly node_modules).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove Python runtime dependency (yahoo_fetch.py and requirements.txt)"
```
