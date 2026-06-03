## MODIFIED Requirements

### Requirement: Position P&L from monitoring snapshot
系统 SHALL 使用 `price_snapshots` 表中该 symbol 的最新一行 `close` 计算持仓浮动盈亏,不做实时拉取。

#### Scenario: P&L calculated from latest price_snapshots row
- **WHEN** 用户查看持仓(策略详情持仓 Tab 或持仓管理总览页)
- **THEN** 系统对每只 symbol 取 `SELECT close FROM price_snapshots WHERE symbol = ? ORDER BY date DESC LIMIT 1`,计算 `盈亏% = (最新价 - 加权均价) / 加权均价 × 100` 并展示

#### Scenario: No price snapshot yet
- **WHEN** 该 symbol 在 `price_snapshots` 中尚无任何行
- **THEN** 最新价和盈亏列显示"--",不影响其他 symbol 的展示

---

### Requirement: Positions overview page
用户 SHALL 能够在持仓管理总览页查看所有持仓汇总,页面顶部展示账户级总览与历史曲线,下方按 tab 分组展示「策略持仓」与「手动持仓」。

#### Scenario: Account-level summary and chart at top
- **WHEN** 用户访问 `/positions`
- **THEN** 系统在顶部展示「总持仓收益」汇总卡片与全量历史收益率折线图,数据**包含**所有策略持仓和手动持仓,与 tab 切换无关

#### Scenario: Strategy positions tab lists by strategy
- **WHEN** 用户处于 `/positions?tab=strategies`(默认)
- **THEN** 系统在曲线下方按策略分组展示所有 `strategy_id IS NOT NULL` 的持仓,每条显示:股票代码、总股数、加权均价、最新价、浮动盈亏%

#### Scenario: Manual positions tab lists null-strategy holdings
- **WHEN** 用户切到 `/positions?tab=manual`
- **THEN** 系统在曲线下方展示所有 `strategy_id IS NULL` 的持仓,顶部带 `+ 添加持仓` 按钮

#### Scenario: Navigate to strategy detail
- **WHEN** 用户点击策略持仓 tab 中的某条记录
- **THEN** 系统跳转到对应策略详情页的持仓 Tab(行为不变)
