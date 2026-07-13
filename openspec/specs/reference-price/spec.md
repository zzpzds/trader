## Requirements

### Requirement: Reference price auto-initialization
系统 SHALL 在为某 position 创建首笔 lot 时，自动将该 lot 的 cost_price 写入 positions.reference_price。

#### Scenario: First lot creates reference price
- **WHEN** 用户为某股票新增第一笔 lot（该 position 尚不存在）
- **THEN** 系统创建 position 时将 reference_price 设为该 lot 的 cost_price

#### Scenario: Subsequent lots do not overwrite reference price
- **WHEN** 用户为已有 position 的股票新增加仓 lot
- **THEN** 系统不修改 positions.reference_price，仅追加 lot 记录

---

### Requirement: LLM-driven reference price reset
系统 SHALL 支持 LLM 在每日监控分析中检测到重置条件时，通过结构化输出更新 positions.reference_price。

#### Scenario: LLM outputs reference price update
- **WHEN** LLM 分析判断某标的触发了策略的参考价重置规则，并在 reference_price_updates 字段中输出新值
- **THEN** worker 将对应 position 的 reference_price 更新为新值，并生成通知

#### Scenario: No reset triggered
- **WHEN** LLM 分析未检测到参考价重置条件（reference_price_updates 为空数组或缺失）
- **THEN** worker 不修改任何 position 的 reference_price

#### Scenario: Reference price null in LLM context
- **WHEN** 某 position 的 reference_price 为 null
- **THEN** LLM prompt 中标注该标的"无参考价"，LLM 不为该标的输出 reference_price_updates

---

### Requirement: Manual reference price override
用户 SHALL 能够通过 API 手动覆盖某 position 的参考价。

#### Scenario: Valid override
- **WHEN** 用户向 `PATCH /api/strategies/{id}/positions/{positionId}/reference-price` 提交 `{ referencePrice: "350.00" }`，且该 position 属于该策略
- **THEN** 系统将 positions.reference_price 更新为新值，返回更新后的 position 记录

#### Scenario: Position not found
- **WHEN** positionId 不存在或不属于该 strategyId
- **THEN** 系统返回 404

#### Scenario: Missing referencePrice body
- **WHEN** 请求 body 中缺少 referencePrice 字段
- **THEN** 系统返回 400

---

### Requirement: Reference price notification on reset
系统 SHALL 在参考价发生变更时创建通知。

#### Scenario: Notification on LLM-triggered reset (with action items)
- **WHEN** LLM 分析既有 action items 又有 reference_price_updates
- **THEN** 系统创建一条通知，内容包含行动建议及参考价变更说明

#### Scenario: Notification on LLM-triggered reset (no action items)
- **WHEN** LLM 分析无 action items 但有 reference_price_updates
- **THEN** 系统创建一条标题为"参考价更新"的通知，内容列出各标的新参考价
