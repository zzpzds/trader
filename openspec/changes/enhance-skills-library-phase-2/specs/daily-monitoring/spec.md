## MODIFIED Requirements

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
