# daily-monitoring Specification

## Purpose
Defines the automated and manual monitoring workflow for strategies, including price input, LLM analysis, run status tracking, notifications, and monitoring history.
## Requirements
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

### Requirement: LLM analyzes strategy with positions and prices via tool_use
系统 SHALL 使用 Claude API tool_use 模式分析策略持仓状态，返回结构化报告；调用前 SHALL 加载该策略关联的 skill 内容并注入 prompt 顶部以增强方法论指导；同时 SHALL 在 prompt 中提供全量 skill catalog 简介，让 LLM 在主分析之外**顺手**推荐 0–3 个本次分析中觉得有用但当前未启用的 skill。

#### Scenario: Successful analysis
- **WHEN** 价格数据获取成功后
- **THEN** 系统组装包含策略描述、当前持仓明细（股数/成本/盈亏）、近期价格数据的 prompt，调用 LLM；LLM 通过 `report_analysis` 工具返回 `{ analysis, has_action_items, action_summary, suggested_skills }`

#### Scenario: Analysis with action items
- **WHEN** LLM 判断当前持仓状态触发了策略规则（加仓/减仓/换仓条件）
- **THEN** `has_action_items = true`，`action_summary` 包含具体操作建议摘要

#### Scenario: Analysis without action items
- **WHEN** LLM 判断当前持仓状态未触发任何操作条件
- **THEN** `has_action_items = false`，仍生成完整分析报告存入 monitoring_run

#### Scenario: 注入关联 skill 到 prompt 顶部
- **WHEN** 处理某策略时，该策略通过 `strategy_skills` 关联了 ≥ 1 条 skill
- **THEN** 系统按关联顺序读取每条 skill 的 `body_md`，拼接为 `## 可用方法论\n\n### {name}\n{body_md}\n\n---\n\n...` 区块，注入到 prompt 中 memory 区块之前、策略描述之前

#### Scenario: 未关联 skill 时回退原 prompt
- **WHEN** 处理某策略时，该策略未关联任何 skill
- **THEN** 系统按原有 prompt 结构调用 LLM（不包含「## 可用方法论」区块），但 catalog 简介仍照常注入（参见下条）

#### Scenario: 注入全量 skill catalog 简介
- **WHEN** 处理某策略时
- **THEN** 系统读取数据库中全部 skill 的 `name + description`（不读 body），拼接为 `## 可选技能目录\n（如果以下方法论中有任何一个对本次分析会有帮助但当前未被启用，请在 suggested_skills 中列出对应的 name；最多 3 条；如果都没必要，返回空数组）\n- {name}: {description}\n- ...\n` 区块，注入到 prompt 中「可用方法论」区块之后、memories 区块之前

#### Scenario: catalog 为空时不注入
- **WHEN** 数据库中无任何 skill
- **THEN** 系统不注入「## 可选技能目录」区块；`report_analysis` tool schema 仍包含 `suggested_skills` 字段，但 LLM 通常返回空数组

#### Scenario: report_analysis tool schema 包含 suggested_skills 字段
- **WHEN** analyze 调用构造 tool schema
- **THEN** schema 包含 `suggested_skills: { type: "array", items: { type: "string" }, description: "..." }`，列在最后位置（在 reference_price_updates 之后）

---

### Requirement: Monitoring run status tracking
系统 SHALL 记录每次监控运行的状态，支持 pending / completed / failed；分析完成时 SHALL 将本次使用的 skill 内容快照写入 `monitoring_runs.skill_snapshot` 字段以支持事后复盘；同时 SHALL 将 LLM 返回的 `suggested_skills` 写入 `monitoring_runs.suggested_skills` 字段。

#### Scenario: Run starts as pending
- **WHEN** 某策略的监控任务开始执行
- **THEN** 系统立即写入一条 `status=pending` 的 monitoring_run 记录

#### Scenario: Run completes successfully
- **WHEN** LLM 分析完成并返回结果
- **THEN** 系统将 monitoring_run 更新为 `status=completed`,写入 `analysis`、`has_action_items`;**不再**写入 `prices` 字段(数据源已迁移至 `price_snapshots`,`monitoring_runs.prices` 字段保留可读但新代码不再写入)

#### Scenario: Run fails
- **WHEN** 任意步骤(snapshot 读取、LLM 调用)发生异常
- **THEN** 系统将 monitoring_run 更新为 `status=failed`,error 字段记录错误信息

#### Scenario: 写入 skill 快照
- **WHEN** monitoring_run 完成，且本次注入了 ≥ 1 条 skill
- **THEN** 系统在更新 monitoring_run 时同时写入 `skill_snapshot: jsonb`，结构为 `[{ id, name, body_md_hash, body_md_preview }]`，其中 `body_md_hash` 为完整 body 的 sha256、`body_md_preview` 为前 500 字符

#### Scenario: 未注入 skill 时 snapshot 为空
- **WHEN** monitoring_run 完成，且策略未关联任何 skill
- **THEN** 系统写入 `skill_snapshot: []`（空数组，非 null），表示此次明确未使用 skill

#### Scenario: 写入推荐 skill 列表
- **WHEN** monitoring_run 完成，且 LLM 返回 `suggested_skills`（无论数组是否为空）
- **THEN** 系统在更新 monitoring_run 时同时写入 `suggested_skills: jsonb`，存为 string 数组（按 LLM 返回顺序原样保留）

#### Scenario: LLM 未返回 suggested_skills 字段
- **WHEN** LLM 调用未在 tool 输入中包含 `suggested_skills` 字段（fallback 行为）
- **THEN** 系统写入 `suggested_skills: []`（空数组，非 null）

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
系统 SHALL 在侧边栏导航菜单项中展示未读通知数量角标。

#### Scenario: Unread count displayed on menu item
- **WHEN** 存在 `is_read = false` 的通知
- **THEN** 侧边栏"通知"菜单项右侧显示未读数量角标（红色圆形数字）

#### Scenario: No unread notifications
- **WHEN** 所有通知均已读
- **THEN** 侧边栏"通知"菜单项不显示角标

---

### Requirement: View notification and mark as read
用户 SHALL 能够在独立通知页面查看通知并标记为已读。

#### Scenario: View notification list page
- **WHEN** 用户通过侧边栏点击"通知"菜单项
- **THEN** 系统展示独立通知列表页面（`/notifications`），显示标题、策略名称、时间、已读/未读状态，支持筛选和批量操作

#### Scenario: Navigate to monitoring run detail
- **WHEN** 用户点击某条通知
- **THEN** 系统将该通知标记为已读，跳转到 `/monitoring?runId=<monitoringRunId>`，监控中心页面自动展开对应运行记录

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

---

### Requirement: Notification click navigates to specific monitoring run
系统 SHALL 在用户点击通知时精确跳转到对应的监控运行详情。

#### Scenario: Click notification navigates with runId
- **WHEN** 用户点击某条通知
- **THEN** 系统跳转到 `/monitoring?runId=<monitoringRunId>`，监控中心页面接收 runId 参数后自动定位并展开对应的 monitoring_run 记录

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

