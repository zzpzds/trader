## ADDED Requirements

### Requirement: Daily monitoring trigger at 10:00 CST
系统 SHALL 每天 10:00 北京时间（CST，UTC 02:00）自动触发监控任务。

#### Scenario: Scheduled trigger fires daily
- **WHEN** 时间到达每天 UTC 02:00
- **THEN** pg-boss cron 任务触发，Worker 开始执行监控流程

#### Scenario: Only strategies with lots are analyzed
- **WHEN** 监控任务启动
- **THEN** 系统仅处理至少有一条 position_lot 记录的策略，无持仓的策略跳过

---

### Requirement: Fetch latest price data via yfinance
系统 SHALL 通过 Python 子进程（yfinance）拉取监控所需的股票价格数据。

#### Scenario: Price data fetched for all symbols in strategy
- **WHEN** 处理某策略时
- **THEN** 系统调用 yfinance 子进程，拉取该策略 symbols 列表中所有股票的近 60 天 OHLCV 数据和最新收盘价

#### Scenario: Price fetch failure
- **WHEN** yfinance 子进程返回错误或超时
- **THEN** 该策略的 monitoring_run 状态更新为 `failed`，error 字段记录错误信息，继续处理下一个策略

---

### Requirement: LLM analyzes strategy with positions and prices via tool_use
系统 SHALL 使用 Claude API tool_use 模式分析策略持仓状态，返回结构化报告。

#### Scenario: Successful analysis
- **WHEN** 价格数据获取成功后
- **THEN** 系统组装包含策略描述、当前持仓明细（股数/成本/盈亏）、近期价格数据的 prompt，调用 LLM；LLM 通过 `report_analysis` 工具返回 `{ analysis, has_action_items, action_summary }`

#### Scenario: Analysis with action items
- **WHEN** LLM 判断当前持仓状态触发了策略规则（加仓/减仓/换仓条件）
- **THEN** `has_action_items = true`，`action_summary` 包含具体操作建议摘要

#### Scenario: Analysis without action items
- **WHEN** LLM 判断当前持仓状态未触发任何操作条件
- **THEN** `has_action_items = false`，仍生成完整分析报告存入 monitoring_run

---

### Requirement: Monitoring run status tracking
系统 SHALL 记录每次监控运行的状态，支持 pending / completed / failed。

#### Scenario: Run starts as pending
- **WHEN** 某策略的监控任务开始执行
- **THEN** 系统立即写入一条 `status=pending` 的 monitoring_run 记录

#### Scenario: Run completes successfully
- **WHEN** LLM 分析完成并返回结果
- **THEN** 系统将 monitoring_run 更新为 `status=completed`，写入 analysis、has_action_items、prices（价格快照 JSONB）

#### Scenario: Run fails
- **WHEN** 任意步骤（价格拉取、LLM 调用）发生异常
- **THEN** 系统将 monitoring_run 更新为 `status=failed`，error 字段记录错误信息

---

### Requirement: In-app notification on action items
系统 SHALL 在监控发现操作建议时创建站内通知。

#### Scenario: Notification created for action items
- **WHEN** monitoring_run 完成且 `has_action_items = true`
- **THEN** 系统创建 notification 记录，title 为 `action_summary` 内容，content 为分析报告摘要，is_read = false

#### Scenario: No notification when no action items
- **WHEN** monitoring_run 完成且 `has_action_items = false`
- **THEN** 系统不创建 notification

---

### Requirement: Notification bell with unread count
系统 SHALL 在导航栏展示未读通知数量。

#### Scenario: Unread count displayed
- **WHEN** 存在 `is_read = false` 的通知
- **THEN** 导航栏铃铛图标显示未读数量角标

#### Scenario: No unread notifications
- **WHEN** 所有通知均已读
- **THEN** 导航栏铃铛图标不显示角标

---

### Requirement: View notification and mark as read
用户 SHALL 能够查看通知内容并标记为已读。

#### Scenario: View notification list
- **WHEN** 用户点击通知铃铛
- **THEN** 系统展示通知列表，显示标题、时间、已读/未读状态

#### Scenario: Navigate to monitoring run
- **WHEN** 用户点击某条通知
- **THEN** 系统跳转到对应 monitoring_run 的完整分析报告，并将该通知标记为已读

#### Scenario: Mark all as read
- **WHEN** 用户点击"全部标记已读"
- **THEN** 所有 `is_read = false` 的通知更新为已读，角标清零

---

### Requirement: Monitoring center history page
用户 SHALL 能够查看所有策略的历史监控记录。

#### Scenario: History list displayed
- **WHEN** 用户访问监控中心页
- **THEN** 系统按日期倒序展示所有 monitoring_run 记录，每条显示：日期、策略名、状态（completed/failed/pending）、是否有操作建议标签

#### Scenario: View full analysis
- **WHEN** 用户点击某条 completed 的 monitoring_run
- **THEN** 系统展示完整的 LLM 分析报告（markdown 渲染）

#### Scenario: Failed run shows error
- **WHEN** 用户点击某条 failed 的 monitoring_run
- **THEN** 系统展示失败原因（error 字段内容）

#### Scenario: Filter by strategy
- **WHEN** 用户在监控中心选择按策略过滤
- **THEN** 系统只显示该策略的历史监控记录

---

### Requirement: Manual monitoring trigger
用户 SHALL 能够手动触发监控任务用于调试。

#### Scenario: Trigger all strategies
- **WHEN** 用户调用 `POST /api/monitoring/trigger`
- **THEN** 系统对所有有持仓的策略执行一次监控流程（同定时任务逻辑）

#### Scenario: Trigger single strategy
- **WHEN** 用户调用 `POST /api/monitoring/trigger/[strategyId]`
- **THEN** 系统仅对该策略执行一次监控流程

---

### Requirement: Concurrent monitoring with limit
系统 SHALL 使用并发限制处理多策略监控，防止资源过载。

#### Scenario: Concurrent limit enforced
- **WHEN** 需要同时处理多个策略
- **THEN** 系统最多同时处理 3 个策略（p-limit(3)），其余策略排队等待
