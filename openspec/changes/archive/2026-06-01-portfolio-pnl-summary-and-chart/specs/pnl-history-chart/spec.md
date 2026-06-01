## ADDED Requirements

### Requirement: P&L rate history chart on positions overview page
持仓管理总览页 SHALL 在汇总卡片下方展示全量历史收益率折线图。

#### Scenario: Chart renders with data
- **WHEN** 用户访问持仓管理总览页且存在历史监控运行数据
- **THEN** 系统展示一条折线图，X 轴为运行日期（MM/DD 格式），Y 轴为百分比收益率（带 % 后缀）

#### Scenario: Chart loading state
- **WHEN** 图表数据正在加载
- **THEN** 系统显示骨架屏占位动画

#### Scenario: No history data
- **WHEN** 图表数据返回空数组
- **THEN** 系统显示「暂无数据」提示

#### Scenario: Time range toggle
- **WHEN** 用户点击 1M / 3M / 全部 切换按钮
- **THEN** 图表重新拉取对应时间范围的数据并刷新展示，默认显示 1M

#### Scenario: Color indicates current P&L direction
- **WHEN** 最后一个数据点的 percentPnl >= 0
- **THEN** 折线颜色为红色（#dc2626）；否则为绿色（#16a34a）

#### Scenario: Tooltip on hover
- **WHEN** 用户悬停在折线图数据点上
- **THEN** 系统显示 Tooltip：完整日期（YYYY-MM-DD）和带正负号的收益率（如 +3.45% 或 -1.20%）

---

### Requirement: P&L rate history chart on strategy detail page
策略详情页「持仓」Tab SHALL 在持仓列表上方展示该策略的历史收益率折线图。

#### Scenario: Chart renders for single strategy
- **WHEN** 用户访问策略详情页并切换到持仓 Tab，且该策略存在历史监控运行数据
- **THEN** 系统在持仓列表上方展示该策略的收益率折线图

#### Scenario: Strategy chart shares the same interaction model
- **WHEN** 用户操作策略详情页的收益率图表
- **THEN** 图表支持与持仓管理总览页完全相同的时间范围切换、Tooltip 和颜色逻辑

#### Scenario: No history data for strategy
- **WHEN** 该策略尚无 completed 的 monitoring_run
- **THEN** 图表显示「暂无数据」提示，不影响持仓列表的展示

---

### Requirement: P&L history API — portfolio
系统 SHALL 提供 `GET /api/positions/history` 端点，返回全量历史每日收益率序列。

#### Scenario: Returns daily percentPnl series
- **WHEN** 调用 `GET /api/positions/history?range=1m`
- **THEN** 系统返回过去 30 天内每个有 completed monitoring_run 的日期的 `{ date, percentPnl }` 数组，按日期升序排列

#### Scenario: Supports range parameter
- **WHEN** 分别调用 range=1m、3m、all
- **THEN** 分别返回过去 30 天、90 天、所有历史的数据

#### Scenario: Skips dates with zero coverage
- **WHEN** 某日期的所有持仓均无价格覆盖
- **THEN** 该日期不出现在响应数组中

---

### Requirement: P&L history API — single strategy
系统 SHALL 提供 `GET /api/strategies/[id]/history` 端点，返回指定策略的历史每日收益率序列。

#### Scenario: Returns strategy-specific daily percentPnl series
- **WHEN** 调用 `GET /api/strategies/abc/history?range=1m`
- **THEN** 系统返回该策略过去 30 天内每个有 completed monitoring_run 的日期的 `{ date, percentPnl }` 数组

#### Scenario: Skips dates with zero coverage for strategy
- **WHEN** 某日期该策略所有持仓均无价格覆盖
- **THEN** 该日期不出现在响应数组中
