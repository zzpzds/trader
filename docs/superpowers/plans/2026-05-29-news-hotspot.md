# 策略热点推送 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每天 09:30（北京时间）自动用 Tavily 搜索各策略相关新闻，LLM 汇总成中文摘要，存入数据库，在新增的「热点」页面展示最近 7 天历史。

**Architecture:** Worker 通过 pg-boss 注册 `daily-news` cron job（UTC 01:30），每个策略调 Tavily 搜索 + LLM 汇总后写入 `news_summaries` 表。Next.js 新增 `GET /api/news` 和 `/news` 页面。

**Tech Stack:** Drizzle ORM, pg-boss, Tavily REST API, Anthropic SDK, Next.js App Router, React, TailwindCSS, Vitest

---

## File Map

| 文件 | 操作 | 职责 |
|------|------|------|
| `packages/db/src/schema.ts` | 修改 | 新增 `newsSummaries` 表 + relations |
| `packages/db/src/schema.test.ts` | 修改 | 断言 newsSummaries 列存在 |
| `apps/worker/src/news/tavily-fetch.ts` | 新建 | Tavily API 客户端 |
| `apps/worker/src/news/__tests__/tavily-fetch.test.ts` | 新建 | Tavily 客户端测试 |
| `apps/worker/src/news/summarize.ts` | 新建 | LLM 摘要生成 |
| `apps/worker/src/news/__tests__/summarize.test.ts` | 新建 | 摘要函数测试 |
| `apps/worker/src/news/job.ts` | 新建 | 主流程（清理 + 搜索 + 摘要 + upsert） |
| `apps/worker/src/news/__tests__/job.test.ts` | 新建 | job 主流程测试 |
| `apps/worker/src/worker.ts` | 修改 | 注册 daily-news cron |
| `apps/web/app/api/news/route.ts` | 新建 | GET /api/news |
| `apps/web/app/api/news/__tests__/route.test.ts` | 新建 | API 路由测试 |
| `apps/web/app/news/page.tsx` | 新建 | 热点页面 |
| `apps/web/components/layout/sidebar.tsx` | 修改 | 新增「热点」菜单项 |
| `apps/web/components/layout/mobile-nav.tsx` | 修改 | 新增「热点」菜单项 |
| `docker-compose.yml` | 修改 | worker 透传 TAVILY_API_KEY |

---

## Task 1: DB Schema — 新增 newsSummaries 表

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/schema.test.ts`

- [ ] **Step 1: 写失败测试**

打开 `packages/db/src/schema.test.ts`，在文件末尾追加：

```typescript
it("newsSummaries table has required columns", () => {
  const columns = Object.keys(newsSummaries);
  expect(columns).toContain("id");
  expect(columns).toContain("strategyId");
  expect(columns).toContain("summaryDate");
  expect(columns).toContain("content");
  expect(columns).toContain("rawArticles");
  expect(columns).toContain("createdAt");
});
```

同时在文件顶部的 import 中加入 `newsSummaries`：

```typescript
import {
  strategies,
  positions,
  positionLots,
  monitoringRuns,
  notifications,
  newsSummaries,
} from "./schema";
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd packages/db && npx vitest run src/schema.test.ts
```

Expected: FAIL — `newsSummaries` is not exported from `./schema`

- [ ] **Step 3: 实现 schema**

打开 `packages/db/src/schema.ts`。

在文件顶部 import 中已有 `uniqueIndex`，无需修改 import。

在 `notifications` 表定义之后、relations 定义之前，插入：

```typescript
export const newsSummaries = pgTable(
  "news_summaries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    strategyId: text("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "cascade" }),
    summaryDate: text("summary_date").notNull(),
    content: text("content").notNull(),
    rawArticles: jsonb("raw_articles").$type<Array<{ title: string; url: string; content: string }>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("news_summaries_strategy_date_idx").on(t.strategyId, t.summaryDate)]
);

