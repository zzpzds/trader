## Requirements

### Requirement: Unified price_snapshots time-series store
系统 SHALL 维护一张 `price_snapshots(symbol, date, open, high, low, close, volume, fetched_at)` 表,以 `(symbol, date)` 为主键,作为账户级唯一价格数据源。

#### Scenario: Upsert preserves uniqueness on (symbol, date)
- **WHEN** 同一个 `(symbol, date)` 被两次写入
- **THEN** 后一次写入覆盖前一次的 OHLCV 与 `fetched_at`,表中始终只保留一条该 `(symbol, date)` 行

#### Scenario: Latest price lookup
- **WHEN** 任何下游(summary、history、manual position 列表)需要某 symbol 的最新价
- **THEN** 通过 `SELECT close FROM price_snapshots WHERE symbol = ? ORDER BY date DESC LIMIT 1` 取得;无记录时返回空

### Requirement: Daily price refresh job
系统 SHALL 每天 01:00 UTC 触发 `daily-price-refresh` 队列,统一刷新所有持仓 symbol 的最新价(早于 `daily-monitoring` 的 02:00 UTC)。

#### Scenario: Scheduled trigger fires daily before monitoring
- **WHEN** 时间到达每天 01:00 UTC
- **THEN** pg-boss cron 任务触发,worker 执行 `runPriceRefreshJob`

#### Scenario: Aggregates symbols across strategy and manual positions
- **WHEN** `runPriceRefreshJob` 启动
- **THEN** 通过 `SELECT DISTINCT symbol FROM positions JOIN position_lots …` 聚合所有有 lot 的 symbol(策略 + 手动一次性取);如果 symbol 集为空则直接结束并日志记录

#### Scenario: Single fetchPrices call upserts each symbol
- **WHEN** symbol 集非空
- **THEN** 调用 `fetchPrices(symbols, "5d")`(冗余 5 天处理周末/节假/补抓),按 `(symbol, date)` upsert 入 `price_snapshots`

#### Scenario: Single-symbol failure does not abort the job
- **WHEN** 个别 symbol 在 fetcher 处抛错
- **THEN** 该 symbol 跳过,记录 warning 日志;其他 symbol 仍正常 upsert,job 整体不失败

### Requirement: Async manual backfill queue
系统 SHALL 提供 `manual-backfill` 队列,接收 `{ symbol, fromDate }` 任务,按需回填该 symbol 从 `fromDate` 到今天的 `price_snapshots`。

#### Scenario: Skip when existing data already covers fromDate
- **WHEN** worker 调 `ensurePriceSnapshots(symbol, fromDate)` 且 `price_snapshots` 中该 symbol 最早日期 ≤ `fromDate`
- **THEN** 不调用 fetcher,直接返回

#### Scenario: Backfill the gap when needed
- **WHEN** `price_snapshots` 中该 symbol 不存在或最早日期 > `fromDate`
- **THEN** 计算 `daysBack = today - fromDate`,调用 `fetchPrices([symbol], "${daysBack}d")` 拉取并 upsert 进表

#### Scenario: Deep backfill uses outputsize=full
- **WHEN** `daysBack > 100`
- **THEN** Alpha Vantage 请求带 `outputsize=full` 参数,确保返回完整历史(默认 compact 仅 100 天)

#### Scenario: Retry policy on transient failure
- **WHEN** 单次 `manual-backfill` 任务失败(provider 限速 / 网络)
- **THEN** pg-boss 自动重试至多 3 次;3 次仍失败的 symbol 由次日 `daily-price-refresh` 自然续抓

### Requirement: Migration backfill script
项目 SHALL 提供一次性回填脚本 `scripts/backfill-price-snapshots.ts`,在部署 schema 后由运维执行,确保 `price_snapshots` 在新 worker 启动前已有覆盖。

#### Scenario: Backfill range covers earliest lot and largest analysis window
- **WHEN** 脚本对每个现存 `positions.symbol` 计算回填起点
- **THEN** 起点 = `MIN( MIN(lot.lot_date for that symbol), today − MAX(strategies.analysis_window_days for strategies holding this symbol) )`,即"最早 lot 日期"与"最长分析窗口起点"中**更早的一个**

#### Scenario: Failure on individual symbol does not abort script
- **WHEN** 某 symbol 回填失败
- **THEN** 脚本记录错误并继续处理下一个 symbol;最终汇总成功/失败计数
