# Manual Positions Design

**Date:** 2026-06-02
**Scope:** Track and manage non-strategy positions ("手动持仓") alongside strategy positions; decouple price data from monitoring runs.

## Summary

Today every position must belong to a strategy. Users want to record ad-hoc buys (e.g. a stock bought without a defined strategy) and still see holdings, latest price, and P&L (current and historical) — but without LLM analysis or notifications. This spec adds "手动持仓" by making `positions.strategyId` nullable, introduces a unified time-series price store (`price_snapshots`), and decouples price fetching from `monitoringRuns` so manual positions and strategy positions share one price pipeline.

Out of scope:
- AI monitoring / notifications for manual positions (explicitly excluded).
- "Promote 手动持仓 to a strategy" UI (data model supports it, UI deferred).
- Final removal of `monitoringRuns.prices` (kept for one release cycle for safety).
- Sell-side accounting beyond the existing "delete lot" semantic.

## UX

### `/positions` page layout

Top of page (cross-tab, account-level) is unchanged in concept but its data sources change (see API):

```
┌── 总览卡片 ──────────────────────────┐
│  总成本   总市值   绝对 PnL   相对 PnL │
└─────────────────────────────────────┘
┌── PnL 历史曲线 ──────────────────────┐
│  含策略 + 手动持仓                    │
└─────────────────────────────────────┘

[ 策略持仓 ] [ 手动持仓 ]   ← Tabs (URL: ?tab=manual)
─────────────────────────────────────
{ 当前 tab 内容 }
```

- 总览卡片与曲线**始终展示账户级别**(策略 + 手动合并),与 tab 切换无关。
- Tab 状态写入 URL search param `?tab=strategies | manual`(默认 `strategies`),刷新与分享链接保留状态。
- 切 tab 不重新拉 summary/history,只切换下方列表数据源。

### 「策略持仓」tab

按策略分组的卡片列表,完全沿用今天的实现。

### 「手动持仓」tab

- 卡片列表:每张卡片 = 一个 symbol(`positions(strategyId IS NULL, symbol)`)。
- 卡片正文:合并 shares、avg cost、最新价、绝对/相对 PnL;展开后看 lots(沿用现有 lot 列表组件)。
- 右上角 `+ 添加持仓` 按钮 → 弹窗:symbol 输入 + 单 lot 表单(shares / cost price / lot date / notes)。本次将 strategy 详情页里现有的 lot 表单**抽取为共享组件 `<LotForm>`**(props: `onSubmit(values)`、`disabled` 等),策略详情页与「手动持仓」tab 都用它。
- 提交后立即显示新卡片,价格字段为 `null` 时渲染"价格加载中…",轮询 `GET /api/positions/manual` 直至最新价就位(轮询逻辑限定在该卡片组件内)。
- 删除粒度:删单条 lot;若该 position 无 lot 残留,同步删除 position。

## Data model

### Schema changes

```sql
-- 1. positions.strategy_id 改 nullable,FK 改 ON DELETE SET NULL
ALTER TABLE positions
  ALTER COLUMN strategy_id DROP NOT NULL;
ALTER TABLE positions
  DROP CONSTRAINT positions_strategy_id_fkey,
  ADD CONSTRAINT positions_strategy_id_fkey
    FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE SET NULL;

-- 2. 唯一索引允许 (NULL, symbol) 也唯一(Postgres 15+)
DROP INDEX positions_strategy_id_symbol_idx;
CREATE UNIQUE INDEX positions_strategy_id_symbol_idx
  ON positions (strategy_id, symbol) NULLS NOT DISTINCT;

-- 3. 新表 price_snapshots(OHLCV 时间序列,统一价格数据源)
CREATE TABLE price_snapshots (
  symbol      TEXT NOT NULL,
  date        DATE NOT NULL,
  open        NUMERIC(15, 4) NOT NULL,
  high        NUMERIC(15, 4) NOT NULL,
  low         NUMERIC(15, 4) NOT NULL,
  close       NUMERIC(15, 4) NOT NULL,
  volume      BIGINT,
  fetched_at  TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, date)
);
CREATE INDEX price_snapshots_symbol_date_desc_idx
  ON price_snapshots (symbol, date DESC);

-- 4. strategies 加 analysis 窗口(LLM 分析窗口可配置,默认 60)
ALTER TABLE strategies
  ADD COLUMN analysis_window_days INTEGER NOT NULL DEFAULT 60;
```

