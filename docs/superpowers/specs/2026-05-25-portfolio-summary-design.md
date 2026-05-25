# Portfolio Summary Design

**Date:** 2026-05-25
**Scope:** Positions page — total portfolio P&L summary card

## Summary

Add a summary card at the top of the positions management page showing total portfolio cost basis, current market value, absolute P&L ($), and percentage P&L (%) aggregated across all strategies.

## UI

The summary card is inserted between the "持仓管理" heading and the strategy position list. It loads independently from the position list (parallel fetch), showing a skeleton while data is in flight.

```
┌─────────────────────────────────────────────────┐
│  总持仓收益                                       │
│                                                   │
│  总成本        当前市值        收益               │
│  $12,500       $13,200         +$700  +5.60%     │
│                                                   │
│                          基于 3/4 个持仓的价格数据 │
└─────────────────────────────────────────────────┘
```

- Profit is red, loss is green (Chinese market convention, consistent with rest of page)
- When `coveredPositions < totalPositions`, a gray subtitle shows "基于 N/M 个持仓的价格数据"
- When `coveredPositions === 0`, card shows "暂无价格数据"
- Skeleton replaces the card content until the API responds

## API

### `GET /api/positions/summary`

No parameters. Queries all strategies with positions in a single server-side pass.

**Response:**

```json
{
  "totalCost": 12500.00,
  "totalValue": 13200.00,
  "absolutePnl": 700.00,
  "percentPnl": 5.60,
  "coveredPositions": 3,
  "totalPositions": 4
}
```

**Field definitions:**

| Field | Description |
|-------|-------------|
| `totalCost` | Sum of `shares × avgCost` across all positions (all positions included) |
| `totalValue` | Sum of `shares × latestPrice` for positions that have a price |
| `absolutePnl` | `totalValue − costOfCoveredPositions` (cost of priced positions only) |
| `percentPnl` | `absolutePnl / costOfCoveredPositions × 100` |
| `coveredPositions` | Number of positions with a latestPrice |
| `totalPositions` | Total number of positions across all strategies |

**Price source:** Each strategy's latest `monitoringRuns.prices` JSON field, same as the existing `/api/strategies/[id]/positions` route.

**avgCost per position:** `sum(lot.shares × lot.costPrice) / sum(lot.shares)` across all lots.

## Data Flow

1. Positions page mounts → fires two parallel fetches:
   - `GET /api/positions/summary` → populates summary card
   - `GET /api/strategies` + per-strategy positions (existing) → populates list
2. Summary card shows skeleton until its fetch resolves
3. If summary fetch fails, card shows "数据加载失败" without blocking the list

## Files Changed

- `apps/web/app/api/positions/summary/route.ts` — new API route
- `apps/web/app/positions/page.tsx` — add summary card UI and parallel fetch

## Out of Scope

- Per-strategy breakdown in the summary card
- Historical P&L tracking
- Currency other than USD
