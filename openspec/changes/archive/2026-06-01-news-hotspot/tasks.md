## 1. DB Schema

- [x] 1.1 在 `packages/db/src/schema.test.ts` 末尾追加 `newsSummaries` 列存在性测试，并在顶部 import 中加入 `newsSummaries`
- [x] 1.2 运行 `cd packages/db && npx vitest run src/schema.test.ts` 确认 FAIL（`newsSummaries` 未导出）
- [x] 1.3 在 `packages/db/src/schema.ts` 中 `notifications` 之后、relations 之前新增 `newsSummaries` pgTable（含 `id` UUID PK、`strategyId` FK CASCADE、`summaryDate` text、`content` text、`rawArticles` jsonb、`createdAt` timestamp、`uniqueIndex(strategyId, summaryDate)`）以及 `NewsSummaryRow` / `NewNewsSummaryRow` 类型导出
- [x] 1.4 在 `strategiesRelations` 中追加 `newsSummaries: many(newsSummaries)`，并在文件末尾追加 `newsSummariesRelations`
- [x] 1.5 运行 `cd packages/db && npx vitest run src/schema.test.ts` 确认 PASS（8/8）
- [ ] 1.6 运行 `cd packages/db && npx drizzle-kit push` 推送 schema 到数据库（**用户决定手动控制迁移，未自动执行；DATABASE_URL 指向 Railway 远端 DB**）
- [x] 1.7 运行 `pnpm --filter @trader/db build` 重建 dist（实际通过 `npx tsc` 完成，pnpm 调用因本地 corepack 报错绕过）
- [ ] 1.8 commit：`feat: add news_summaries table to schema`（**用户选择全部完成后单次 commit**）

## 2. Tavily Fetch 模块

- [x] 2.1 创建 `apps/worker/src/news/__tests__/tavily-fetch.test.ts`：覆盖正常返回、`ok=false` 返回 `[]`、缺 API key 返回 `[]`、fetch 抛错返回 `[]`
- [x] 2.2 运行 `cd apps/worker && npx vitest run src/news/__tests__/tavily-fetch.test.ts` 确认 FAIL
- [x] 2.3 创建 `apps/worker/src/news/tavily-fetch.ts`：导出 `TavilyArticle` 类型与 `tavilyFetch(query)` 函数；`POST https://api.tavily.com/search`，body `{ api_key, query, search_depth: "basic", days: 1, max_results: 3 }`，将 `results[]` 映射为 `{ title, url, content }[]`；所有失败路径返回 `[]` 并打日志
- [x] 2.4 运行 `cd apps/worker && npx vitest run src/news/__tests__/tavily-fetch.test.ts` 确认 PASS（4/4）
- [ ] 2.5 commit：`feat: add Tavily news fetch client`（合入最终 commit）

## 3. LLM Summarize 模块

- [x] 3.1 创建 `apps/worker/src/news/__tests__/summarize.test.ts`：mock `@anthropic-ai/sdk`，覆盖成功返回 trimmed text、SDK 抛错返回 fallback 字符串、非 text block 返回 fallback
- [x] 3.2 运行 `cd apps/worker && npx vitest run src/news/__tests__/summarize.test.ts` 确认 FAIL
- [x] 3.3 创建 `apps/worker/src/news/summarize.ts`：导出 `summarizeNews(strategyName, strategyContent, articles, client?)`；构造中文 prompt（含 strategy.content 前 300 字 + 编号文章列表 + 「200 字以内、不使用 Markdown、关注对持仓潜在影响」指令）；调用 `messages.create({ model: ANTHROPIC_MODEL ?? "claude-3-5-haiku-20241022", max_tokens: 400 })`；失败返回 `"摘要生成失败，请稍后重试"`
- [x] 3.4 运行 `cd apps/worker && npx vitest run src/news/__tests__/summarize.test.ts` 确认 PASS（3/3）
- [ ] 3.5 commit：`feat: add LLM news summarize function`（合入最终 commit）

## 4. News Job 主流程

- [x] 4.1 创建 `apps/worker/src/news/__tests__/job.test.ts`：mock `tavily-fetch`、`summarize`、`@trader/db`、`drizzle-orm`；覆盖空策略列表跳过、单策略多 query 调用 + URL 去重 + insert.upsert、单 query 抛错时仍 upsert
- [x] 4.2 运行 `cd apps/worker && npx vitest run src/news/__tests__/job.test.ts` 确认 FAIL
- [x] 4.3 创建 `apps/worker/src/news/job.ts`：实现 `runNewsJob(db)`；先 `db.delete(newsSummaries).where(lt(summaryDate, today-7d))`；`db.query.strategies.findMany()`；`p-limit(3)` 并发；每策略对 `[...symbols.map(s=>"${s} stock news"), "${name} investing news"]` 并行 `tavilyFetch`；URL 去重；`summarizeNews`；`insert(newsSummaries).values(...).onConflictDoUpdate({ target: [strategyId, summaryDate], set: { content: sql\`excluded.content\`, rawArticles: sql\`excluded.raw_articles\` } })`；外层 `Promise.allSettled` 保证单策略失败不中断
- [x] 4.4 运行 `cd apps/worker && npx vitest run src/news/__tests__/job.test.ts` 确认 PASS（3/3，全部 worker 38/38）
- [ ] 4.5 commit：`feat: add news job main flow`（合入最终 commit）

