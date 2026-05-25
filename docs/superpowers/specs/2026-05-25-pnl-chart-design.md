# P&L Rate Chart Design

**Date:** 2026-05-25
**Scope:** Shared chart component + two API endpoints + two page integrations

## Summary

Add a P&L rate (%) line chart in two places:
1. Positions management page — below the portfolio summary card, shows portfolio-wide P&L history
2. Strategy detail page — top of the 持仓 tab, shows per-strategy P&L history

## Chart Component

**File:** `apps/web/components/pnl-chart.tsx`

A shared `PnlChart` React client component.

**Props:**
```typescript
interface PnlChartProps {
  fetchUrl: string;  // e.g. "/api/positions/history" or "/api/strategies/[id]/history"
}
```

The component owns its own data fetching and range state. When `range` changes, it re-fetches.

**Behavior:**
- Three range toggle buttons at top-right: `1M` | `3M` | `全部`, default `1M`
- Fetches `{fetchUrl}?range=1m|3m|all` on mount and when range changes
- Shows skeleton while loading
- Shows "暂无数据" when response is empty array
- Renders a Recharts `ResponsiveContainer > LineChart` when data is available
- X-axis: `runDate` values, formatted as `MM/DD`, ticks auto-spaced
- Y-axis: `percentPnl` values with `%` suffix, auto-scaled
- Line color: `#dc2626` (red) when last data point `percentPnl >= 0`, `#16a34a` (green) when `< 0`
- Tooltip: shows full date (`YYYY-MM-DD`) and `+X.XX%` / `-X.XX%`
- No legend (single line, self-explanatory)

## API

### `GET /api/positions/history`

**Query params:** `range` — `1m` (default) | `3m` | `all`

**Logic:**
1. Load all positions with lots → compute cost basis per position: `{ positionId, strategyId, symbol, shares, costBasis }`
2. Compute date cutoff from `range` (today − 30d / 90d / no limit)
3. Query `monitoringRuns` where `status = 'completed'` and `runDate >= cutoff`, ordered by `runDate ASC`
4. Group runs by `runDate`. For each date, pick the latest run per strategy (highest `createdAt`)
5. For each date:
   - For each position, look up its strategy's run prices → `latestPrice = prices[symbol]`
   - `coveredValue += shares × latestPrice` (only if price exists)
   - `coveredCost += costBasis` (only if price exists)
6. Skip dates where `coveredCost === 0`
7. `percentPnl = (coveredValue - coveredCost) / coveredCost × 100`, rounded to 2dp

**Response:**
```json
[
  { "date": "2026-05-01", "percentPnl": 3.45 },
  { "date": "2026-05-02", "percentPnl": 3.89 }
]
```

### `GET /api/strategies/[id]/history`

**Query params:** `range` — `1m` (default) | `3m` | `all`

**Logic:**
1. Load positions with lots for this strategy → cost basis per position
2. Compute date cutoff
3. Query `monitoringRuns` for this `strategyId` where `status = 'completed'` and `runDate >= cutoff`, ordered by `runDate ASC`
4. For each run (one per date, already filtered by strategyId):
   - For each position, look up `prices[symbol]`
   - Aggregate `coveredValue` and `coveredCost` same as above
5. Skip dates where `coveredCost === 0`
6. Same `percentPnl` formula

**Response:** same shape as above.

## Page Integrations

### Positions page (`apps/web/app/positions/page.tsx`)

Insert `<PnlChart fetchUrl="/api/positions/history" />` immediately after the existing summary `<Card>` and before the strategy list.

### Strategy detail page (`apps/web/app/strategies/[id]/page.tsx`)

In the `tab === "positions"` branch (currently line 291), insert `<PnlChart fetchUrl={`/api/strategies/${strategy.id}/history`} />` at the top, before the position cards.

## Dependencies

Add `recharts` to `apps/web/package.json`. Version `^2.15.0` (stable, React 19 compatible).

## Files Changed

| File | Change |
|------|--------|
| `apps/web/components/pnl-chart.tsx` | Create — shared chart component |
| `apps/web/app/api/positions/history/route.ts` | Create — portfolio history API |
| `apps/web/app/api/strategies/[id]/history/route.ts` | Create — per-strategy history API |
| `apps/web/app/positions/page.tsx` | Modify — insert PnlChart after summary card |
| `apps/web/app/strategies/[id]/page.tsx` | Modify — insert PnlChart at top of positions tab |
| `apps/web/package.json` | Modify — add recharts dependency |

## Out of Scope

- Absolute dollar P&L chart (only percentage)
- Comparing multiple strategies on the same chart
- Storing historical position snapshots (uses current lots × historical prices)
- Chart export or sharing