### Decisions and trade-offs

- **`strategy_id` nullable + `ON DELETE SET NULL`** — 删策略不丢真金白银的 lots,自动降级为手动持仓。代价:用户若想"清空一个策略包括其持仓"得多一步手动删除。
- **`NULLS NOT DISTINCT`** 需要 Postgres 15+(部署环境已确认满足)。同一 symbol 在手动持仓里只能一行,自动合并 lot,行为与策略持仓一致。
- **`price_snapshots` 取代旧的"按 strategyId 索引价格"思路** — 一个 symbol 一条时间序列,所有持仓共享。`monitoringRuns.prices` 字段保留(用于回滚兜底与未迁移的旧数据可读),但**不再**作为 summary/history 的数据源。
- **不引入 `manual_positions` 单独表** — 避免双表 UNION,复用现有 lots 行为。

## API

### New endpoints

#### `GET /api/positions/manual`

返回 `strategyId IS NULL` 的全部 positions,每条带最新价(`SELECT close FROM price_snapshots WHERE symbol = ? ORDER BY date DESC LIMIT 1`)与 lots。最新价缺失时返回 `latestPrice: null`,前端据此渲染"价格加载中"。

**Response:**

```json
[
  {
    "id": "pos_abc",
    "symbol": "AAPL",
    "totalShares": "10.0000",
    "avgCost": "180.50",
    "latestPrice": 195.30,
    "lots": [
      { "id": "lot_1", "shares": "10.0000", "costPrice": "180.50", "lotDate": "2026-04-15", "notes": null }
    ]
  }
]
```

#### `POST /api/positions/manual`

**Request:** `{ symbol, shares, costPrice, lotDate, notes? }`

流程:
1. Upsert `positions(strategyId=NULL, symbol)`(借助 `NULLS NOT DISTINCT` 保证唯一)。
2. Insert `position_lots(...)`。
3. `boss.send("manual-backfill", { symbol, fromDate: lotDate })`(异步)。
4. 立即返回 `201 { positionId, lotId }`。前端通过 `GET /api/positions/manual` 返回的 `latestPrice === null` 判定"加载中"——不引入冗余的 `priceStatus` 字段。

校验:`lotDate` > 今天 → 400;`shares` ≤ 0 或 `costPrice` ≤ 0 → 400;symbol 必填且 trim 后非空。

#### `DELETE /api/positions/manual/lots/:lotId`

删除指定 lot;若所属 position 无 lot 残留,事务内同步删 position(返回 `{ deletedPosition: true }`)。

#### `DELETE /api/positions/manual/:positionId`

整条删除该 position 与其全部 lots(级联)。仅当 `strategyId IS NULL` 时允许;否则 404。

### Changed endpoints

- **`GET /api/positions/summary`**: 数据源从 `monitoringRuns.prices` 切到 `price_snapshots`(每 symbol 取最新一行 close)。**包含**手动持仓的 cost 与 value。删除按 `strategyId` 取价的所有逻辑。
- **`GET /api/positions/history`**: 重写,数据源切 `price_snapshots`。按 `date` 分组,跨所有持仓累加 cost/value,产出曲线。手动持仓与策略持仓视为一致。
- **`GET /api/strategies`**: 返回新增字段 `analysisWindowDays`。
- **`PUT /api/strategies/:id`**: 接受 `analysisWindowDays`(integer ≥ 1)。策略编辑页表单加一个数字输入,默认 60。

### Unchanged endpoints

- `GET /api/strategies/:id/positions`:已经按 `strategyId` 过滤,手动持仓自动不出现,无需改动。

