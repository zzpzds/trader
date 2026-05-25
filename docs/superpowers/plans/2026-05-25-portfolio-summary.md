# Portfolio Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a summary card to the top of the positions page showing total portfolio cost, current market value, and P&L ($ and %).

**Architecture:** A new `GET /api/positions/summary` route queries all positions and the latest monitoring run per strategy in two DB calls, computes aggregates server-side, and returns a typed JSON response. The positions page fetches this endpoint in parallel with the existing strategy list fetch and renders a card with skeleton/error/empty states.

**Tech Stack:** Next.js App Router, Drizzle ORM, React useState/useEffect, Tailwind CSS, shadcn/ui Card.

---

## Files

- **Create:** `apps/web/app/api/positions/summary/route.ts` — API route
- **Create:** `apps/web/app/api/positions/summary/__tests__/route.test.ts` — API tests
- **Modify:** `apps/web/app/positions/page.tsx` — add summary card UI + parallel fetch

---

### Task 1: API route `/api/positions/summary`

**Files:**
- Create: `apps/web/app/api/positions/summary/__tests__/route.test.ts`
- Create: `apps/web/app/api/positions/summary/route.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/app/api/positions/summary/__tests__/route.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPositionsFindMany, mockRunsFindMany } = vi.hoisted(() => ({
  mockPositionsFindMany: vi.fn(),
  mockRunsFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      positions: { findMany: mockPositionsFindMany },
      monitoringRuns: { findMany: mockRunsFindMany },
    },
  },
}));

import { GET } from "../route";

const posQQQ = {
  id: "pos-1",
  strategyId: "strat-1",
  symbol: "QQQ",
  positionLots: [{ shares: 10, costPrice: "100.0000" }],
};

const runWithPrices = {
  id: "run-1",
  strategyId: "strat-1",
  prices: { QQQ: 120 },
  createdAt: new Date("2026-05-25T10:00:00Z"),
};

describe("GET /api/positions/summary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns zeros when no positions exist", async () => {
    mockPositionsFindMany.mockResolvedValueOnce([]);
    mockRunsFindMany.mockResolvedValueOnce([]);

    const res = await GET();
    const data = await res.json();

    expect(data).toEqual({
      totalCost: 0,
      totalValue: 0,
      absolutePnl: 0,
      percentPnl: 0,
      coveredPositions: 0,
      totalPositions: 0,
    });
  });

  it("calculates pnl for a position with a price", async () => {
    mockPositionsFindMany.mockResolvedValueOnce([posQQQ]);
    mockRunsFindMany.mockResolvedValueOnce([runWithPrices]);

    const res = await GET();
    const data = await res.json();

    expect(data.totalCost).toBe(1000);    // 10 * 100
    expect(data.totalValue).toBe(1200);   // 10 * 120
    expect(data.absolutePnl).toBe(200);   // 1200 - 1000
    expect(data.percentPnl).toBe(20);     // 200/1000 * 100
    expect(data.coveredPositions).toBe(1);
    expect(data.totalPositions).toBe(1);
  });

  it("includes cost of unpriced positions in totalCost but not in pnl", async () => {
    const posSPY = {
      id: "pos-2",
      strategyId: "strat-2",
      symbol: "SPY",
      positionLots: [{ shares: 5, costPrice: "200.0000" }],
    };

    mockPositionsFindMany.mockResolvedValueOnce([posQQQ, posSPY]);
    mockRunsFindMany.mockResolvedValueOnce([runWithPrices]); // strat-2 has no run

    const res = await GET();
    const data = await res.json();

    expect(data.totalCost).toBe(2000);  // 1000 + 1000
    expect(data.totalValue).toBe(1200); // only QQQ
    expect(data.coveredPositions).toBe(1);
    expect(data.totalPositions).toBe(2);
  });

  it("uses the latest monitoring run when multiple exist for a strategy", async () => {
    const olderRun = {
      id: "run-old",
      strategyId: "strat-1",
      prices: { QQQ: 90 },
      createdAt: new Date("2026-05-24T10:00:00Z"),
    };

    mockPositionsFindMany.mockResolvedValueOnce([posQQQ]);
    // newest first (route queries desc by createdAt)
    mockRunsFindMany.mockResolvedValueOnce([runWithPrices, olderRun]);

    const res = await GET();
    const data = await res.json();

    expect(data.totalValue).toBe(1200); // uses price 120 from latest run, not 90
  });

  it("skips positions with no lots", async () => {
    const emptyPos = { id: "pos-empty", strategyId: "strat-1", symbol: "TQQQ", positionLots: [] };

    mockPositionsFindMany.mockResolvedValueOnce([emptyPos]);
    mockRunsFindMany.mockResolvedValueOnce([runWithPrices]);

    const res = await GET();
    const data = await res.json();

    expect(data.totalCost).toBe(0);
    expect(data.totalPositions).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/web && node ../../node_modules/.bin/vitest run app/api/positions/summary/__tests__/route.test.ts
```

Expected: FAIL — `Cannot find module '../route'`

- [ ] **Step 3: Implement the route**

Create `apps/web/app/api/positions/summary/route.ts`:

