## ADDED Requirements

### Requirement: Per-position total P&L
每个持仓 SHALL 对外展示总盈利(已实现 + 未实现)及其百分比,基于移动平均成本回放。

#### Scenario: API returns pnl fields per position
- **WHEN** 调用 `GET /api/positions/manual` 或 `GET /api/strategies/[id]/positions`
- **THEN** 每个 position 返回 `realizedPnl`、`unrealizedPnl`、`totalPnl`(=两者之和)、`totalPnlPercent`(=`totalPnl / grossInvested × 100`,`grossInvested`=所有 BUY 的 `shares×price` 之和)、`isClosed`(剩余持股是否为 0),以及按时间排序、含 `type` 的 `transactions`

#### Scenario: Card header shows total P&L
- **WHEN** 用户查看某持仓卡片
- **THEN** 卡片头部展示「总盈利 $X (Y%)」,正收益红色、负收益绿色,百分比四舍五入到 0.01%

#### Scenario: Closed position total equals realized
- **WHEN** 某持仓已清仓(剩余持股为 0)
- **THEN** 其 `unrealizedPnl=0`、`totalPnl=realizedPnl`,卡片仍展示该总盈利

## MODIFIED Requirements

### Requirement: Portfolio P&L summary card
持仓管理总览页 SHALL 在持仓列表上方显示账户级持仓收益汇总卡片,聚合**所有策略持仓与手动持仓**的总盈利(已实现 + 未实现),基于移动平均成本回放,价格源为 `price_snapshots`。

#### Scenario: Summary aggregates strategy and manual positions
- **WHEN** 用户访问持仓管理总览页
- **THEN** 系统显示汇总卡片(`strategy_id` 不区分):历史累计买入本金(grossInvested = 所有 BUY 的 `shares×price` 之和)、当前市值(有 `price_snapshots` 覆盖的剩余持仓市值之和)、绝对收益($ = 未实现 + 累计已实现)、百分比收益率(% = 绝对收益 / grossInvested × 100);收益为正显示红色,为负显示绿色

#### Scenario: Latest price comes from price_snapshots
- **WHEN** 计算某 symbol 的当前市值
- **THEN** 系统取 `price_snapshots` 中该 symbol 最新一行的 `close`,而非旧的按 strategyId 索引的 `monitoring_runs.prices`

#### Scenario: Realized gains from sells included
- **WHEN** 账户内存在已发生的卖出(含已清仓持仓)
- **THEN** 这些卖出的累计已实现盈利计入绝对收益,即使对应持仓剩余持股为 0、无当前市值贡献

#### Scenario: Loading state
- **WHEN** 汇总数据正在加载
- **THEN** 系统显示骨架屏占位动画,不显示旧数据

#### Scenario: Error state
- **WHEN** 汇总数据加载失败
- **THEN** 系统显示「数据加载失败」提示,不中断持仓列表的展示

#### Scenario: No price data available
- **WHEN** 所有剩余持仓在 `price_snapshots` 中均无任何价格行(`coveredPositions === 0`)且无任何已实现盈利
- **THEN** 系统显示「暂无价格数据」提示

#### Scenario: Partial price coverage
- **WHEN** 部分剩余持仓在 `price_snapshots` 中有数据、部分无数据
- **THEN** 系统基于有数据的持仓计算未实现盈利、叠加全部已实现盈利后展示总收益,并在卡片中注明覆盖比例(如「基于 X/Y 个持仓的价格数据」)

#### Scenario: Tab switching does not reload summary
- **WHEN** 用户在「策略持仓」与「手动持仓」tab 之间切换
- **THEN** 汇总卡片保持显示同一份账户级数据,不重新发起请求
