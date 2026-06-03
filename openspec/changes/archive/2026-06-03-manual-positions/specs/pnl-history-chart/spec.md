## MODIFIED Requirements

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

### Requirement: P&L history API — portfolio
系统 SHALL 提供 `GET /api/positions/history` 端点,基于 `price_snapshots` 返回账户级每日收益率序列。

#### Scenario: Returns daily percentPnl series from price_snapshots
- **WHEN** 调用 `GET /api/positions/history?range=1m`
- **THEN** 系统聚合所有持仓(策略 + 手动)的 `(symbol, shares, cost)`,从 `price_snapshots` 取过去 30 天内每个有数据的日期,按 `(累计市值 - 累计成本) / 累计成本 × 100` 计算 percentPnl,返回 `{ date, percentPnl }` 数组按日期升序

#### Scenario: Supports range parameter
- **WHEN** 分别调用 range=1m、3m、all
- **THEN** 分别返回过去 30 天、90 天、所有历史的数据

#### Scenario: Skips dates with zero coverage
- **WHEN** 某日期所有持仓的 symbol 在 `price_snapshots` 中均无该日期价格行
- **THEN** 该日期不出现在响应数组中

#### Scenario: Manual positions contribute to portfolio curve
- **WHEN** 存在手动持仓且其 symbol 在 `price_snapshots` 中有历史数据
- **THEN** 该手动持仓的 cost 与 value 计入账户级曲线的每个日期点
