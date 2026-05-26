## 1. Dependencies

- [ ] 1.1 Add `recharts ^2.15.0` to `apps/web/package.json` and run install

## 2. Portfolio P&L Summary API

- [ ] 2.1 Create `apps/web/app/api/positions/summary/route.ts` — `GET /api/positions/summary` returning `{ totalCost, totalValue, absolutePnl, percentPnl, coveredPositions, totalPositions }`
- [ ] 2.2 Write unit tests at `apps/web/app/api/positions/summary/__tests__/route.test.ts` covering: zero positions, single position with price, partial coverage, latest-run selection, empty lots

## 3. Portfolio History API

- [ ] 3.1 Write failing tests at `apps/web/app/api/positions/history/__tests__/route.test.ts` covering: empty result, daily percentPnl aggregation, range filtering (1m/3m/all), skip dates with zero coverage
- [ ] 3.2 Implement `apps/web/app/api/positions/history/route.ts` — query completed runs by date range, group by runDate, pick latest run per strategy per date, aggregate coveredValue/coveredCost, return `[{ date, percentPnl }]` sorted ascending
- [ ] 3.3 Run tests and confirm all pass

## 4. Strategy History API

- [ ] 4.1 Write failing tests at `apps/web/app/api/strategies/[id]/history/__tests__/route.test.ts` covering: empty result, single-strategy aggregation, range filtering, skip zero-coverage dates
- [ ] 4.2 Implement `apps/web/app/api/strategies/[id]/history/route.ts` — same logic as portfolio history but filtered to a single strategyId
- [ ] 4.3 Run tests and confirm all pass

## 5. PnlChart Component

- [ ] 5.1 Create `apps/web/components/pnl-chart.tsx` as a `"use client"` component with props `{ fetchUrl: string }`
- [ ] 5.2 Implement range state (`1m` | `3m` | `all`, default `1m`) with toggle buttons at top-right
- [ ] 5.3 Implement data fetch on mount and range change via `fetchUrl?range=<range>`
- [ ] 5.4 Implement loading skeleton, empty state「暂无数据」, and Recharts `ResponsiveContainer > LineChart` with X-axis (MM/DD), Y-axis (% suffix), and hover Tooltip (YYYY-MM-DD + ±X.XX%)
- [ ] 5.5 Set line color `#dc2626` (red) when last data point `percentPnl >= 0`, `#16a34a` (green) otherwise

## 6. Positions Page Integration

- [ ] 6.1 Add portfolio summary card to `apps/web/app/positions/page.tsx` (fetch `/api/positions/summary`, display total cost / value / P&L with loading/error/empty states)
- [ ] 6.2 Insert `<PnlChart fetchUrl="/api/positions/history" />` immediately after the summary card in `apps/web/app/positions/page.tsx`

## 7. Strategy Detail Page Integration

- [ ] 7.1 Insert `<PnlChart fetchUrl={`/api/strategies/${strategy.id}/history`} />` at the top of the `tab === "positions"` branch in `apps/web/app/strategies/[id]/page.tsx`, before the position cards
