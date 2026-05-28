# 参考价（Reference Price）设计文档

**日期**：2026-05-28
**状态**：待实现

---

## 概述

为持仓系统引入"参考价"概念，支持策略中基于参考价的加仓/重置规则（如"股价 ≤ 参考价 × 90% 时加仓，股价 ≥ 参考价 × 115% 时重置参考价"）。参考价持久化存储在 `positions` 表，由 LLM 自动检测重置条件并更新，同时提供 UI 手动覆盖入口。

---

## 数据层

### Schema 变更

`positions` 表新增字段：

```typescript
referencePrice: numeric("reference_price", { precision: 15, scale: 4 })
// nullable，允许历史持仓无参考价
```

### 初始化逻辑

在 `POST /api/strategies/[id]/lots` 创建首笔 lot 时，若对应 position 的 `referencePrice` 为 null，则将本次 lot 的 `costPrice` 同步写入 `positions.referencePrice`。

后续加仓 lot 不影响参考价。

### 历史数据

迁移时已有 positions 行 `referencePrice` 置为 null，不自动回填。用户可通过 UI 手动设定。

---

## Worker 流程

### analyze.ts 变更

在 `report_analysis` tool schema 新增输出字段：

```typescript
reference_price_updates: {
  type: "array",
  items: {
    type: "object",
    properties: {
      symbol: { type: "string" },
      new_reference_price: { type: "number" }
    },
    required: ["symbol", "new_reference_price"]
  }
}
```

### Prompt 上下文补充

`positionSummary` 每行追加当前参考价，供 LLM 对比判断：

```
- ISRG: 10 shares @ avg $300.00, ref $300.00, latest $348.50, P&L +16.17%
```

LLM 读取策略规则文本 + 当前价格 + 参考价，判断重置条件是否触发，在结构化输出中填入 `reference_price_updates`。若 `referencePrice` 为 null，prompt 中标注"无参考价"，LLM 不会输出该 symbol 的更新。

### job.ts 变更

分析完成后遍历 `reference_price_updates`，对每个 symbol 更新 DB：

```typescript
await db.update(positions)
  .set({ referencePrice: update.new_reference_price.toFixed(4) })
  .where(and(
    eq(positions.strategyId, strategy.id),
    eq(positions.symbol, update.symbol)
  ));
```

若有参考价更新，在 notification 内容中附上变更说明（如"ISRG 参考价已更新为 $348.50"）。

---

## API

### 手动覆盖参考价

```
PATCH /api/strategies/[id]/positions/[positionId]/reference-price
Body: { referencePrice: string }
```

直接更新 `positions.referencePrice`，返回更新后的持仓数据。

---

## UI

在策略持仓页（`/strategies/[id]/positions`）的每个持仓行，参考价与当前最新价并排展示，`referencePrice` 为 null 时显示"未设定"。参考价旁附编辑按钮，点击后 inline 编辑，确认调用 PATCH 接口。

---

## 数据流总结

```
首笔 lot 创建
  → referencePrice = costPrice（自动写入）

Worker 每日执行
  → LLM 收到：策略规则 + 持仓信息（含 referencePrice） + 最新价格
  → LLM 输出：analysis + hasActionItems + reference_price_updates[]
  → job.ts 写入新参考价 + 生成通知

用户手动操作
  → PATCH /reference-price → 直接覆盖
```

---

## 非目标

- 不存储加仓次数（可从 positionLots 数量推算，或交由用户自行判断）
- 不存储加仓/重置阈值（阈值保留在策略文本中，由 LLM 解读）
- 不记录参考价变更历史（当前只维护最新值）
