## ADDED Requirements

### Requirement: Portfolio P&L summary card
持仓管理总览页 SHALL 在持仓列表上方显示全量持仓收益汇总卡片，聚合所有策略的持仓数据。

#### Scenario: Summary displays aggregated cost and value
- **WHEN** 用户访问持仓管理总览页
- **THEN** 系统显示汇总卡片，包含：总成本（所有策略所有 lot 的成本之和）、当前市值（有价格覆盖的持仓市值之和）、绝对收益（$）、百分比收益率（%），收益为正显示红色，收益为负显示绿色

#### Scenario: Loading state
- **WHEN** 汇总数据正在加载
- **THEN** 系统显示骨架屏占位动画，不显示旧数据

#### Scenario: Error state
- **WHEN** 汇总数据加载失败
- **THEN** 系统显示「数据加载失败」提示，不中断持仓列表的展示

#### Scenario: No price data available
- **WHEN** 所有持仓均无监控价格覆盖（coveredPositions === 0）
- **THEN** 系统显示「暂无价格数据」提示

#### Scenario: Partial price coverage
- **WHEN** 部分持仓有价格覆盖、部分无价格覆盖
- **THEN** 系统基于有价格覆盖的持仓计算并展示收益，并在卡片中注明覆盖比例（如「基于 X/Y 个持仓的价格数据」）