## Worker layer

### `daily-price-refresh` 队列(新)

- Cron: `0 1 * * *` UTC(早于 `daily-monitoring` 的 02:00,确保价格先就位)。
- 流程:
  1. `SELECT DISTINCT p.symbol FROM positions p JOIN position_lots l ON l.position_id = p.id`(策略 + 手动一并取)。
  2. `fetchPrices(symbols, "5d")`(冗余 5 天处理周末/节假/补抓失败日)。
  3. 对每个 `{ symbol, bars[] }`,逐日 `INSERT … ON CONFLICT (symbol, date) DO UPDATE` upsert 进 `price_snapshots`。
- 容错:单 symbol 失败不阻塞其它(`Promise.allSettled`),整 job 仍标记 completed,失败项记录 warning 日志,下次 cron 自然续抓。

### `manual-backfill` 队列(新,事件驱动)

- 触发:`POST /api/positions/manual` 调 `boss.send`。
- Handler:`ensurePriceSnapshots(symbol, fromDate)`(见下)。
- 重试:pg-boss 默认重试 3 次;3 次仍失败 → 卡片维持"价格不可用",每日 `daily-price-refresh` 接管补抓。

### `ensurePriceSnapshots(symbol, fromDate)` helper

新文件 `apps/worker/src/monitoring/price-snapshots.ts`:

```ts
export async function ensurePriceSnapshots(
  db: DbType,
  symbol: string,
  fromDate: string  // 'YYYY-MM-DD'
): Promise<void> {
  const existing = await db
    .select({ minDate: min(priceSnapshots.date) })
    .from(priceSnapshots)
    .where(eq(priceSnapshots.symbol, symbol));

  const existingMin = existing[0]?.minDate;
  if (existingMin && existingMin <= fromDate) return;

  const daysBack = Math.ceil(
    (Date.now() - new Date(fromDate).getTime()) / 86_400_000
  ) + 1;
  const result = await fetchPrices([symbol], `${daysBack}d`);
  await upsertSnapshots(db, result);  // 复用 5.1 的 upsert 子例程
}
```

`fetchPrices` 内部按 `daysBack > 100` 切 Alpha Vantage `outputsize=full`(单点改动,本 spec 一并交付)。

### `runMonitoringJob` 改造

删去 `job.ts` 开头的全局 `fetchPrices(allSymbols, "60d")` 与 `prefetchedPrices` 传递。每个策略处理时:

```ts
const window = strategy.analysisWindowDays ?? 60;
const since = isoDateNDaysAgo(window);

const rows = await db
  .select()
  .from(priceSnapshots)
  .where(and(
    inArray(priceSnapshots.symbol, strategySymbols),
    gte(priceSnapshots.date, since),
  ))
  .orderBy(asc(priceSnapshots.date));

const fetchResult = regroupAsFetchResult(rows);
// fetchResult: { [symbol]: { latest: 最新一行 close, bars: 全部行 OHLCV } }

const analysis = await analyze(strategy.name, strategy.content, positionInfos, fetchResult);
```

- 不再写 `monitoringRuns.prices`(字段保留,值留 null)。
- 完整性校验:某 symbol 在窗口内的 snapshot 数 < 期望天数 × 0.6 → 记 warning,但不阻塞 LLM 分析。
- 过渡期回退:若 `price_snapshots` 表对该 symbol 完全为空(罕见,迁移异常或新数据未刷入),回退到现行的 in-line `fetchPrices`。该回退路径在生产稳定 1-2 周后删除。

## Migration

部署顺序:

1. 跑 schema 迁移(§Data model 全部 ALTER/CREATE)。
2. 跑一次性 backfill 脚本:对每个现存的 `positions.symbol`,backfill 起点 = `MIN( MIN(lots.lotDate for that symbol), today − MAX(analysisWindowDays across all strategies that hold this symbol) )`,即取「最早 lot 日期」与「最长分析窗口起点」中**更早的一个**;backfill 终点 = 今天。预期耗时数十分钟(取决于 symbol 数 × Alpha Vantage 限速),在维护窗口内执行。
3. 启动新 worker(包含 `daily-price-refresh` 与 `manual-backfill` 注册)。
4. 部署新 web(暴露手动持仓 UI 与 API)。

