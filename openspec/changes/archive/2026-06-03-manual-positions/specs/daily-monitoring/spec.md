## MODIFIED Requirements

### Requirement: Fetch latest price data via yfinance
系统 SHALL 从 `price_snapshots` 表读取监控所需的股票价格数据,**不再**在 monitoring 任务内直接调用 fetcher。窗口长度由每条策略的 `analysis_window_days` 字段决定。

#### Scenario: Read OHLCV bars from price_snapshots within strategy.analysisWindowDays
- **WHEN** 处理某策略时
- **THEN** 系统查询 `price_snapshots WHERE symbol IN (...) AND date >= today - strategy.analysis_window_days` 并按日期升序排列,重组为 `{ [symbol]: { latest, bars[] } }` 喂给 LLM 分析层

#### Scenario: Per-strategy configurable window
- **WHEN** 策略未显式设置 `analysis_window_days`
- **THEN** 使用默认值 60(向后兼容现行行为)

#### Scenario: Fallback to inline fetch during transition
- **WHEN** 某策略所有 symbol 在 `price_snapshots` 中均无任何行(过渡期 / `daily-price-refresh` 尚未运行)
- **THEN** 系统记录 warning 日志,临时回退到 inline `fetchPrices` 调用以避免阻塞 LLM 分析;此 fallback 在生产稳定 1-2 周后由后续清理变更删除

#### Scenario: Sparse coverage warning
- **WHEN** 某 symbol 在窗口内的 snapshot 数 < 期望天数 × 0.6
- **THEN** 系统记录 warning 日志但不阻塞分析,LLM 收到现有 bars

---

### Requirement: Monitoring run status tracking
系统 SHALL 记录每次监控运行的状态,支持 pending / completed / failed。

#### Scenario: Run starts as pending
- **WHEN** 某策略的监控任务开始执行
- **THEN** 系统立即写入一条 `status=pending` 的 monitoring_run 记录

#### Scenario: Run completes successfully
- **WHEN** LLM 分析完成并返回结果
- **THEN** 系统将 monitoring_run 更新为 `status=completed`,写入 `analysis`、`has_action_items`;**不再**写入 `prices` 字段(数据源已迁移至 `price_snapshots`,`monitoring_runs.prices` 字段保留可读但新代码不再写入)

#### Scenario: Run fails
- **WHEN** 任意步骤(snapshot 读取、LLM 调用)发生异常
- **THEN** 系统将 monitoring_run 更新为 `status=failed`,error 字段记录错误信息