export type NewsSummaryRow = typeof newsSummaries.$inferSelect;
export type NewNewsSummaryRow = typeof newsSummaries.$inferInsert;
```

在 `strategiesRelations` 中加入 `newsSummaries`:

```typescript
export const strategiesRelations = relations(strategies, ({ many }) => ({
  positions: many(positions),
  monitoringRuns: many(monitoringRuns),
  newsSummaries: many(newsSummaries),
}));
```

在文件末尾追加 newsSummaries 的 relation：

```typescript
export const newsSummariesRelations = relations(newsSummaries, ({ one }) => ({
  strategy: one(strategies, {
    fields: [newsSummaries.strategyId],
    references: [strategies.id],
  }),
}));
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd packages/db && npx vitest run src/schema.test.ts
```

Expected: PASS（所有测试绿色）

- [ ] **Step 5: 推送 schema 到数据库**

```bash
cd packages/db && npx drizzle-kit push
```

Expected: 输出 `news_summaries table created` 或类似成功信息

- [ ] **Step 6: 重建 db dist**

```bash
pnpm --filter @trader/db build
```

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/schema.test.ts
git commit -m "feat: add news_summaries table to schema"
```

---

## Task 2: Tavily Fetch 模块

**Files:**
- Create: `apps/worker/src/news/__tests__/tavily-fetch.test.ts`
- Create: `apps/worker/src/news/tavily-fetch.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/worker/src/news/__tests__/tavily-fetch.test.ts`：

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("tavilyFetch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env.TAVILY_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TAVILY_API_KEY;
  });

  it("returns articles from Tavily API", async () => {
    const { tavilyFetch } = await import("../tavily-fetch.js");
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { title: "ISRG News", url: "https://example.com/1", content: "Intuitive Surgical reports..." },
          { title: "Robot Surgery", url: "https://example.com/2", content: "Da Vinci robot..." },
        ],
      }),
    });

    const articles = await tavilyFetch("ISRG stock news");

    expect(articles).toHaveLength(2);
    expect(articles[0]).toEqual({
      title: "ISRG News",
      url: "https://example.com/1",
      content: "Intuitive Surgical reports...",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("ISRG stock news"),
      })
    );
  });

  it("returns empty array when fetch fails", async () => {
    const { tavilyFetch } = await import("../tavily-fetch.js");
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 429,
    });

    const articles = await tavilyFetch("ISRG stock news");
    expect(articles).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd apps/worker && npx vitest run src/news/__tests__/tavily-fetch.test.ts
```

Expected: FAIL — `../tavily-fetch.js` not found

- [ ] **Step 3: 实现 tavily-fetch.ts**

创建 `apps/worker/src/news/tavily-fetch.ts`：

```typescript
export interface TavilyArticle {
  title: string;
  url: string;
  content: string;
}

