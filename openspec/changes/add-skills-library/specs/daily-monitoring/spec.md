## MODIFIED Requirements

### Requirement: LLM analyzes strategy with positions and prices via tool_use
系统 SHALL 使用 Claude API tool_use 模式分析策略持仓状态，返回结构化报告；调用前 SHALL 加载该策略关联的 skill 内容并注入 prompt 顶部以增强方法论指导。

#### Scenario: Successful analysis
- **WHEN** 价格数据获取成功后
- **THEN** 系统组装包含策略描述、当前持仓明细（股数/成本/盈亏）、近期价格数据的 prompt，调用 LLM；LLM 通过 `report_analysis` 工具返回 `{ analysis, has_action_items, action_summary }`

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
- **THEN** 系统按原有 prompt 结构调用 LLM（不包含「## 可用方法论」区块），行为与本变更上线前完全一致

---

### Requirement: Monitoring run status tracking
系统 SHALL 记录每次监控运行的状态，支持 pending / completed / failed；分析完成时 SHALL 将本次使用的 skill 内容快照写入 `monitoring_runs.skill_snapshot` 字段以支持事后复盘。

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
