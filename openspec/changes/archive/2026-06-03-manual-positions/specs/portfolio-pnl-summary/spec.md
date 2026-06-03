## MODIFIED Requirements

### Requirement: Portfolio P&L summary card
持仓管理总览页 SHALL 在持仓列表上方显示账户级持仓收益汇总卡片,聚合**所有策略持仓与手动持仓**,数据源为 `price_snapshots`。

#### Scenario: Summary aggregates strategy and manual positions
- **WHEN** 用户访问持仓管理总览页
- **THEN** 系统显示汇总卡片,总成本 = 所有 lot 的成本之和(`strategy_id` 为何不区分);市值 = 有 `price_snapshots` 覆盖的持仓市值之和;绝对收益($)、百分比收益率(%);收益为正显示红色,收益为负显示绿色

#### Scenario: Latest price comes from price_snapshots
- **WHEN** 计算某 symbol 的当前市值
- **THEN** 系统取 `price_snapshots` 中该 symbol 最新一行的 `close`,而非旧的按 strategyId 索引的 `monitoring_runs.prices`

#### Scenario: Loading state
- **WHEN** 汇总数据正在加载
- **THEN** 系统显示骨架屏占位动画,不显示旧数据

#### Scenario: Error state
- **WHEN** 汇总数据加载失败
- **THEN** 系统显示「数据加载失败」提示,不中断持仓列表的展示

#### Scenario: No price data available
- **WHEN** 所有持仓在 `price_snapshots` 中均无任何价格行(`coveredPositions === 0`)
- **THEN** 系统显示「暂无价格数据」提示

#### Scenario: Partial price coverage
- **WHEN** 部分持仓在 `price_snapshots` 中有数据、部分无数据
- **THEN** 系统基于有数据的持仓计算并展示收益,并在卡片中注明覆盖比例(如「基于 X/Y 个持仓的价格数据」)

#### Scenario: Tab switching does not reload summary
- **WHEN** 用户在「策略持仓」与「手动持仓」tab 之间切换
- **THEN** 汇总卡片保持显示同一份账户级数据,不重新发起请求
