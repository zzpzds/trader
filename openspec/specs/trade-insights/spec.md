# trade-insights Specification

## Purpose
TBD - created by archiving change memory-and-insights. Update Purpose after archive.
## Requirements
### Requirement: On-demand insights computation from existing data
系统 SHALL 提供 `GET /api/insights` 接口，基于现有 `position_lots` 与 `price_snapshots` 表实时计算 4 类交易行为指标，可选 `strategyId` 参数限定为单策略视图。不引入新表、不预算缓存。

#### Scenario: Global computation
- **WHEN** 用户调用 `GET /api/insights`
- **THEN** 系统读取所有 lots（含手动持仓与各策略持仓）参与计算，返回 `InsightsReport`

#### Scenario: Per-strategy computation
- **WHEN** 用户调用 `GET /api/insights?strategyId=<id>`
- **THEN** 系统只读取该 strategyId 对应 positions 下的 lots 计算

#### Scenario: Slow-computation warning log
- **WHEN** 单次计算耗时 > 500ms
- **THEN** 系统记录 warn 日志 `[insights] computation took <ms>ms`，不影响响应

### Requirement: Empty state for insufficient closed trades
系统 SHALL 在已平仓交易（FIFO 配对成功的 BUY/SELL 对）少于 5 笔时返回 `{ empty: true, reason: "insufficient_data" }`，前端展示空态文案。

#### Scenario: Fewer than 5 closed trades
- **WHEN** FIFO 配对后 closedTrades 数量 < 5
- **THEN** API 返回 `{ empty: true, reason: "insufficient_data" }`，前端显示"交易数据不足，需至少 5 笔已平仓交易"

#### Scenario: Exactly 5 closed trades
- **WHEN** FIFO 配对后 closedTrades 数量 == 5
- **THEN** API 返回完整 `InsightsReport`

### Requirement: Basic financial metrics
系统 SHALL 在 `InsightsReport.basic` 字段中输出：`closedTrades`（已平仓交易数）、`winRate`（[0,1]）、`avgHoldDays`、`profitLossRatio`（平均盈利绝对值 / 平均亏损绝对值）、`totalRealizedPnl`、`maxDrawdown`（基于按日 PnL 曲线的最大回撤金额）。

#### Scenario: Pair trades via FIFO within positionId
- **WHEN** 计算 closedTrades
- **THEN** 系统按 positionId 分组、按 lotDate 升序遍历；BUY 入栈记 remaining shares，SELL 弹栈匹配 share 单位，每个 share 单位生成一个 ClosedTrade（含 buyPrice/sellPrice/holdDays/realized）

#### Scenario: Compute win rate from realized > 0
- **WHEN** 有 N 笔 closedTrades，其中 W 笔 realized > 0
- **THEN** `winRate = W / N`

#### Scenario: Profit-loss ratio with zero-loss guard
- **WHEN** 无任何亏损交易（avgLossPnl == 0）
- **THEN** `profitLossRatio = 0`（避免除零）

### Requirement: Disposition effect indicator
系统 SHALL 计算"赢家持仓天数 vs 输家持仓天数"对比，输出 `disposition.score = (avgLossDays - avgWinDays) / max(avgLossDays, ε)`，并按阈值给出 flag。

#### Scenario: Severe flag when winners held 5d, losers 60d
- **WHEN** 赢家平均持仓 5 天、输家平均持仓 60 天
- **THEN** `score ≈ 0.92`，`flag = "severe"`

#### Scenario: Threshold mapping
- **WHEN** 计算 disposition.score
- **THEN** `score > 0.6 → "severe"`，`> 0.3 → "mild"`，否则 `"none"`

#### Scenario: Zero loser days yields zero score
- **WHEN** 无输家交易（avgLossDays == 0）
- **THEN** `score = 0`，`flag = "none"`

### Requirement: Anchoring / chasing-high indicator
系统 SHALL 对每笔 BUY 计算其价格相对该 lot 前 30 个交易日窗口的偏离，输出 `anchoring.avgChaseHighPct`（BUY 价 vs 30 日窗口最高价的均值偏离）、`anchoring.chaseRate`（BUY 价 > 30 日均线的比例）、`anchoring.avgVsRefPct`（BUY 价 vs 当时 positions.referencePrice 的均值偏离，使用当前 referencePrice 作为最佳近似）。

#### Scenario: Severe flag when BUY 30%+ above 30d high
- **WHEN** 5 笔 BUY 全部 130 元，前 30 天历史最高 100 元
- **THEN** `avgChaseHighPct ≈ 30%`，`flag = "severe"`

#### Scenario: Threshold mapping
- **WHEN** 计算 anchoring.avgChaseHighPct
- **THEN** `> 15 → "severe"`，`> 5 → "mild"`，否则 `"none"`

#### Scenario: Skip lot when no snapshots in window
- **WHEN** 某 BUY lot 的前 30 天窗口内没有 price_snapshots 数据
- **THEN** 该 lot 不参与 chase 与 ma 统计（avoid divide-by-zero / spurious values）

#### Scenario: avgVsRefPct uses current ref price
- **WHEN** 计算 avgVsRefPct
- **THEN** 系统使用 `positions.reference_price` 当前值（best-effort 近似），代码中加注释明示局限

### Requirement: Overtrading / churn indicator
系统 SHALL 输出 `overtrading.avgTradesPerWeek`（lot 总数 / 时间跨度周数）与 `overtrading.flipsWithin3d`（同标的 SELL 后 3 日内立刻 BUY 的次数），并按阈值给出 flag。

#### Scenario: Severe flag with high frequency or many flips
- **WHEN** `avgTradesPerWeek > 10` 或 `flipsWithin3d >= 3`
- **THEN** `flag = "severe"`

#### Scenario: Mild flag thresholds
- **WHEN** `avgTradesPerWeek > 5` 或 `flipsWithin3d >= 1`，且未达 severe
- **THEN** `flag = "mild"`

#### Scenario: Single-day span fallback
- **WHEN** 所有 lot 在同一天（时间跨度为 0）
- **THEN** 系统取 `Math.max(1, span)` 防止除零，结果为 lot 总数（一周内的近似）

### Requirement: Insights page with global / per-strategy tabs
Web 界面 SHALL 在 `/insights` 路径下提供独立页面，包含"全局"与"按策略"两个 tab，渲染 4 张指标卡片，每张卡片标题旁显示 flag 徽章（none 灰 / mild 黄 / severe 红）。

#### Scenario: Global tab renders 4 cards
- **WHEN** 用户访问 `/insights` 默认进入"全局" tab
- **THEN** 系统调用 `/api/insights`，渲染基础财务、处置效应、锚定/追高、过度交易 4 张卡片

#### Scenario: Per-strategy tab with sidebar
- **WHEN** 用户切到"按策略" tab
- **THEN** 系统左侧列出所有策略，默认选中第一条；右侧显示该策略的 4 张卡片；切换策略时重新调用 `/api/insights?strategyId=<id>`

#### Scenario: Empty state when insufficient data
- **WHEN** API 返回 `{ empty: true }`
- **THEN** 页面显示"交易数据不足，需至少 5 笔已平仓交易"，不渲染卡片

