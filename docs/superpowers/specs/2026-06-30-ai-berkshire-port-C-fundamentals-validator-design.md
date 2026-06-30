# ai-berkshire 移植 · 子项目 C：TS 财务校验器（Finnhub fundamentals）— Design

> 在监控分析时给 LLM 注入一段「确定性算好」的基本面快照，避免 LLM 自己估算/编造财务指标。
> 灵感源自 ai-berkshire/tools/financial_rigor.py，但用 Finnhub basic financials API 替代多个 Python 数据源，纯 TS 实现。

## 背景与动机

子项目 A 引入了 quality-screen（7 条去劣指标）、investment-checklist（六关）等需要财务指标的 skill。但 trader 现有数据流只有价格 / OHLC，LLM 在执行这些 skill 时只能：

- 凭训练数据回忆（容易过时、容易编造）
- 或诚实标注「数据不足」（分析价值打折）

复用 Finnhub `/stock/metric?metric=all` 接口（免费档已含 basic financials）可以拿到 ROE、毛利率、净利率、FCF margin、负债权益比、ROIC 等约 60 个指标。把这些指标格式化为 markdown 块注入 prompt，让 LLM 基于真实数据执行 skill。

同时实现 quality-screen 的 7 条硬规则的纯 TS 版本 — 不替代 LLM 判断，而是给 LLM 提供「7 条规则已通过 / 未通过」的预计算事实，让分析更确定。

### 决策日志

| 决策点 | 选择 | 替代方案 | 理由 |
|---|---|---|---|
| 数据源 | Finnhub basic financials | LLM 自检索 / 手填 / 多源 | trader 已接 Finnhub，免费档已含 metric API；零新依赖 |
| 触发时机 | monitoring run 开始时按持仓 symbol 拉取 | 每日定时 / on-demand | 与 price-snapshots 模式一致；按需即时 |
| 缓存粒度 | 按 symbol 24h | 7 天 / 不缓存 | 基本面更新频率（季度）远低于价格；24h 足够 |
| 存储 | 新表 `fundamental_snapshots` | 直接放 jsonb / 内存缓存 | 与现有 price snapshot 模式对齐，便于查询历史 |
| A 股 / 港股 fallback | 输出「数据不可得」提示 | 报错 / 跳过 | Finnhub 主要覆盖美股；非美股 LLM 仍能跑 skill，只是不强制基本面通过 |
| 校验器位置 | `apps/worker/src/monitoring/fundamentals.ts` | `packages/db` / 共享包 | 仅 worker 用；先放就近，未来真要复用再抽 |
| 输出形态 | prompt 注入块 + （v1 不存）quality check 结果 | 存到 monitoring_runs / API 暴露 | v1 先让 LLM 看到数据；存储和 API 留给后续 |

## 范围

### 在范围内

- `apps/worker/src/monitoring/finnhub-fetch.ts`：新增 `fetchBasicFinancials(symbol)`，调用 Finnhub `/stock/metric?metric=all`，提取关键字段
- 新文件 `apps/worker/src/monitoring/fundamentals.ts`：
  - 类型定义 `FundamentalsSnapshot`
  - `getOrFetchFundamentals(symbol)` — 优先读 db 24h 内缓存，未命中则拉 Finnhub 并写入
  - `formatFundamentalsBlock(snapshots: FundamentalsSnapshot[]): string` — 纯函数，输出注入 prompt 的中文 markdown
  - `runQualityChecks(snapshot: FundamentalsSnapshot): { passed: string[]; failed: string[]; ungraded: string[] }` — 实现 quality-screen 7 条硬规则 + 3 条豁免
- `packages/db/src/schema.ts` 新增 `fundamental_snapshots` 表
- Drizzle migration（手写 SQL，沿用 `scripts/migrate-*.sql` 模式）
- `apps/worker/src/monitoring/job.ts`：在调用 analyze 前先 `getOrFetchFundamentals` 当前 strategy 涉及的 symbols
- `apps/worker/src/monitoring/analyze.ts`：新增 `fundamentals: FundamentalsSnapshot[]` 入参；`skillsBlock` 之前注入 `## 基本面快照` 块
- 单元测试：fetch（mock）、format（pure）、checks（pure）、缓存命中/未命中

