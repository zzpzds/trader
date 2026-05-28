## Context

持仓系统目前记录每笔 lot 的成本价，并通过 monitoring_run.prices 快照计算浮动盈亏，但没有"参考价"字段。策略规则（如加仓触发、重置触发）依赖参考价作为基准，不持久化则无法跨日连续运行。策略规则存储为自由文本，由 LLM 解读，不做结构化 DSL 存储。

## Goals / Non-Goals

**Goals:**
- 持久化参考价到 `positions.reference_price`
- 首笔 lot 建仓时自动将 cost_price 写入 reference_price
- LLM 在每日分析中检测重置条件并输出新参考价，worker 写回 DB
- 提供手动覆盖入口（PATCH API + UI inline edit）
- 参考价更新时创建通知

**Non-Goals:**
- 不存储加仓次数（不属于本期需求）
- 不持久化阈值参数（保留在策略文本中，由 LLM 解读）
- 不记录参考价历史变更记录

## Decisions

**Decision 1: 存在 positions 表而非独立表**

候选方案：
- A) `positions.reference_price` 可空字段（选定）
- B) 独立 `position_states` 表

选 A 的理由：当前规模无需历史追溯，独立表增加 join 和维护成本。单字段足够覆盖全部需求。

**Decision 2: LLM 扩展 tool schema 输出 reference_price_updates**

候选方案：
- A) 扩展现有 `report_analysis` tool，增加 `reference_price_updates[]` 字段（选定）
- B) 独立第二次 LLM call 专门判断参考价

选 A 的理由：单次 call 完成分析 + 参考价判断，成本最低，与现有流程融合最自然。

**Decision 3: 首笔 lot 初始化，后续 lot 不覆盖**

初始化时机：`upsertPositionAndCreateLot` 在创建新 position 时（`existing == null` 分支）将 `costPrice` 写入 `referencePrice`。加仓 lot 不影响参考价。手动覆盖通过 PATCH API 完成。

## Risks / Trade-offs

- [LLM 判断误差] LLM 可能误触发参考价更新 → 提供 UI 手动覆盖入口作为修正手段
- [Nullable 迁移] 已有 positions 行 reference_price 为 null，前端和 worker 均需处理 null 展示（"未设定"）和跳过逻辑

## Migration Plan

1. `pnpm --filter @trader/db db:push` — 加列（可空，无需回填）
2. `pnpm --filter @trader/db build` — 重建 dist 类型
3. 部署 web + worker 新版本
4. 回滚：列可空，旧版本代码忽略该字段，无破坏性

## Open Questions

无
