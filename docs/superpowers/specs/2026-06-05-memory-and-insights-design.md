# Memory Notes + Trade Insights — Design

> 本 spec 同时引入两个独立 capability：
> 1. **`memory-notes`** — 用户笔记 + 全文搜索，monitoring 时按策略/标的预加载到 LLM prompt
> 2. **`trade-insights`** — `/insights` 页面，基于现有 `positionLots` + `priceSnapshots` 计算 4 类交易行为诊断指标
>
> 灵感源自 Vibe-Trading 的 `agent/src/memory/persistent.py` 与 `agent/src/shadow_account/`，但完全在 trader 的 Node.js + PostgreSQL 栈中原生实现，不引入 Python sidecar。

## 背景与动机

trader 当前每次 monitoring 都是无状态的——LLM 看不到上次的判断、用户的复盘、对某只标的的长期看法。同时 `positionLots` 已经积累了完整的事务流水，但没有任何回溯分析（胜率、处置效应、追高、过度交易）。

这两个能力补足"个人交易系统"两个长期缺口：
- **横向上下文**：让 LLM 在 monitoring 时能记住跨日的判断与用户的笔记
- **纵向自省**：让用户看到自己交易行为的统计画像，而不只是当下的浮盈浮亏

### 决策日志

| 决策点 | 选择 | 替代方案 | 理由 |
|---|---|---|---|
| 写入方 | 用户手动 + monitoring_runs 自然沉淀 | LLM tool-use 主动 save_memory | LLM 输出已经在 monitoring_runs 里，无需双写；保持 analyze.ts 现有结构 |
| 实体绑定 | 全局 + 可选 strategyId/symbol | 强制绑定 / 纯全局 | 写笔记时不强制选策略；按策略筛选时仍可命中 |
| 全文搜索 | `pg_trgm` (contrib) | `tsvector` + 中文分词 / `LIKE` | CJK 友好、不需第三方扩展、几万条以内性能足够 |
| LLM 接入方式 | 只读 + 预加载 | tool-use 双向 | 不动 analyze.ts 的 tool schema；最低风险 |
| monitoring_runs 入检索 | v1 不入 | 一开始就 union | 当前没有"翻历史 LLM 分析"的明确需求；YAGNI |
| insights 计算时机 | 请求时实时算 | 每日 worker 预算 + 缓存 | 单人 < 1000 lot 量级，纯函数毫秒级 |

## 范围

### 在范围内

- 新增 `memories` 表 + pg_trgm 索引迁移
- `/api/memories/*` CRUD + 检索 API
- `/api/insights` 计算 API
- `/memory` 页（列表 + 搜索 + CRUD）
- `/insights` 页（全局 / 按策略两 tab，4 类指标卡片）
- `/strategies/[id]` 页面新增 "Notes" tab
- monitoring `analyze.ts` 接受 `memories` 入参，prompt 中插入"你之前留下的相关笔记"段
- 单元测试覆盖 insights 四类指标 + memory 检索 + analyze prompt 注入

### 不在范围内（YAGNI）

- 笔记导入/导出（CSV、Markdown）
- 笔记版本历史
- 全文搜索结果高亮
- 行为诊断的历史趋势曲线（v1 只展示当前快照）
- LLM 自动撰写或归类笔记
- 跨设备同步、移动端推送
- 把 `monitoring_runs.analysis` 也加入笔记检索源

## 数据模型

### `memories` 表

```ts
// packages/db/src/schema.ts
export const memories = pgTable("memories", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  content: text("content").notNull(),
  kind: text("kind", { enum: ["note", "idea", "lesson", "context"] })
    .notNull().default("note"),
  strategyId: text("strategy_id").references(() => strategies.id, { onDelete: "set null" }),
  symbol: text("symbol"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("memories_strategy_idx").on(t.strategyId),
  index("memories_symbol_idx").on(t.symbol),
  index("memories_pinned_idx").on(t.pinned),
]);
```

`kind` 取值含义：
- `note` — 复盘笔记（默认）
- `idea` — 想法、假设
- `lesson` — 经验教训
- `context` — 背景资料 / 长期看法

`symbol` 不做外键，允许记录尚未持仓的标的（关注列表）。

### pg_trgm 迁移

```sql
-- packages/db/drizzle/<n>_memories_pgtrgm.sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX memories_title_trgm_idx
  ON memories USING gin (title gin_trgm_ops);

CREATE INDEX memories_content_trgm_idx
  ON memories USING gin (content gin_trgm_ops);
```

### Insights 不需要新表

`positionLots` + `priceSnapshots` + `positions.referencePrice` 已经足够。计算输出的 TypeScript 类型：

