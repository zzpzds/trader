## ADDED Requirements

### Requirement: Transaction-aware monitoring position aggregation

策略监控任务 SHALL 按交易时间顺序和 `BUY/SELL` 类型回放每个 position 的全部交易，使用回放结果向分析器提供当前剩余持股、成本基础、平均成本和已实现盈亏，不得把卖出股数或卖出金额累计为持仓。

#### Scenario: Partial sell is deducted from monitoring holdings

- **WHEN** 某 position 先买入 10 股，再卖出 4 股
- **THEN** 监控分析器收到的当前持股 SHALL 为 6 股，平均成本 SHALL 按移动平均成本法计算

#### Scenario: Sell then re-entry is replayed correctly

- **WHEN** 某 position 依次买入 5 股 @ 600、卖出 5 股 @ 660、再买入 5 股 @ 600
- **THEN** 监控分析器收到的当前持股 SHALL 为 5 股、平均成本 SHALL 为 600、已实现盈亏 SHALL 为 300

#### Scenario: Transaction details retain their type

- **WHEN** Worker 将 position lots 转换为监控分析输入
- **THEN** 每条交易 SHALL 保留 `BUY` 或 `SELL` 类型以及稳定的日期/创建时间排序信息

#### Scenario: Fully sold position is represented safely in analysis

- **WHEN** 某 position 已完全卖出且之后没有重新建仓
- **THEN** 该 position SHALL 以当前持股 0、成本基础 0、已清仓状态和保留的已实现盈亏进入监控分析，提示词 SHALL NOT 计算当前持仓收益率或包含 `Infinity`、`NaN`
