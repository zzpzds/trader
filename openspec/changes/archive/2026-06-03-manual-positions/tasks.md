## 1. DB schema

- [x] 1.1 Add `analysis_window_days INTEGER NOT NULL DEFAULT 60` to `strategies` table in `packages/db/src/schema.ts`; add test asserting default = 60
- [x] 1.2 Make `positions.strategy_id` nullable, change FK to `ON DELETE SET NULL`, replace unique index with `(strategy_id, symbol) NULLS NOT DISTINCT`; add tests for NULL-strategy uniqueness and strategy-delete-preserves-positions behavior
- [x] 1.3 Create `price_snapshots(symbol, date, open, high, low, close, volume, fetched_at)` table with PK `(symbol, date)` and `(symbol, date DESC)` index; add upsert test
- [x] 1.4 `cd packages/db && npx drizzle-kit generate` and commit generated migration files

## 2. Worker price layer

- [x] 2.1 Create `apps/worker/src/monitoring/price-snapshots.ts` with `upsertSnapshots(db, FetchResult)` helper; cover with unit test mocking drizzle insert + onConflictDoUpdate
- [x] 2.2 Add `ensurePriceSnapshots(db, symbol, fromDate)` to same file: skip when existing min date ≤ fromDate, else compute daysBack and call `fetchPrices` then `upsertSnapshots`; cover both branches in tests
- [x] 2.3 In `apps/worker/src/monitoring/alphavantage-fetch.ts`, add `outputsize=full` when `periodToDays(period) > 100`; assert URL via fetch mock test
- [x] 2.4 Create `apps/worker/src/monitoring/price-refresh-job.ts` exporting `runPriceRefreshJob(db)` that aggregates DISTINCT symbols across positions, calls `fetchPrices(symbols, "5d")`, and `upsertSnapshots`; test empty-symbol short-circuit and happy path

## 3. Worker queues

- [x] 3.1 In `apps/worker/src/worker.ts`, register `daily-price-refresh` queue with cron `0 1 * * *` UTC (before existing daily-monitoring)
- [x] 3.2 In same file, register `manual-backfill` queue with handler that calls `ensurePriceSnapshots(db, payload.symbol, payload.fromDate)`

## 4. Monitoring decoupling

- [x] 4.1 In `apps/worker/src/monitoring/job.ts`, remove the global `fetchPrices(allSymbols, "60d")` block in `runMonitoringJob`; remove `prefetchedPrices` parameter from `processStrategy` plumbing
- [x] 4.2 Add `readSnapshotsForStrategy(db, symbols, windowDays)` that queries `price_snapshots` and returns `{ [symbol]: { latest, bars[] } }` shape compatible with `analyze()`
- [x] 4.3 In `processStrategy`, read `strategy.analysisWindowDays ?? 60`, call `readSnapshotsForStrategy`, pass result to `analyze()`; export `processStrategy` so tests can drive it
- [x] 4.4 Stop writing `prices` field on `monitoringRuns.update`; add inline-`fetchPrices` fallback only when snapshot result is fully empty (transition guard, removed in later cleanup change)
- [x] 4.5 Add unit test asserting `fetchPrices` is NOT called when snapshots cover the window; add second test for the empty-fallback path

## 5. Web queue client + manual position APIs

- [x] 5.1 If `pg-boss` not in `apps/web/package.json` deps, `cd apps/web && npm install pg-boss`
- [x] 5.2 Create `apps/web/lib/queue.ts` with `getBoss()` singleton (lazy init, calls `boss.start()` once)
- [x] 5.3 Create `apps/web/app/api/positions/manual/route.ts` GET handler returning `strategy_id IS NULL` positions with `latestPrice` from `price_snapshots`; cover with test (positions with snapshot vs without)
- [x] 5.4 Update `apps/web/lib/position-service.ts:upsertPositionAndCreateLot` to accept `strategyId: string | null` and use `isNull(positions.strategyId)` in the existing-position lookup when null
- [x] 5.5 Add POST handler to manual route: validate inputs (symbol/shares/costPrice/lotDate, reject future date), call `upsertPositionAndCreateLot(null, …)`, `boss.send("manual-backfill", { symbol, fromDate: lotDate })`, return `201 { positionId, lotId }`; cover happy path + future-date rejection in tests
- [x] 5.6 Create `apps/web/app/api/positions/manual/lots/[lotId]/route.ts` DELETE: 404 unless lot belongs to a NULL-strategy position, delete the lot, also delete position if last lot removed; cover all three branches in tests
- [x] 5.7 Create `apps/web/app/api/positions/manual/[positionId]/route.ts` DELETE: 404 unless `strategy_id IS NULL`, else cascade-delete via existing FK; cover both branches in tests