```typescript
export const dynamic = "force-dynamic";
import { db } from "@/lib/db";

export async function GET() {
  const allPositions = await db.query.positions.findMany({
    with: { positionLots: true },
  });

  const allRuns = await db.query.monitoringRuns.findMany({
    orderBy: (r, { desc }) => [desc(r.createdAt)],
  });

  // Latest run per strategy (runs are already sorted newest-first)
  const latestPrices = new Map<string, Record<string, number>>();
  for (const run of allRuns) {
    if (!latestPrices.has(run.strategyId) && run.prices) {
      latestPrices.set(run.strategyId, run.prices as Record<string, number>);
    }
  }

  let totalCost = 0;
  let coveredCost = 0;
  let totalValue = 0;
  let coveredPositions = 0;
  const totalPositions = allPositions.length;

  for (const pos of allPositions) {
    const { positionLots, strategyId, symbol } = pos;
    if (positionLots.length === 0) continue;

    const shares = positionLots.reduce((s, l) => s + l.shares, 0);
    const cost = positionLots.reduce((s, l) => s + l.shares * parseFloat(l.costPrice), 0);
    totalCost += cost;

    const latestPrice = latestPrices.get(strategyId)?.[symbol];
    if (latestPrice !== undefined) {
      coveredCost += cost;
      totalValue += shares * latestPrice;
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

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/web && node ../../node_modules/.bin/vitest run app/api/positions/summary/__tests__/route.test.ts
```

Expected: 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/positions/summary/route.ts apps/web/app/api/positions/summary/__tests__/route.test.ts
git commit -m "feat(api): add GET /api/positions/summary endpoint"
```

---

### Task 2: Summary card on the positions page

**Files:**
- Modify: `apps/web/app/positions/page.tsx`

The current `page.tsx` is a `"use client"` component. It fetches strategies then loops to get each strategy's positions. We add a parallel fetch for the summary and render a card above the list.

- [ ] **Step 1: Add `SummaryData` interface and state to the page**

At the top of `apps/web/app/positions/page.tsx`, after the existing `StrategyPositions` interface, add:

```typescript
interface SummaryData {
  totalCost: number;
  totalValue: number;
  absolutePnl: number;
  percentPnl: number;
  coveredPositions: number;
  totalPositions: number;
}
```

Inside `PositionsPage()`, after the existing `const [data, setData] = useState<StrategyPositions[]>([]);` line, add:

```typescript
const [summary, setSummary] = useState<SummaryData | null>(null);
const [summaryLoading, setSummaryLoading] = useState(true);
const [summaryError, setSummaryError] = useState(false);
```

- [ ] **Step 2: Fetch summary in parallel with the existing data fetch**

The existing `useEffect` calls `fetchAll()`. Replace the entire `useEffect` with:

```typescript
useEffect(() => {
  async function fetchSummary() {
    try {
      const res = await fetch("/api/positions/summary");
      if (!res.ok) throw new Error("failed");
      setSummary(await res.json());
    } catch {
      setSummaryError(true);
    } finally {
      setSummaryLoading(false);
    }
  }

  async function fetchAll() {
    const res = await fetch("/api/strategies");
    const strategies = await res.json();

    const results: StrategyPositions[] = [];
    for (const s of strategies) {
      const posRes = await fetch(`/api/strategies/${s.id}/positions`);
      if (posRes.ok) {
        const positions = await posRes.json();
        if (positions.length > 0) {
          results.push({
            strategyId: s.id,
            strategyName: s.name,
            positions,
          });
        }
      }
    }
    setData(results);
  }

  fetchSummary();
  fetchAll();
}, []);
```

- [ ] **Step 3: Add the summary card to the JSX**

In the `return` block, replace:

```tsx
<h1 className="text-2xl font-bold mb-6">持仓管理</h1>
```

with:

```tsx
<h1 className="text-2xl font-bold mb-4">持仓管理</h1>

<Card className="mb-6">
  <CardContent className="p-4">
    <p className="text-sm font-medium text-muted-foreground mb-3">总持仓收益</p>
    {summaryLoading ? (
      <div className="h-10 bg-muted animate-pulse rounded" />
    ) : summaryError ? (
      <p className="text-sm text-muted-foreground">数据加载失败</p>
    ) : summary && summary.coveredPositions === 0 ? (
      <p className="text-sm text-muted-foreground">暂无价格数据</p>
    ) : summary ? (
      <div className="flex items-end gap-6 flex-wrap">
        <div>
          <p className="text-xs text-muted-foreground">总成本</p>
          <p className="text-base font-medium">
            ${summary.totalCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">当前市值</p>
          <p className="text-base font-medium">
            ${summary.totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">收益</p>
          <p className={`text-base font-semibold ${summary.absolutePnl >= 0 ? "text-red-600" : "text-green-600"}`}>
            {summary.absolutePnl >= 0 ? "+" : ""}${summary.absolutePnl.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}&nbsp;
            <span className="text-sm font-medium">
              {summary.absolutePnl >= 0 ? "+" : ""}{summary.percentPnl.toFixed(2)}%
            </span>
          </p>
        </div>
        {summary.coveredPositions < summary.totalPositions && (
          <p className="text-xs text-muted-foreground ml-auto self-end">
            基于 {summary.coveredPositions}/{summary.totalPositions} 个持仓的价格数据
          </p>
        )}
      </div>
    ) : null}
  </CardContent>
</Card>
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/positions/page.tsx
git commit -m "feat(positions): add total portfolio P&L summary card"
```
