# 持仓股数支持小数设计

## 目标

将持仓批次的股数字段从整数改为最多 4 位小数的数值，支持碎股、基金份额等场景。

## 改动范围

### 1. 数据库 Schema（`packages/db/src/schema.ts`）

`positionLots.shares` 从 `integer` 改为 `numeric(15, 4)`，与 `costPrice` 保持一致。

```ts
// before
shares: integer("shares").notNull(),

// after
shares: numeric("shares", { precision: 15, scale: 4 }).notNull(),
```

### 2. 数据库迁移（新 SQL 文件）

```sql
ALTER TABLE position_lots ALTER COLUMN shares TYPE numeric(15,4);
```

### 3. 前端表单（`apps/web/app/strategies/[id]/page.tsx`）

- 股数 Input 加 `step="0.0001"`
- `parseInt(lotShares)` → `parseFloat(lotShares)`
- 股数显示：`lot.shares % 1 === 0` 时显示整数，否则显示去除尾部零的字符串

### 4. 类型一致性

drizzle 的 `numeric` 字段从 DB 返回为 **string**（与 `costPrice` 一致）：

- `Lot` interface：`shares: number` → `shares: string`
- `page.tsx` 中所有 `lot.shares` 用法改为 `parseFloat(lot.shares)`：
  - `calcAggregated`：`s + l.shares` → `s + parseFloat(l.shares)`
  - 显示：`{lot.shares}股` → `{formatShares(lot.shares)}股`（见下方辅助函数）
  - 汇总行：`{totalShares} 股` 也需 `formatShares`
- `position-service.ts`：`shares: number` 入参保持不变（接收 `parseFloat` 后的 JS number）

**辅助函数 `formatShares`**（放在组件文件顶部）：
```ts
function formatShares(shares: string | number): string {
  const n = typeof shares === "string" ? parseFloat(shares) : shares;
  return n % 1 === 0 ? String(n) : n.toString().replace(/\.?0+$/, "");
}
```

## 数据兼容性

- 存量数据均为整数，`ALTER COLUMN` 类型转换向上兼容，无数据丢失。

## 不在范围内

- 统计计算逻辑无需改动（已使用 `parseFloat` 处理）
- 其他字段精度不变