## 6. Existing API rewrites

- [x] 6.1 Rewrite `apps/web/app/api/positions/summary/route.ts` to read latest price per symbol from `price_snapshots` (not `monitoringRuns.prices`); aggregate strategy + manual cost/value; add test covering combined aggregation
- [x] 6.2 Rewrite `apps/web/app/api/positions/history/route.ts` to aggregate by-symbol cost basis and read date series from `price_snapshots` (drop `monitoringRuns` query); add test verifying combined timeline includes manual positions
- [x] 6.3 Update `apps/web/app/api/strategies/route.ts` and `apps/web/app/api/strategies/[id]/route.ts` PUT handler to expose/accept `analysisWindowDays` (validate as positive integer)

## 7. UI: shared LotForm and tabs

- [x] 7.1 Extract `<LotForm>` to `apps/web/components/lot-form.tsx` with props `{ initial, showSymbol, symbolLocked, submitLabel, onSubmit, onCancel }`
- [x] 7.2 Replace inline lot form in `apps/web/app/strategies/[id]/page.tsx` with `<LotForm>`; remove the now-unused local lot* state and `handleAddLot` helper; verify dev-server smoke test
- [x] 7.3 If `@/components/ui/tabs` does not exist, install `@radix-ui/react-tabs` and scaffold a thin Radix wrapper in `apps/web/components/ui/tabs.tsx` matching the existing `select.tsx` pattern
- [x] 7.4 Refactor `apps/web/app/positions/page.tsx`: keep summary card and PnL chart at top; wrap existing per-strategy list in `<TabsContent value="strategies">`; add empty `<TabsContent value="manual">`; URL-sync `?tab=` via `useSearchParams`/`router.replace`

## 8. UI: manual positions tab

- [x] 8.1 Create `apps/web/components/manual-positions-tab.tsx` component: fetches `/api/positions/manual`, renders cards with avg cost / latest price / PnL, `+ 添加持仓` opens `<LotForm>`, supports lot delete and position delete
- [x] 8.2 Add 5s polling (max 12 polls = 60s) when any manual position has `latestPrice === null`; stop polling when all prices arrive
- [x] 8.3 Mount `<ManualPositionsTab />` inside `<TabsContent value="manual">` on `/positions/page.tsx`

## 9. Strategy edit page

- [x] 9.1 In `apps/web/app/strategies/[id]/page.tsx` (or whichever file owns the strategy edit form), add a number input bound to `analysisWindowDays` state, seeded from GET response, included in PUT body; smoke-test: change to 30, save, refresh, value persists

## 10. Migration script

- [x] 10.1 Create `scripts/backfill-price-snapshots.ts` that for each existing `positions.symbol` computes `fromDate = MIN( MIN(lot.lotDate), today − MAX(strategies.analysis_window_days for that symbol) )` and calls `ensurePriceSnapshots`; tolerate per-symbol failures
- [x] 10.2 Add `"backfill:prices": "tsx scripts/backfill-price-snapshots.ts"` to root `package.json` and add `tsx` as dev dep if missing
- [x] 10.3 Run script against staging DB, verify rows land in `price_snapshots`

## 11. Integration smoke

- [x] 11.1 Run `npm test` across all workspaces; everything green
- [x] 11.2 Local end-to-end: bring up Postgres + worker + web, push schema, add manual AAPL position, observe price-loading state, observe latest price arrive within ~30s, verify total summary includes manual contribution, verify PnL chart includes manual contribution, delete last lot and confirm position removed
- [x] 11.3 Strategy-deletion safety: create position under a strategy, delete the strategy, verify the position appears in the manual tab with original lots intact