```ts
// apps/web/lib/insights.ts
export interface InsightsReport {
  basic: {
    closedTrades: number;
    winRate: number;          // 0-1，已平仓交易胜率
    avgHoldDays: number;
    profitLossRatio: number;  // 平均盈利 / 平均亏损绝对值
    totalRealizedPnl: number;
    maxDrawdown: number;      // 基于按日 P&L 曲线的最大回撤金额
  };
  disposition: {
    avgHoldDaysWinners: number;
    avgHoldDaysLosers: number;
    score: number;            // (avgLosers - avgWinners) / max(avgLosers, 1)；越正越严重
    flag: "none" | "mild" | "severe";
  };
  anchoring: {
    avgChaseHighPct: number;  // BUY 价 vs 该 lot 前 30 日最高价的偏离均值，>0 即追高
    chaseRate: number;        // count(BUY where price > 30日均线) / count(BUY)，比例 0-1
    avgVsRefPct: number;      // 仅有 referencePrice 的 lot：BUY 价 vs 当时 referencePrice 偏离
    flag: "none" | "mild" | "severe";
  };
  overtrading: {
    avgTradesPerWeek: number;
    flipsWithin3d: number;     // 同标的 3 天内反复开平仓的次数
    flag: "none" | "mild" | "severe";
  };
}
```

阈值常量（写在 `insights.ts` 顶部）：

| 指标 | mild | severe |
|---|---|---|
| disposition.score | > 0.3 | > 0.6 |
| anchoring.avgChaseHighPct | > 5% | > 15% |
| overtrading.avgTradesPerWeek | > 5 | > 10 |
| overtrading.flipsWithin3d | (任意 ≥ 1) | ≥ 3 |

空态：`closedTrades < 5` 时返回 `null`，前端展示空态文案"交易数据不足，需至少 5 笔已平仓交易"。

## API

### Memory CRUD + 搜索

```
GET    /api/memories?strategyId=&symbol=&kind=&pinned=&q=&limit=20
POST   /api/memories       body: { title, content, kind?, strategyId?, symbol?, tags?, pinned? }
GET    /api/memories/:id
PATCH  /api/memories/:id   body: 任意字段子集（kind/title/content/strategyId/symbol/tags/pinned）
DELETE /api/memories/:id
```

行为：
- `q` 走 pg_trgm：`ORDER BY GREATEST(similarity(title,$q), similarity(content,$q)) DESC` + 阈值 0.1
- `q` 长度 < 2 时退化为 `LIKE %q%`（避免短查询召回过低）
- 其他过滤参数 AND 组合
- `limit` 默认 20，上限 100
- 默认排序：`pinned DESC, updatedAt DESC`

### Insights

```
GET /api/insights                 # 全局
GET /api/insights?strategyId=xxx  # 单策略
```

返回 `InsightsReport | { empty: true, reason: "insufficient_data" }`。

## LLM 集成

### `loadRelevantMemories(strategyId, symbols)` —— 新增模块 `apps/worker/src/monitoring/load-memories.ts`

规则（不调 LLM、不做 embedding，纯 SQL）：

1. **pinned 全集**：`pinned = true AND (strategyId = ? OR strategyId IS NULL)`，按 updatedAt 倒序
2. **该策略的最近笔记**：`strategyId = ?` 最近 30 天，最多 5 条
3. **该策略涉及标的的最近笔记**：`symbol IN (?,?,...)` 最近 30 天，最多 5 条
4. 三类去重（按 id），合并后按 `pinned DESC, updatedAt DESC`，截断到总条目 ≤ 8 条 / 每条内容 ≤ 200 字符 / 总字符 ≤ 4000

返回 `Array<{ id, title, kind, symbol?, contentPreview }>`。

### `analyzeStrategy` 签名变更

```ts
analyzeStrategy(
  strategyName: string,
  strategyContent: string,
  positions: PositionInfo[],
  prices: ...,
  memories: RelevantMemory[]    // ← 新参数，默认空数组
)
```

prompt 中"## 当前持仓"上方插入：

```markdown
## 你之前留下的相关笔记

- [pinned · idea] 看好 NVDA 长期：H100 订单 backlog 仍然 > 1Q
- [note · NVDA] 6/2 复盘：130 这一档不再视作压力位
（无相关笔记时本段省略）
```

失败兜底：`loadRelevantMemories` 抛错时记 warn 日志、传空数组进 analyzeStrategy，monitoring 流程继续。

### `apps/worker/src/monitoring/job.ts` 串接

现流程：`fetchPrices → analyzeStrategy(...) → save run`
新流程：`fetchPrices → loadRelevantMemories → analyzeStrategy(..., memories) → save run`

## UI

### 全局导航

`apps/web/components/layout/sidebar.tsx` 与 `apps/web/components/layout/mobile-nav.tsx` 同步新增两项：
- 笔记 → `/memory`
- 行为诊断 → `/insights`

### `/memory` 页