## Testing

### Drizzle / DB(packages/db)

- `(strategy_id, symbol) NULLS NOT DISTINCT`:同一 NULL strategy + 同一 symbol 第二次插入冲突。
- `ON DELETE SET NULL`:删策略后该策略 positions 行仍在,strategyId 变 NULL,lots 完整。

### Worker

- `ensurePriceSnapshots`:存量已覆盖 → 不调 `fetchPrices`;部分覆盖 → 拉到指定 fromDate;空表 → 拉满 fromDate→today。fetcher mock。
- `daily-price-refresh`:多 symbol 中一个 fetcher 抛错 → 其它 upsert 成功,job 不失败;同日重跑 → upsert 后写覆盖,无副作用。
- `runMonitoringJob` 改造:从 `price_snapshots` 重组 `FetchResult` 喂 `analyze()`;不同策略各自取 `analysisWindowDays`;断言 `monitoringRuns` update 的 set 不含 `prices` 字段。

### Web API

- `POST /api/positions/manual`:upsert + lot 插入 + `boss.send` 调用断言;返回 `{ positionId, lotId }`;非法输入 400。
- `GET /api/positions/manual`:返回 `strategyId IS NULL` 的 positions,latestPrice 来自 `price_snapshots` 最新一行;snapshot 缺失时 latestPrice 为 null。
- `GET /api/positions/summary` 与 `/history`:数据源切换后仍正确;新加手动 lot → 立刻进 totalCost,价格就位后进 totalValue;曲线包含手动持仓贡献。
- `DELETE /api/positions/manual/lots/:lotId`:删 lot;无残留 lot 时同步删 position;有残留时保留。
- `GET /api/strategies/:id/positions`:strategyId IS NULL 的 position 不出现在任何策略的列表里。

### E2E 烟雾

`/positions` 两 tab 切换;在「手动持仓」添加 AAPL → 卡片即时出现(latestPrice 加载中)→ backfill 完成后价格出现 → 总览卡片 totalValue 增长。

## Edge cases

| 场景 | 行为 |
|---|---|
| Lot 日期 > 今天 | API 拒绝 400 |
| Lot 日期早于 5 年(超长 backfill) | 接受,`fetchPrices` 走 `outputsize=full`,日志 INFO 提醒 "deep backfill" |
| 同一 symbol 同时存在策略持仓和手动持仓 | 两行(`(strat-A, AAPL)` 与 `(NULL, AAPL)`),summary 都计入,两个 tab 各自展示 |
| 删除策略时该策略下持仓变手动 | 用户在「手动持仓」tab 看到孤儿 lots,可继续持有或删除 |
| Backfill 任务失败(provider 限速 / 网络) | pg-boss 重试 3 次;仍失败 → 卡片"价格不可用",`daily-price-refresh` 自然续命 |
| 周末/节假日 | bars 自然没有,UI 显示上一交易日 close;summary/history 不补 0 |
| 同一日重跑 `daily-price-refresh` | upsert 冲突 → 后写覆盖,无副作用 |
| `analysisWindowDays` 调大,price_snapshots 不够深 | warning 日志;monitoring 仍用现有数据;下次 `daily-price-refresh` 不会自动加深(由后续手动迁移补) |

## Rollback

每一步均可单独回滚:

- Schema 变更(strategy_id nullable / NULLS NOT DISTINCT / price_snapshots / analysis_window_days)均有对应 down migration。
- 不引入 feature flag,但 `runMonitoringJob` 内部对 `price_snapshots` 缺失时回退到现行 `fetchPrices` 在线拉取(过渡期保留 1-2 周后删)。
- `monitoringRuns.prices` 字段保留至少 1 个发布周期再清理。
