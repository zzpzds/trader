## Why

策略持仓系统需要支持基于"参考价"的加仓/重置规则（如"股价 ≤ 参考价 × 90% 时加仓，股价 ≥ 参考价 × 115% 时重置"），但目前系统没有持久化参考价的机制，导致策略无法长期稳定运行。

## What Changes

- 在 `positions` 表新增 `reference_price` 可空字段
- 建仓首笔 lot 时自动将 `cost_price` 写入 `reference_price`
- Worker 每日分析时，LLM 检测重置条件并输出 `reference_price_updates`，job 写回数据库
- 参考价重置时生成通知提醒用户
- 新增 `PATCH /api/strategies/[id]/positions/[positionId]/reference-price` 手动覆盖接口
- 持仓页展示参考价，支持 inline 编辑

## Capabilities

### New Capabilities

- `reference-price`: 持仓参考价的持久化、自动初始化、LLM 自动更新与手动覆盖

### Modified Capabilities

- `position-management`: positions 表新增字段，建仓逻辑变更，持仓展示增加参考价字段

## Impact

- **数据库**: `positions` 表加列，需执行 `drizzle-kit push`，重建 `@trader/db`
- **API**: 新增 PATCH endpoint；`GET /positions` 响应中增加 `referencePrice` 字段
- **Worker**: `analyze.ts` 接口变更（`PositionInfo`、`AnalysisResult`），`job.ts` 新增写回逻辑
- **前端**: 持仓卡片展示参考价 + inline 编辑