### 不在范围内（YAGNI）

- 财务指标的历史趋势图（5 年 ROE 曲线之类）
- A 股 / 港股数据源接入（用其他 API）
- 把 quality check 结果存进 monitoring_runs（v1 仅给 LLM 看）
- watchlist 上的 symbol 也拉基本面（属子项目 D 之后的扩展）
- 财务指标的 UI 展示页面
- Finnhub 接口超额 fallback（按当前账户配额评估，免费 60 calls/min 足够单人）

## 数据模型

```ts
// packages/db/src/schema.ts
export const fundamentalSnapshots = pgTable("fundamental_snapshots", {
  symbol: text("symbol").primaryKey(),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  source: text("source").notNull().default("finnhub"),
  // 关键指标，按 Finnhub metric 命名映射到 camelCase
  data: jsonb("data").$type<FundamentalsData>().notNull(),
}, (t) => [
  index("fundamental_snapshots_fetched_at_idx").on(t.fetchedAt),
]);

export type FundamentalsData = {
  // 盈利能力
  roeTTM?: number;        // %
  roa5Y?: number;         // %
  netMarginTTM?: number;  // %
  grossMarginTTM?: number;// %
  operatingMargin5Y?: number; // %
  // 现金流
  fcfMarginTTM?: number;
  fcfPerShareTTM?: number;
  cashFlowToNetIncome?: number;
  // 杠杆
  debtToEquity?: number;
  interestCoverage?: number;
  // 估值
  peTTM?: number;
  pbTTM?: number;
  dividendYieldIndicatedAnnual?: number;
  // 增长
  revenueGrowth5Y?: number;
  epsGrowth5Y?: number;
  // 股本
  sharesOutstanding?: number;
  shareBuybackRatio?: number;
};
```

迁移文件名：`scripts/migrate-2026-06-30-fundamental-snapshots.sql`

## 模块设计

### `finnhub-fetch.ts` 增量

```ts
export interface FinnhubBasicFinancials {
  symbol: string;
  metric: Record<string, number | null>;
  metricType: string;
}

export async function fetchBasicFinancials(symbol: string, apiKey: string): Promise<FinnhubBasicFinancials> {
  const url = `https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${apiKey}`;
  // 标准 fetch，错误处理同现有 price fetch
}
```

### `fundamentals.ts` 主接口

```ts
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function getOrFetchFundamentals(symbol: string): Promise<FundamentalsSnapshot | null> {
  const cached = await db.query.fundamentalSnapshots.findFirst({ where: eq(fundamentalSnapshots.symbol, symbol) });
  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) return cached;
  try {
    const raw = await fetchBasicFinancials(symbol, env.FINNHUB_API_KEY);
    const data = mapFinnhubToFundamentalsData(raw);
    const inserted = await db.insert(fundamentalSnapshots).values({ symbol, data }).onConflictDoUpdate({ target: fundamentalSnapshots.symbol, set: { data, fetchedAt: new Date() } }).returning();
    return inserted[0];
  } catch (err) {
    console.warn(`[fundamentals] fetch failed for ${symbol}:`, err);
    return cached ?? null;  // 失败时退而求其次用旧缓存
  }
}

export function formatFundamentalsBlock(snapshots: FundamentalsSnapshot[]): string {
  if (snapshots.length === 0) return "";
  const rows = snapshots.map(formatOneSnapshot).join("\n\n");
  return `## 基本面快照（数据源：Finnhub，缓存 24h）\n\n${rows}\n\n`;
}

export function runQualityChecks(s: FundamentalsSnapshot): QualityCheckResult {
  const passed: string[] = [];
  const failed: string[] = [];
  const ungraded: string[] = [];
  // 7 条硬规则：
  // 1. 10Y avg ROE >= 8%       (Finnhub 提供 5Y，先用 5Y 替代)
  // 2. 5Y 累计 FCF 为正
  // 3. 利息覆盖倍数 >= 2
  // 4. 长期毛利率 >= 15%
  // 5. CFO/NI >= 0.7
  // 6. 长期净利率 >= 5%
  // 7. 5Y 股本膨胀 <= 20%
  // 数据缺失则 ungraded（不算 failed）
  return { passed, failed, ungraded };
}
```

### `analyze.ts` 改动

```ts
// 新增入参
fundamentals: FundamentalsSnapshot[] = [],

