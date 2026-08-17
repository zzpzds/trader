## ADDED Requirements

### Requirement: Shared position replay semantics across applications

Web 持仓展示与 Worker 策略监控 SHALL 使用同一套交易回放语义，对相同交易序列产生一致的剩余持股、成本基础、平均成本、已实现盈亏和清仓状态。

#### Scenario: Web and Worker aggregate the same transactions

- **WHEN** Web 与 Worker 处理同一组包含 BUY 和 SELL 的交易记录
- **THEN** 两端得到的 `heldShares`、`costBasis`、`avgCost`、`realizedPnl` 与 `isClosed` SHALL 完全一致

#### Scenario: Fully sold position remains closed

- **WHEN** 累计卖出股数等于累计买入股数
- **THEN** Web 与 Worker 均 SHALL 返回持股 0、成本基础 0 和已清仓状态，且保留已实现盈亏