## 5. Worker Cron + 容器透传

- [x] 5.1 在 `apps/worker/src/worker.ts` 顶部 import `runNewsJob`；在 `start()` 内 `daily-monitoring` 注册之后追加：`createQueue("daily-news")` + `work("daily-news", () => runNewsJob(db))` + `schedule("daily-news", "30 1 * * *")` + 启动日志
- [x] 5.2 在 `docker-compose.yml` 的 `worker.environment` 块追加 `TAVILY_API_KEY: ${TAVILY_API_KEY}`
- [x] 5.3 在 `.env.example` 增加 `TAVILY_API_KEY=your-tavily-api-key` 占位行
- [ ] 5.4 commit：`feat: register daily-news cron and pass TAVILY_API_KEY through worker container`（合入最终 commit）

## 6. API Route GET /api/news

- [x] 6.1 创建 `apps/web/app/api/news/__tests__/route.test.ts`：mock `@/lib/db` 与 `@trader/db`；覆盖 `?date=...` 返回联表后的 `{ strategyId, strategyName, content }`；缺省 date 返回今天 ISO 日期；空结果返回 `[]`；并新增"无 join strategy 时 strategyName 回退 null"用例
- [x] 6.2 运行 `cd apps/web && npx vitest run app/api/news/__tests__/route.test.ts` 确认 FAIL
- [x] 6.3 创建 `apps/web/app/api/news/route.ts`：`export const dynamic = "force-dynamic"`；解析 `searchParams.get("date") ?? today`；`db.query.newsSummaries.findMany({ where: eq(summaryDate, date), with: { strategy: { columns: { name: true } } } })`；返回 `Response.json({ date, summaries: [...] })`
- [x] 6.4 运行 `cd apps/web && npx vitest run app/api/news/__tests__/route.test.ts` 确认 PASS（3/3）
- [ ] 6.5 commit：`feat: add GET /api/news route`（合入最终 commit）

## 7. 前端热点页面

- [x] 7.1 创建 `apps/web/app/news/page.tsx`（`"use client"`）：构造最近 7 天日期数组（今天 / 昨天 / M/D 标签）；`useState` 选中日期；`useEffect` 拉取 `/api/news?date=...`；渲染 tab 按钮、加载骨架（3 个 muted 块）、空态文案、卡片列表（策略名 → `Link` to `/strategies/<id>`，content 灰色文本）
- [ ] 7.2 手动在 dev server 上访问 `/news`，验证骨架 → 空态/数据三态切换以及日期切换 refetch（**待手动执行**）
- [ ] 7.3 commit：`feat: add news hotspot page`（合入最终 commit）

## 8. 导航入口

- [x] 8.1 在 `apps/web/components/layout/sidebar.tsx`：从 `lucide-react` 追加 `Newspaper`；在 `navItems` 中「持仓管理」之后插入 `{ href: "/news", label: "热点", icon: Newspaper }`
- [x] 8.2 在 `apps/web/components/layout/mobile-nav.tsx`：从 `lucide-react` 追加 `Newspaper`；在 `navItems` 中「持仓」之后插入 `{ href: "/news", label: "热点", icon: Newspaper }`
- [ ] 8.3 在桌面 + 移动端布局上目视确认导航顺序与高亮态正确（**待手动执行**）
- [ ] 8.4 commit：`feat: add 热点 nav item to sidebar and mobile-nav`（合入最终 commit）

## 9. 端到端验证

- [ ] 9.1 配置真实 `TAVILY_API_KEY`，本地启动 worker，手动 `boss.send("daily-news")` 触发一次（**待执行；前置依赖：1.6 push schema + 配置 key**）
- [ ] 9.2 检查 DB：`select strategy_id, summary_date, length(content) from news_summaries`，每策略一行、content 非空且非 fallback
- [ ] 9.3 在 `/news` 页面验证当天数据展示与 7 日切换
- [ ] 9.4 验证 `drop strategy` 时关联的 `news_summaries` 行被级联删除

---

## 进度小结（2026-06-01）

**代码实现**：8 个 task 的核心代码全部落地（schema / Tavily 客户端 / LLM 摘要 / job 主流程 / worker cron / `/api/news` / `/news` 页面 / 导航入口）

**测试**：
- `packages/db` 8/8 PASS（含 1 个新增 schema 用例）
- `apps/worker` 38/38 PASS（含 10 个新增：tavily-fetch 4 + summarize 3 + job 3）
- `apps/web` 70/71 PASS（新增 3/3 PASS；1 个失败为 main 已存在的 `notifications/route.test.ts` 统计用例，与本变更无关）

**未完成 / 待用户操作**：
- 1.6 `drizzle-kit push`：用户决定手动控制远端 Railway DB 的迁移
- 7.2 / 8.3：UI 三态与导航的目视回归
- 9.x：端到端冒烟（依赖 push + 真实 TAVILY_API_KEY）
- 所有 commit 步骤：用户选择全部完成后单次 commit