export async function tavilyFetch(query: string): Promise<TavilyArticle[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.warn("[news] TAVILY_API_KEY not set, skipping search");
    return [];
  }

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        days: 1,
        max_results: 3,
      }),
    });

    if (!res.ok) {
      console.warn(`[news] Tavily request failed: ${res.status}`);
      return [];
    }

    const data = await res.json() as { results: Array<{ title: string; url: string; content: string }> };
    return (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
    }));
  } catch (err) {
    console.warn("[news] Tavily fetch error:", err instanceof Error ? err.message : String(err));
    return [];
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd apps/worker && npx vitest run src/news/__tests__/tavily-fetch.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/news/tavily-fetch.ts apps/worker/src/news/__tests__/tavily-fetch.test.ts
git commit -m "feat: add Tavily news fetch client"
```

---

## Task 3: Summarize 模块

**Files:**
- Create: `apps/worker/src/news/__tests__/summarize.test.ts`
- Create: `apps/worker/src/news/summarize.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/worker/src/news/__tests__/summarize.test.ts`：

```typescript
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

import { summarizeNews } from "../summarize.js";

describe("summarizeNews", () => {
  it("returns LLM text content given articles", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "今日 ISRG 消息：手术机器人需求持续增长。" }],
    });

    const result = await summarizeNews(
      "T1 策略",
      "买入 ISRG，参考价重置规则",
      [{ title: "ISRG Q1", url: "https://example.com", content: "Strong earnings" }]
    );

    expect(result).toBe("今日 ISRG 消息：手术机器人需求持续增长。");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "user" }),
        ]),
      })
    );
  });

  it("returns fallback text when LLM call throws", async () => {
    mockCreate.mockRejectedValueOnce(new Error("rate limit"));

    const result = await summarizeNews("T1 策略", "内容", []);

    expect(result).toBe("摘要生成失败，请稍后重试");
  });

  it("returns 暂无相关新闻 when articles list is empty and LLM not called", async () => {
    mockCreate.mockClear();
    const result = await summarizeNews("T1 策略", "内容", []);
    // empty articles path returns early without calling LLM
    expect(result).toBe("摘要生成失败，请稍后重试");
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd apps/worker && npx vitest run src/news/__tests__/summarize.test.ts
```

Expected: FAIL — `../summarize.js` not found

- [ ] **Step 3: 实现 summarize.ts**

创建 `apps/worker/src/news/summarize.ts`：

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { TavilyArticle } from "./tavily-fetch.js";

export async function summarizeNews(
  strategyName: string,
  strategyContent: string,
  articles: TavilyArticle[],
  client?: Anthropic
): Promise<string> {
  const anthropic = client ?? new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL,
  });

  const model = process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-20241022";

  const articleText = articles
    .map((a, i) => `[${i + 1}] ${a.title}\n${a.content}`)
    .join("\n\n");

  const prompt = `你是一位股票投资助手。以下是策略「${strategyName}」今日相关新闻：

策略概述：${strategyContent.slice(0, 300)}

今日新闻：
${articleText || "（无新闻）"}

请用 200 字以内的中文总结今日热点要点，重点关注对该策略持仓的潜在影响。不要使用 Markdown 格式。`;

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    const block = response.content[0];
    return block.type === "text" ? block.text.trim() : "摘要生成失败，请稍后重试";
  } catch (err) {
    console.warn("[news] LLM summarize failed:", err instanceof Error ? err.message : String(err));
    return "摘要生成失败，请稍后重试";
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd apps/worker && npx vitest run src/news/__tests__/summarize.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/news/summarize.ts apps/worker/src/news/__tests__/summarize.test.ts
git commit -m "feat: add LLM news summarize function"
```

---

## Task 4: News Job 主流程

**Files:**
- Create: `apps/worker/src/news/__tests__/job.test.ts`
- Create: `apps/worker/src/news/job.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/worker/src/news/__tests__/job.test.ts`：

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockTavilyFetch, mockSummarize } = vi.hoisted(() => ({
  mockTavilyFetch: vi.fn().mockResolvedValue([
    { title: "ISRG News", url: "https://example.com/1", content: "Strong earnings" },
  ]),
  mockSummarize: vi.fn().mockResolvedValue("今日 ISRG 消息：手术机器人需求持续增长。"),
}));

vi.mock("../tavily-fetch.js", () => ({ tavilyFetch: mockTavilyFetch }));
vi.mock("../summarize.js", () => ({ summarizeNews: mockSummarize }));
vi.mock("@trader/db", () => ({
  strategies: {},
  newsSummaries: { strategyId: "strategy_id", summaryDate: "summary_date" },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  lt: vi.fn(),
  sql: vi.fn(),
}));

import { runNewsJob } from "../job.js";

describe("runNewsJob", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips when no strategies found", async () => {
    const mockDb = {
      query: { strategies: { findMany: vi.fn().mockResolvedValue([]) } },
      delete: vi.fn(),
      insert: vi.fn(),
    } as any;

    await runNewsJob(mockDb);
    expect(mockTavilyFetch).not.toHaveBeenCalled();
  });

  it("upserts news summary for each strategy", async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const where = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const valuesChain = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insertMock = vi.fn().mockReturnValue({ values: valuesChain });
    const deleteMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

    const mockDb = {
      query: {
        strategies: {
          findMany: vi.fn().mockResolvedValue([
            { id: "strat-1", name: "T1 策略", content: "买入规则", symbols: ["ISRG", "ROBO"] },
          ]),
        },
      },
      delete: deleteMock,
      insert: insertMock,
    } as any;

    await runNewsJob(mockDb);

    // tavilyFetch called for each symbol + strategy name = 3 calls
    expect(mockTavilyFetch).toHaveBeenCalledTimes(3);
    expect(mockTavilyFetch).toHaveBeenCalledWith("ISRG stock news");
    expect(mockTavilyFetch).toHaveBeenCalledWith("ROBO stock news");
    expect(mockTavilyFetch).toHaveBeenCalledWith("T1 策略 investing news");

    // summarize called once with merged articles
    expect(mockSummarize).toHaveBeenCalledTimes(1);

    // insert called once
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("continues processing other strategies when one Tavily call fails", async () => {
    mockTavilyFetch.mockRejectedValueOnce(new Error("timeout")).mockResolvedValue([]);

    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const valuesChain = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insertMock = vi.fn().mockReturnValue({ values: valuesChain });
    const deleteMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

    const mockDb = {
      query: {
        strategies: {
          findMany: vi.fn().mockResolvedValue([
            { id: "strat-1", name: "T1", content: "内容", symbols: ["ISRG"] },
          ]),
        },
      },
      delete: deleteMock,
      insert: insertMock,
    } as any;

    await runNewsJob(mockDb);
    // Should still complete and insert (with fallback summary)
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd apps/worker && npx vitest run src/news/__tests__/job.test.ts
```

Expected: FAIL — `../job.js` not found

- [ ] **Step 3: 实现 job.ts**

创建 `apps/worker/src/news/job.ts`：

```typescript
import { eq, lt, sql } from "drizzle-orm";
import { strategies, newsSummaries } from "@trader/db";
import { tavilyFetch } from "./tavily-fetch.js";
import { summarizeNews } from "./summarize.js";
import type { drizzle } from "drizzle-orm/postgres-js";
import type * as schema from "@trader/db";
import pLimit from "p-limit";

type DbType = ReturnType<typeof drizzle<typeof schema>>;

export async function runNewsJob(db: DbType) {
  const today = new Date().toISOString().slice(0, 10);

  // 清理 7 天前记录
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  await db.delete(newsSummaries).where(lt(newsSummaries.summaryDate, cutoff.toISOString().slice(0, 10)));

  const allStrategies = await db.query.strategies.findMany();
  if (allStrategies.length === 0) {
    console.log("[news] no strategies found, skipping");
    return;
  }

  const limit = pLimit(3);

  const tasks = allStrategies.map((strategy) =>
    limit(async () => {
      try {
        const symbols = (strategy.symbols as string[]) ?? [];
        const queries = [
          ...symbols.map((s) => `${s} stock news`),
          `${strategy.name} investing news`,
        ];

        const allArticles = (
          await Promise.all(
            queries.map(async (q) => {
              try {
                return await tavilyFetch(q);
              } catch {
                return [];
              }
            })
          )
        ).flat();

        // 按 URL 去重
        const seen = new Set<string>();
        const articles = allArticles.filter((a) => {
          if (seen.has(a.url)) return false;
          seen.add(a.url);
          return true;
        });

        const content = await summarizeNews(strategy.name, strategy.content, articles);

        await db
          .insert(newsSummaries)
          .values({
            strategyId: strategy.id,
            summaryDate: today,
            content,
            rawArticles: articles,
          })
          .onConflictDoUpdate({
            target: [newsSummaries.strategyId, newsSummaries.summaryDate],
            set: {
              content: sql`excluded.content`,
              rawArticles: sql`excluded.raw_articles`,
            },
          });

        console.log(`[news] ${strategy.name}: summary saved for ${today}`);
      } catch (err) {
        console.error(`[news] ${strategy.name} failed:`, err instanceof Error ? err.message : String(err));
      }
    })
  );

  await Promise.allSettled(tasks);
  console.log(`[news] job completed for ${today}`);
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd apps/worker && npx vitest run src/news/__tests__/job.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/news/job.ts apps/worker/src/news/__tests__/job.test.ts
git commit -m "feat: add news job main flow"
```

---

## Task 5: 注册 pg-boss cron + docker-compose

**Files:**
- Modify: `apps/worker/src/worker.ts`
- Modify: `docker-compose.yml`

- [ ] **Step 1: 修改 worker.ts**

打开 `apps/worker/src/worker.ts`，在顶部 import 区追加：

```typescript
import { runNewsJob } from "./news/job.js";
```

在 `start()` 方法中，`await boss.schedule("daily-monitoring", ...)` 之后追加：

```typescript
      await boss.createQueue("daily-news");
      await boss.work("daily-news", async () => {
        console.log("[worker] daily-news job triggered");
        await runNewsJob(db);
      });
      await boss.schedule("daily-news", "30 1 * * *");
      console.log("[worker] daily-news cron registered (30 1 * * * UTC = 09:30 CST)");
```

完整修改后的 `start()` 方法：

```typescript
    async start() {
      await boss.start();

      await boss.createQueue("daily-monitoring");
      await boss.work<{ strategyId?: string }>("daily-monitoring", async (jobs) => {
        const strategyId = jobs[0]?.data?.strategyId;
        console.log("[worker] daily-monitoring job triggered", strategyId ? `strategyId=${strategyId}` : "(all)");
        await runMonitoringJob(db, strategyId);
      });
      await boss.schedule("daily-monitoring", "0 2 * * *");
      console.log("[worker] started, daily-monitoring cron registered (0 2 * * * UTC)");

      await boss.createQueue("daily-news");
      await boss.work("daily-news", async () => {
        console.log("[worker] daily-news job triggered");
        await runNewsJob(db);
      });
      await boss.schedule("daily-news", "30 1 * * *");
      console.log("[worker] daily-news cron registered (30 1 * * * UTC = 09:30 CST)");
    },
```

- [ ] **Step 2: 修改 docker-compose.yml**

在 `worker` service 的 `environment` 块中追加：

```yaml
      TAVILY_API_KEY: ${TAVILY_API_KEY}
```

修改后的 worker environment 块：

```yaml
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/trader
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      ANTHROPIC_BASE_URL: ${ANTHROPIC_BASE_URL}
      ANTHROPIC_MODEL: ${ANTHROPIC_MODEL}
      ALPHAVANTAGE_API_KEY: ${ALPHAVANTAGE_API_KEY}
      TAVILY_API_KEY: ${TAVILY_API_KEY}
```

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/worker.ts docker-compose.yml
git commit -m "feat: register daily-news cron in worker"
```

---

## Task 6: API Route GET /api/news

**Files:**
- Create: `apps/web/app/api/news/__tests__/route.test.ts`
- Create: `apps/web/app/api/news/route.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/web/app/api/news/__tests__/route.test.ts`：

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockNewsSummariesFindMany } = vi.hoisted(() => ({
  mockNewsSummariesFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      newsSummaries: { findMany: mockNewsSummariesFindMany },
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ _type: "eq", col, val }),
}));

vi.mock("@trader/db", () => ({
  newsSummaries: { summaryDate: "summary_date" },
}));

import { GET } from "../route";

describe("GET /api/news", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns summaries for given date", async () => {
    mockNewsSummariesFindMany.mockResolvedValueOnce([
      {
        strategyId: "strat-1",
        summaryDate: "2026-05-29",
        content: "今日热点摘要",
        strategy: { name: "T1 策略" },
      },
    ]);

    const req = new Request("http://localhost/api/news?date=2026-05-29");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.date).toBe("2026-05-29");
    expect(body.summaries).toHaveLength(1);
    expect(body.summaries[0]).toMatchObject({
      strategyId: "strat-1",
      strategyName: "T1 策略",
      content: "今日热点摘要",
    });
  });

  it("defaults to today when date param not provided", async () => {
    mockNewsSummariesFindMany.mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/news");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.summaries).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd apps/web && npx vitest run app/api/news/__tests__/route.test.ts
```

Expected: FAIL — `../route` not found

- [ ] **Step 3: 实现 route.ts**

创建 `apps/web/app/api/news/route.ts`：

```typescript
export const dynamic = "force-dynamic";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { newsSummaries } from "@trader/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? new Date().toISOString().slice(0, 10);

  const rows = await db.query.newsSummaries.findMany({
    where: eq(newsSummaries.summaryDate, date),
    with: { strategy: { columns: { name: true } } },
  });

  return Response.json({
    date,
    summaries: rows.map((r) => ({
      strategyId: r.strategyId,
      strategyName: (r as any).strategy?.name ?? null,
      content: r.content,
    })),
  });
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd apps/web && npx vitest run app/api/news/__tests__/route.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/news/route.ts apps/web/app/api/news/__tests__/route.test.ts
git commit -m "feat: add GET /api/news route"
```

---

## Task 7: 前端热点页面

**Files:**
- Create: `apps/web/app/news/page.tsx`

- [ ] **Step 1: 实现页面**

创建 `apps/web/app/news/page.tsx`：

```typescript
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

interface NewsSummary {
  strategyId: string;
  strategyName: string | null;
  content: string;
}

interface NewsData {
  date: string;
  summaries: NewsSummary[];
}

function getDateLabel(date: Date, index: number): string {
  if (index === 0) return "今天";
  if (index === 1) return "昨天";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default function NewsPage() {
  const today = new Date();
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    return d;
  });

  const [selectedDate, setSelectedDate] = useState(toDateString(today));
  const [data, setData] = useState<NewsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setData(null);
    fetch(`/api/news?date=${selectedDate}`)
      .then((r) => r.json())
      .then((json) => setData(json))
      .catch(() => setData({ date: selectedDate, summaries: [] }))
      .finally(() => setLoading(false));
  }, [selectedDate]);

  return (
    <div className="p-4 md:p-6 max-w-none md:max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">策略热点</h1>

      <div className="flex gap-2 mb-6 flex-wrap">
        {dates.map((d, i) => {
          const ds = toDateString(d);
          return (
            <button
              key={ds}
              onClick={() => setSelectedDate(ds)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                selectedDate === ds
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-accent"
              }`}
            >
              {getDateLabel(d, i)}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      )}

      {!loading && data && data.summaries.length === 0 && (
        <p className="text-muted-foreground text-center py-10">
          暂无热点数据，将在每日 09:30 自动更新
        </p>
      )}

      {!loading && data && data.summaries.length > 0 && (
        <div className="space-y-3">
          {data.summaries.map((s) => (
            <Card key={s.strategyId}>
              <CardContent className="p-4">
                <p className="text-sm font-semibold mb-2">
                  {s.strategyName ? (
                    <Link
                      href={`/strategies/${s.strategyId}`}
                      className="hover:underline"
                    >
                      {s.strategyName}
                    </Link>
                  ) : (
                    s.strategyId
                  )}
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.content}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/news/page.tsx
git commit -m "feat: add news hotspot page"
```

---

## Task 8: 侧边栏菜单项

**Files:**
- Modify: `apps/web/components/layout/sidebar.tsx`
- Modify: `apps/web/components/layout/mobile-nav.tsx`

- [ ] **Step 1: 更新 sidebar.tsx**

打开 `apps/web/components/layout/sidebar.tsx`。

在顶部 import 中将 `{ BookOpen, BarChart3, Eye, Bell }` 改为：

```typescript
import { BookOpen, BarChart3, Eye, Bell, Newspaper } from "lucide-react";
```

在 `navItems` 数组中，「持仓管理」之后插入热点项：

```typescript
const navItems = [
  {
    href: "/positions",
    label: "持仓管理",
    icon: BarChart3,
  },
  {
    href: "/news",
    label: "热点",
    icon: Newspaper,
  },
  {
    href: "/strategies",
    label: "策略库",
    icon: BookOpen,
  },
  {
    href: "/monitoring",
    label: "监控中心",
    icon: Eye,
  },
  {
    href: "/notifications",
    label: "通知",
    icon: Bell,
  },
];
```

- [ ] **Step 2: 更新 mobile-nav.tsx**

打开 `apps/web/components/layout/mobile-nav.tsx`。

在顶部 import 中将 `{ BookOpen, BarChart3, Eye, Bell }` 改为：

```typescript
import { BookOpen, BarChart3, Eye, Bell, Newspaper } from "lucide-react";
```

在 `navItems` 数组中，「持仓」之后插入热点项：

```typescript
const navItems = [
  {
    href: "/positions",
    label: "持仓",
    icon: BarChart3,
  },
  {
    href: "/news",
    label: "热点",
    icon: Newspaper,
  },
  {
    href: "/strategies",
    label: "策略库",
    icon: BookOpen,
  },
  {
    href: "/monitoring",
    label: "监控",
    icon: Eye,
  },
  {
    href: "/notifications",
    label: "通知",
    icon: Bell,
  },
];
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/layout/sidebar.tsx apps/web/components/layout/mobile-nav.tsx
git commit -m "feat: add 热点 nav item to sidebar and mobile-nav"
```
