## MODIFIED Requirements

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
