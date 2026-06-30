# ai-berkshire 移植 · 子项目 D：Watchlist 轻量清单 — Design

> 让用户记录「未持仓但在观察」的标的，与持仓页（positions）分离。
> 灵感源自 ai-berkshire 的 `data/watchlist.json` 与「筛选公司」「召回池」概念，但 trader 选择最小可行形态 — 纯手动 CRUD，不介入监控流程。

## 背景与动机

trader 当前数据模型只有「strategy + position」，没有「观察中但未建仓」的中间形态。用户在实际操作中会有大量这种标的 — quality-screen 过了但等估值回调、看了财报想跟踪但不下单、读了某行业报告想圈个 watchlist。

ai-berkshire 的「筛选公司/召回池」是研究漏斗的中间产物，但 trader 不是研究工具 — 我们只需要一个「轻量列表 + 备注」即可，记账性质，不做监控、不做价格刷新、不做自动分析。

### 决策日志

| 决策点 | 选择 | 替代方案 | 理由 |
|---|---|---|---|
| 范围 | 轻量清单（symbol + 备注 + tags） | 状态机 / 监控身份 | YAGNI；先看用户是否真的用起来再扩展 |
| 与现有模型关系 | 平级独立表，与 strategy/position 无外键 | 作为 strategy 的前置 / 作为 position 的草稿 | 简单；将来转持仓只需在 strategy 创建时手动复制 symbol |
| 是否参与 monitoring | 否 | 跑价格 / 跑基本面 | 范围外；保持记账性质 |
| 价格显示 | 不显示 | 显示当前价 | 价格刷新需要走 price-snapshots，会污染 watchlist 的「轻量」定位；v1 不做 |
| 通知 | 无 | 价位提醒 | 范围外 |
| 标签机制 | string[] | 独立 tags 表 | 与 strategy/skill 现有 jsonb tags 模式一致 |

## 范围

### 在范围内

- `packages/db/src/schema.ts` 新增 `watchlist` 表
- 手写 SQL migration：`scripts/migrate-2026-06-30-watchlist.sql`
- `apps/web/app/api/watchlist/route.ts`：GET（列表，按 createdAt desc）、POST（新增）
- `apps/web/app/api/watchlist/[id]/route.ts`：PATCH（编辑）、DELETE
- `apps/web/app/watchlist/page.tsx`：表格视图（symbol / name / notes 截断 / tags / createdAt） + 新增弹窗 + 编辑弹窗 + 删除确认
- `apps/web/app/layout.tsx` 或导航组件增加 `/watchlist` 入口
- 单元测试：API 路由的 happy path 与边缘 case；page 的 list/create/edit/delete 交互

### 不在范围内（YAGNI）

- 价格刷新 / 价位提醒 / 推送通知
- 与 strategy / position 的关联（不做外键也不做"转持仓"按钮）
- 状态机（观察中 / 研究中 / 准备买 / 已撤销）
- 监控分析参与
- 财务指标关联（即便子项目 C 完成）
- 全文搜索（symbol 和 tags 数量预计 < 100 条，前端 filter 足够）
- 导入 / 导出
- 历史日志（"何时加入 watchlist"已通过 createdAt 体现，无需更详细）

## 数据模型

```ts
// packages/db/src/schema.ts
export const watchlist = pgTable("watchlist", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  symbol: text("symbol").notNull(),       // 大写归一化，如 "AAPL"、"700.HK"
  name: text("name"),                     // 中文/英文公司名，可选
  notes: text("notes"),                   // markdown 备注，可选，建议 ≤ 2000 字
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("watchlist_symbol_unique").on(t.symbol),
]);

export type WatchlistRow = typeof watchlist.$inferSelect;
export type NewWatchlistRow = typeof watchlist.$inferInsert;
```

约束：
- `symbol` 唯一（同一标的不重复入 watchlist；如重复用编辑而非新增）
- `notes` 在 API 层校验 ≤ 4000 字符

## API 设计

### GET `/api/watchlist`

返回：`WatchlistRow[]`，按 `createdAt desc`。

### POST `/api/watchlist`

入参：

```ts
{
  symbol: string;
  name?: string;
  notes?: string;
  tags?: string[];
}
```

校验：symbol 必填，trim + uppercase；name 可选；notes ≤ 4000；tags 数组每个 ≤ 32 字符且 ≤ 8 个。

冲突：symbol 重复返回 409。

### PATCH `/api/watchlist/[id]`

部分更新。`symbol` 修改也要走唯一性校验。

### DELETE `/api/watchlist/[id]`

物理删除（无关联数据，无需 cascade）。

## 页面设计

`/watchlist` 路由：

```
┌────────────────────────────────────┐
│ 观察清单                      [+ 新增]│
│ ────────────────────────────────── │
│ [搜索 / tag 过滤] (前端筛选)         │
│ ────────────────────────────────── │
│ Symbol  Name      Tags      Added  │
│ AAPL    苹果      [科技]    6/30   │
│ 700.HK  腾讯      [中概]   6/28   │
│ ...                                │
│ ────────────────────────────────── │
│ 点击行 → 展开编辑面板（侧滑或下拉）  │
└────────────────────────────────────┘
```

UI 复用现有 shadcn：
- 表格用 `<Table>` 组件（参考 `/positions` 页）
- 新增 / 编辑用 `<Dialog>` + `<Form>`
- 删除确认用 `<AlertDialog>`
- Tag chips 用 `<Badge>`

导航入口：在主 layout / Sidebar 加 `Watchlist` 链接，紧邻 `Positions`。

## 测试策略

1. **API 单测**（`apps/web/app/api/watchlist/__tests__/`）：
   - GET 空列表 / 多条按 createdAt desc
   - POST happy path / symbol 重复 409 / notes 超长 400 / tags > 8 400
   - PATCH 部分更新 / symbol 改重号 409
   - DELETE 存在 / DELETE 不存在 404
2. **page 测试**（vitest + RTL）：
   - 加载列表
   - 点新增 → 填写 → 提交 → 出现在列表
   - 点编辑 → 改 notes → 保存
   - 点删除 → 确认 → 消失
3. **手动验收**：本地添加 5 条 watchlist，刷新页面持久化 OK，导航入口可见。

## 风险与开放问题

| 风险 | 影响 | 应对 |
|---|---|---|
| Migration 部署遗漏（阿里云 docker-compose 不自动跑 migration） | 中 | 沿用现有 `scripts/migrate-*.sql` 与 README 部署步骤的说明 |
| 用户期待 watchlist 自动跑监控 / 报价 | 中 | spec 明确范围；UI 上加一行文案「轻量记账，不做监控」 |
| 与未来「漏斗」概念冲突 | 低 | 未来如要做完整研究漏斗，可在 watchlist 上加 status 字段；当前 schema 不阻塞 |
| 同一公司多市场（如 700.HK / TCEHY） | 低 | 不处理 — 用户自己决定记哪个 symbol |

## 验收标准

- [ ] `/api/watchlist` 四个端点 happy path + 边缘 case 测试全绿
- [ ] `/watchlist` 页面能列表 / 新增 / 编辑 / 删除
- [ ] 导航栏含 watchlist 入口
- [ ] symbol 重复时新增返回 409，前端显示「该标的已在 watchlist」
- [ ] migration SQL 能在本地 db 干净跑过
- [ ] README 部署章节如有改动同步更新