布局：
- 顶部：搜索框（debounce 300ms，调 `?q=`） + 类型筛选（kind）+ 策略筛选 + "新建笔记"按钮
- 列表：卡片式，每张卡显示 title / kind 徽章 / strategy/symbol 标签 / updatedAt / pinned 图标（📌）
- 卡片点击 → shadcn Dialog 编辑（title / kind / content / strategyId / symbol / tags / pinned）
- 空态："还没有笔记，monitoring 时不会注入任何上下文"

### `/strategies/[id]` 页面 — 新 Notes tab

- 调 `/api/memories?strategyId=<id>` 平铺展示
- 顶部 "新建（自动绑定该策略）" 按钮 → 复用 Dialog
- 不在策略详情页放 insights tab

### `/insights` 页

布局：
- 顶部两个 tab：「全局」和「按策略」
- 「全局」tab：4 张卡片
  - **基础财务** — 胜率 / 盈亏比 / 平均持仓天数 / 已实现总盈亏 / 最大回撤
  - **处置效应** — 顶部一句结论 + 赢家/输家平均持仓天数对比 + score + flag 颜色
  - **锚定/追高** — avgChaseHighPct / chaseRate / avgVsRefPct + flag
  - **过度交易** — avgTradesPerWeek / flipsWithin3d + flag
- 「按策略」tab：左侧策略列表（点击切换），右侧同样 4 张卡片但作用域是选中策略
- flag 颜色：none 灰 / mild 黄 / severe 红
- 空态："交易数据不足，需至少 5 笔已平仓交易"

## 测试

### `packages/db/src/schema.test.ts`

- memories 表 CRUD：插入、按 strategyId 查、按 symbol 查、按 pinned 查
- 删除关联策略后 `strategyId` 应被设为 NULL（onDelete: "set null"）

### `packages/db/src/memory-search.test.ts` （新文件）

跑真实 PG（沿用 db 包现有 vitest 配置）：
- pg_trgm 扩展 + 索引创建成功
- 中文短查询（"NVDA"、"加仓"）能命中
- 相似度阈值 0.1 过滤生效

### `apps/web/lib/insights.test.ts` （新文件）

四类指标各一组手写 fixture：
- 已知胜率 60% / 盈亏比 2.0 的 lot 序列 → 验证 basic
- 赢家 5 天卖、输家 60 天扛 → 验证 disposition.flag = "severe"
- 每次 BUY 都在 30 日新高 +20% → 验证 anchoring.flag = "severe"
- 一周 8 笔 + 3 天反复开平 → 验证 overtrading.flag = "severe"
- closedTrades < 5 → 返回 empty

### `apps/worker/src/monitoring/__tests__/analyze.test.ts`（已存在，扩展）

- 传入空 memories 数组 → prompt 不含"你之前留下的相关笔记"段
- 传入非空 memories → prompt 包含该段且条目按 pinned 顺序

### 不写

- E2E
- UI 快照测试
- 性能基准

## 风险与缓解

1. **pg_trgm 中文短查询召回偏低** —— 三字符 ngram 对 2-3 字 CJK 查询不稳定。  
   **Mitigation**：`q.length < 2` 退化到 `LIKE`；阈值 0.1 起步；上线后观察召回率，如差则降到 0.05 或加 `LIKE` fallback union。

2. **monitoring prompt 字符预算被笔记吃光** —— 用户疯狂 pin 后 prompt 超 max_tokens 输入侧。  
   **Mitigation**：硬上限 8 条 / 每条 200 字 / 总 4000 字。pinned 也走这个上限，超出按 updatedAt 取最新。

3. **insights 全局视图扫表慢** —— 1000 lot × 250 日 snapshot 在 PG 上预期毫秒级，但 cold cache 首查可能 100ms+。  
   **Mitigation**：v1 不缓存；API route 加 timing log，> 500ms 报警；超阈值再考虑预算缓存表。

4. **空态判定误差** —— 只看 lots 数量，不区分 paper trade。  
   **Mitigation**：`closedTrades < 5` 严格按数据库实际行数判定，不引入 paper 概念。

5. **`loadRelevantMemories` 失败影响 monitoring** —— 数据库异常时不能让 monitoring 整体挂掉。  
   **Mitigation**：try/catch，错则 warn 日志 + 传空数组，monitoring 继续。

## 实现路径概览

按依赖顺序：
1. Schema + 迁移（memories 表 + pg_trgm 扩展 + 索引）
2. `apps/web/lib/memory-search.ts` + API routes（CRUD + search）
3. `apps/web/lib/insights.ts` 纯函数 + 单元测试
4. `apps/web/app/api/insights/route.ts`
5. `apps/worker/src/monitoring/load-memories.ts` + analyze.ts 改造 + job.ts 串接
6. `/memory` 页 + `/insights` 页 + 策略详情 Notes tab
7. 全局导航补两项

每一阶段独立可测，前 5 步是后端 + 数据，第 6-7 步是 UI。
