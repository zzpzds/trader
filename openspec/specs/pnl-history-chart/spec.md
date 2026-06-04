## ADDED Requirements

### Requirement: P&L rate history chart on positions overview page
持仓管理总览页 SHALL 在汇总卡片下方展示账户级历史收益率折线图,数据源为 `price_snapshots`,**包含**手动持仓贡献。

#### Scenario: Chart renders with data
- **WHEN** 用户访问持仓管理总览页且 `price_snapshots` 中存在所选时间范围内的价格数据
- **THEN** 系统展示一条折线图,X 轴为日期(MM/DD 格式),Y 轴为百分比收益率(带 % 后缀);每个数据点对应该日期所有持仓(策略 + 手动)按 snapshot 价格计算的整体盈亏率

#### Scenario: Chart loading state
- **WHEN** 图表数据正在加载
- **THEN** 系统显示骨架屏占位动画

#### Scenario: No history data
- **WHEN** 图表数据返回空数组
- **THEN** 系统显示「暂无数据」提示

#### Scenario: Time range toggle
- **WHEN** 用户点击 1M / 3M / 全部 切换按钮
- **THEN** 图表重新拉取对应时间范围的数据并刷新展示,默认显示 1M

#### Scenario: Color indicates current P&L direction
- **WHEN** 最后一个数据点的 percentPnl >= 0
- **THEN** 折线颜色为红色(#dc2626);否则为绿色(#16a34a)

#### Scenario: Tooltip on hover
- **WHEN** 用户悬停在折线图数据点上
- **THEN** 系统显示 Tooltip:完整日期(YYYY-MM-DD)和带正负号的收益率(如 +3.45% 或 -1.20%)

#### Scenario: Tab switching does not reload chart
- **WHEN** 用户在「策略持仓」与「手动持仓」tab 之间切换
- **THEN** 图表保持显示同一份账户级曲线,不重新发起请求

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
系统 SHALL 提供 `GET /api/positions/history` 端点,聚合所有持仓(策略 + 手动)、按时间精确重放交易重建账户级每日收益率序列,价格源为 `price_snapshots`,曲线包含累计已实现盈利。

#### Scenario: Returns daily percentPnl series via replay
- **WHEN** 调用 `GET /api/positions/history?range=1m`
- **THEN** 系统对范围内每一天 d:回放所有持仓(策略 + 手动)`lotDate ≤ d` 的全部交易得当日 `heldShares/costBasis/realizedPnl`,价格取 `price_snapshots` 中 `date ≤ d` 的最新 `close`,返回 `{ date, percentPnl }`(`percentPnl = ((marketValue − remainingCost) + realizedCum) / grossInvested(d) × 100`),按日期升序排列

#### Scenario: Curve includes realized gains after close
- **WHEN** 某天某股票清仓
- **THEN** 该日及之后的 `percentPnl` 仍体现已锁定的已实现盈利,曲线不因持股归零而塌回 0

#### Scenario: Manual positions contribute to portfolio curve
- **WHEN** 存在手动持仓且其 symbol 在 `price_snapshots` 中有历史数据
- **THEN** 该手动持仓的回放结果(持仓成本、市值、已实现)计入账户级曲线的每个日期点

#### Scenario: Supports range parameter
- **WHEN** 分别调用 range=1m、3m、all
- **THEN** 分别返回过去 30 天、90 天、所有历史(从最早交易日起)的数据

#### Scenario: Skips dates with zero gross invested
- **WHEN** 某日期 `grossInvested(d)` 为 0(该日前无任何买入)
- **THEN** 该日期不出现在响应数组中

---

### Requirement: P&L history API — single strategy
系统 SHALL 提供 `GET /api/strategies/[id]/history` 端点,按时间精确重放该策略交易重建每日收益率序列,价格来源为 `price_snapshots`,曲线包含累计已实现盈利。

#### Scenario: Returns strategy-specific daily percentPnl series via replay
- **WHEN** 调用 `GET /api/strategies/abc/history?range=1m`
- **THEN** 系统仅回放该策略 `lotDate ≤ d` 的交易,价格取 `price_snapshots` 中 `date ≤ d` 的最新 `close`,返回该策略每日 `{ date, percentPnl }`(含已实现盈利),按日期升序排列

#### Scenario: Strategy history uses price_snapshots not monitoring runs
- **WHEN** 计算策略历史每日价格
- **THEN** 系统从 `price_snapshots`(而非 `monitoring_runs.prices`)取价,与账户级 history 口径一致

#### Scenario: Skips dates with zero gross invested for strategy
- **WHEN** 某日期该策略 `grossInvested(d)` 为 0
- **THEN** 该日期不出现在响应数组中
