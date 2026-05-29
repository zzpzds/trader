# 策略热点推送 Design Spec

## Goal

每天早上 09:30（北京时间）自动搜索各策略相关标的和方向的最新新闻，由 LLM 汇总成中文摘要，展示在独立的「热点」页面，支持查看最近 7 天历史。

## Architecture Overview

```
Worker (pg-boss cron 01:30 UTC = 09:30 CST)
  └─ apps/worker/src/news/job.ts
       ├─ Tavily 搜索（per symbol + strategy theme，days=1）
       ├─ LLM 摘要（per strategy，~200 字中文）
       └─ upsert news_summaries（同一策略同一天唯一）

Next.js API: GET /api/news?date=YYYY-MM-DD
Frontend:    /news 页面（日期切换 + 策略卡片）
Sidebar:     持仓管理下方新增「热点」菜单项
```

## Data Layer

### 新增表：`news_summaries`

| 字段 | 类型 | 约束 |
|------|------|------|
| id | UUID | PK, default gen_random_uuid() |
| strategy_id | text | FK → strategies(id), cascade delete |
| summary_date | date | not null |
| content | text | LLM 生成的中文摘要 |
| raw_articles | jsonb | Tavily 原始文章（title, url, snippet） |
| created_at | timestamp | default now() |

唯一约束：`(strategy_id, summary_date)`。

### 清理策略

job 每次执行时删除 `summary_date < CURRENT_DATE - 7` 的旧记录，保持最多 7 天历史。

## Worker Module

**文件结构：**

```
apps/worker/src/news/
  tavily-fetch.ts   # Tavily REST API 客户端
  summarize.ts      # LLM 摘要生成
  job.ts            # 主流程
  index.ts          # pg-boss cron 注册
  __tests__/
    tavily-fetch.test.ts
    summarize.test.ts
    job.test.ts
```

**`tavily-fetch.ts`**

调用 `https://api.tavily.com/search`，参数：`query`、`search_depth: "basic"`、`days: 1`、`max_results: 3`。返回 `Array<{ title, url, content }>` 。每个策略的搜索词：
- 每个 symbol：`"${symbol} stock news"`
- 策略整体方向：`"${strategyName} investing news"`

**`summarize.ts`**

输入：策略名、策略描述（content 字段）、文章列表。  
调用 Anthropic SDK（复用现有 `analyze.ts` 的初始化模式）。  
Prompt 要求 LLM 以 200 字以内的中文输出当天热点要点，不含 markdown 格式。

**`job.ts` 主流程：**

1. 删除 7 天前旧记录
2. 查询全部策略
3. `p-limit(3)` 并发处理每个策略：
   a. 调用 `tavilyFetch` 搜索所有 query，合并去重文章
   b. 无文章则写入"暂无相关新闻"占位摘要
   c. 调用 `summarize` 生成摘要
   d. upsert `news_summaries`（on conflict do update set content, raw_articles）
4. 记录日志

**`index.ts`**

在 `apps/worker/src/index.ts` 中与 monitoring job 并列注册：

```typescript
await boss.schedule("daily-news", "30 1 * * *", {});
boss.work("daily-news", async () => { await runNewsJob(db); });
```

## API

### `GET /api/news`

Query params：`date`（可选，格式 `YYYY-MM-DD`，默认今天）

Response：
```json
{
  "date": "2026-05-29",
  "summaries": [
    {
      "strategyId": "uuid",
      "strategyName": "ISRG / ROBO T1 大盘策略",
      "content": "今日 ISRG 相关新闻摘要..."
    }
  ]
}
```

无数据时 `summaries` 为空数组，不报错。

## Frontend

### 页面：`apps/web/app/news/page.tsx`

- **日期导航栏**：横向按钮，显示"今天"、"昨天"、以及前 5 天的 `M/D` 格式日期，共 7 个按钮，默认选中今天
- **内容区**：每个策略一张 Card，展示策略名（链接到策略详情）+ LLM 摘要文本
- **状态处理**：加载中显示 skeleton；无数据显示"暂无热点数据，将在每日 09:30 自动更新"

### 侧边栏

`components/layout/sidebar.tsx` 和 `components/layout/mobile-nav.tsx` 均在「持仓管理」后添加：

```typescript
{ href: "/news", label: "热点", icon: Newspaper }
```

## Error Handling

- Tavily 请求失败：该策略跳过，记录 warn 日志，不中断其他策略
- LLM 调用失败：写入错误占位文本"摘要生成失败，请稍后重试"，不抛出
- 整个 job 失败：pg-boss 不会重试（`retryLimit: 0`），等待次日执行

## Environment Variables

`TAVILY_API_KEY` 已在 `.env.example` 中，worker 的 `docker-compose` service 需要透传此变量。