// 在 skillsBlock 之前注入
const fundamentalsBlock = formatFundamentalsBlock(fundamentals);
// ...
${fundamentalsBlock}${skillsBlock}${catalogBlock}${memoriesBlock}## 策略：${strategyName}
```

### `job.ts` 改动

```ts
// 在调用 createAnalyzer() 之前
const symbols = uniqueSymbolsFromPositions(positions);
const fundamentals = await Promise.all(symbols.map(getOrFetchFundamentals)).then((arr) => arr.filter((x): x is FundamentalsSnapshot => x !== null));
// 传给 analyzeStrategy(..., fundamentals)
```

## 测试策略

1. **Pure function 测试**（最重要）：
   - `formatFundamentalsBlock` — 给定 mock snapshot，断言 markdown 结构 + 数字精度
   - `runQualityChecks` — 7 条规则各写一个 case（通过/失败/ungraded），3 条豁免规则各一个 case
   - `mapFinnhubToFundamentalsData` — 给定 mock Finnhub 响应，断言字段映射
2. **集成测试**：
   - `getOrFetchFundamentals` 缓存命中：先 insert，再调用，不应触发 fetch（mock fetch 报错验证）
   - 缓存过期：fetchedAt 设为 25h 前，应触发 fetch
   - Fetch 失败时退回 stale cache：mock fetch reject + stale cache，应返回 stale
3. **analyze prompt 测试**：扩展 `analyze.test.ts`，断言传入 fundamentals 时 prompt 含「基本面快照」标题；不传入时不含
4. **手动验收**：用真实持仓跑一次 monitoring，确认 prompt 中有基本面数据，分析质量提升明显

## 风险与开放问题

| 风险 | 影响 | 应对 |
|---|---|---|
| Finnhub 免费档不含 basic financials | 高 | spec 阶段需先验证（一次手动 curl 调用即可） |
| Finnhub 数据精度差（如 ROE 与年报对不上） | 中 | 接受 — 用于「数量级判断」而非精算；如系统性偏差再换源 |
| A 股 / 港股大量持仓时基本面段落为空 | 中 | `formatFundamentalsBlock` 显式输出「{symbol}: 数据不可得（Finnhub 不支持）」让 LLM 知情 |
| 60 个指标全注入 prompt token 过多 | 中 | 仅注入 12-15 个关键指标，其余只在 quality check 时用 |
| 新 db 表迁移与 Docker 部署的兼容性 | 中 | 沿用现有 `scripts/migrate-*.sql` 模式，部署文档无需改 |
| 缓存 24h 错过财报日突变 | 低 | 接受 — 财报日有专门的 earnings-review skill 触发，基本面对日内决策影响小 |

### 开放问题

- [ ] **先验证**：Finnhub 免费 token 调用 `/stock/metric?metric=all&symbol=AAPL` 是否返回完整数据。若 401/403，本子项目作废或需用户升级 Finnhub 套餐。
- [ ] 选哪 12-15 个指标作为「key metrics」注入 prompt？建议先列：ROE TTM、毛利率 TTM、净利率 TTM、FCF margin、CFO/NI、debt/equity、PE TTM、PB TTM、dividend yield、revenue growth 5Y、shares outstanding 变化、利息覆盖倍数。spec 实施阶段最终确定。

## 验收标准

- [ ] `fetchBasicFinancials("AAPL", key)` 返回非空数据（手动验证）
- [ ] `fundamental_snapshots` 表创建成功，缓存读写工作
- [ ] monitoring run 跑完后 `monitoring_runs.analysis` 中可见引用基本面数据
- [ ] 7 条 quality check 规则单测全绿
- [ ] 非美股持仓不阻断 monitoring（分析中显式标注「数据不可得」）
- [ ] worker 日志在缓存命中时不再调用 Finnhub API
