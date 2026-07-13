## Requirements

### Requirement: Manual position record without strategy
用户 SHALL 能够录入未绑定任何策略的"手动持仓",系统将其作为 `strategy_id = NULL` 的 position 行存储,与策略持仓共享同一张 `positions` / `position_lots` 表。

#### Scenario: Create first manual lot for a new symbol
- **WHEN** 用户在 `/positions?tab=manual` 通过 `+ 添加持仓` 提交某 symbol 的第一笔 lot(shares、cost_price、lot_date 必填,notes 可选)
- **THEN** 系统自动创建一条 `positions(strategy_id = NULL, symbol)` 记录,再创建对应 lot;返回 `201 { positionId, lotId }`

#### Scenario: Append lot to existing manual position
- **WHEN** 用户为同一 symbol 再次提交手动 lot
- **THEN** 系统不新建 position 行,只在已有手动 position 下追加 lot 记录;由数据库 `(strategy_id, symbol)` 唯一索引(`NULLS NOT DISTINCT`)保证手动持仓每 symbol 只有一行

#### Scenario: Reject future lot date
- **WHEN** 用户提交的 `lotDate` 大于今日
- **THEN** 系统返回 400 错误,不创建任何记录

### Requirement: Manual position list with latest price
系统 SHALL 提供 `GET /api/positions/manual` 返回所有 `strategy_id IS NULL` 的持仓,每条携带最新价(取自 `price_snapshots`)与 lot 明细。

#### Scenario: Return positions with prices when available
- **WHEN** 调用 `GET /api/positions/manual`
- **THEN** 系统返回数组,每条包含 `id, symbol, totalShares, avgCost, latestPrice, lots[]`;`latestPrice` 来自 `price_snapshots` 中该 symbol 最新一行的 `close`

#### Scenario: Indicate price still loading
- **WHEN** 某 symbol 在 `price_snapshots` 中尚无任何记录
- **THEN** 该条 `latestPrice` 字段为 `null`,前端据此渲染"价格加载中"

### Requirement: Manual lot deletion
用户 SHALL 能够删除单条手动 lot;若该 position 无 lot 残留,系统 SHALL 同步删除 position 行。

#### Scenario: Delete a non-last lot
- **WHEN** 用户删除手动 position 下某条 lot,该 position 仍有其它 lot
- **THEN** 系统仅删除该 lot,position 行保留;返回 `{ deletedPosition: false }`

#### Scenario: Delete the last lot
- **WHEN** 用户删除手动 position 下最后一条 lot
- **THEN** 系统在同一事务内删除该 lot 与所属 position;返回 `{ deletedPosition: true }`

#### Scenario: Reject delete on non-manual lot
- **WHEN** 调用方试图通过手动持仓端点删除一条 `strategy_id IS NOT NULL` 的 lot
- **THEN** 系统返回 404,不修改任何记录

### Requirement: Manual position outright deletion
用户 SHALL 能够整体删除一条手动 position 及其所有 lot。

#### Scenario: Delete manual position with cascade
- **WHEN** 调用 `DELETE /api/positions/manual/:positionId` 且 position 的 `strategy_id IS NULL`
- **THEN** 系统级联删除 position 与其所有 lot 记录

#### Scenario: Reject delete on strategy-bound position
- **WHEN** 该 position 的 `strategy_id IS NOT NULL`
- **THEN** 系统返回 404,不修改任何记录

### Requirement: Async price backfill on manual position create
系统 SHALL 在手动持仓 POST 成功后异步回填该 symbol 的历史价格,不在 HTTP 请求路径上同步等待。

#### Scenario: Enqueue backfill job after create
- **WHEN** 手动持仓 POST 成功
- **THEN** 系统向 `manual-backfill` 队列投递任务 `{ symbol, fromDate: lotDate }`;HTTP 立即返回 201,不等待 fetcher 完成

#### Scenario: Worker fills price_snapshots from lot date to today
- **WHEN** worker 处理 `manual-backfill` 任务
- **THEN** 调 `ensurePriceSnapshots(symbol, fromDate)`:若 `price_snapshots` 已覆盖 `fromDate` 则跳过;否则调 `fetchPrices` 拉 `[fromDate, today]` 区间并 upsert 进 `price_snapshots`

### Requirement: /positions page tabs and account-level totals
持仓总览页 SHALL 提供「策略持仓」/「手动持仓」两个 tab,但顶部总览卡片与 P&L 历史曲线**始终**展示账户级聚合(策略 + 手动合并)。

#### Scenario: Tab state persists in URL
- **WHEN** 用户切换 tab
- **THEN** URL search param `?tab=strategies | manual` 同步更新,刷新或分享链接保留 tab 状态;默认 `strategies`

#### Scenario: Summary and chart unaffected by tab
- **WHEN** 用户在两个 tab 之间切换
- **THEN** 顶部「总成本/总市值/PnL」卡片与 P&L 曲线不重新拉取,显示同一份账户级数据

#### Scenario: Manual tab card shows price loading state
- **WHEN** 「手动持仓」tab 列出某 symbol 但其 `latestPrice === null`
- **THEN** 卡片显示「价格加载中…」并自动每 5 秒轮询 `GET /api/positions/manual`,最多轮询 12 次后停止

### Requirement: Strategy deletion preserves positions as manual
系统 SHALL 在删除 strategy 时将其下属 positions 的 `strategy_id` 置为 `NULL`,而非级联删除。

#### Scenario: Positions become manual when strategy deleted
- **WHEN** 用户删除一条仍有持仓的 strategy
- **THEN** 该 strategy 行被删除;原属其下的 positions 行 `strategy_id` 变为 NULL,lot 记录完整保留;这些 position 在「手动持仓」tab 中可见
