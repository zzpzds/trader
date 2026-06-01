## Why

策略持仓人需要每天快速了解与策略相关标的的最新新闻，但目前系统没有任何新闻聚合能力——用户只能自行翻阅各处财经媒体，效率低且容易遗漏关键事件。在 daily-monitoring 已经具备每日定时跑批能力的基础上，加一条「策略热点」流水，由 Tavily 抓取 + LLM 中文摘要，能让用户在 09:30 开盘前一站式了解当日策略相关动向。

## What Changes

- 新增 `news_summaries` 表：每条记录代表 (策略, 日期) 的一份中文摘要，含原始新闻 JSON
- Worker 新增 `daily-news` pg-boss cron（UTC 01:30 = 北京 09:30），按策略调用 Tavily 搜索 + Anthropic LLM 汇总后 upsert 到 `news_summaries`，并清理 7 天前的历史
- 新增 `GET /api/news?date=YYYY-MM-DD` 返回某天所有策略的摘要（默认今天）
- 新增 `/news` 页面，提供最近 7 天的日期切换 + 卡片化策略摘要列表
- 在桌面侧边栏与移动端底部导航中加入「热点」入口
- 在 worker 容器与本地 env 中新增 `TAVILY_API_KEY` 配置

## Capabilities

### New Capabilities
- `news-hotspot`: 每日按策略抓取 Tavily 新闻、LLM 汇总、存储 7 天滚动窗口、Web UI 展示

### Modified Capabilities
<!-- 无现有 capability 的 requirement 改动；daily-monitoring 仍负责自己的监控流水，本变更只在 worker 进程内并行注册一条独立的 cron。-->

## Impact

- **DB**：`packages/db/src/schema.ts` 新增 `newsSummaries` 表 + relation；需 `drizzle-kit push`
- **Worker**：`apps/worker/src/news/{tavily-fetch,summarize,job}.ts` 新建；`worker.ts` 注册 `daily-news` 队列与 schedule
- **Web**：`apps/web/app/api/news/route.ts`、`apps/web/app/news/page.tsx`、`components/layout/sidebar.tsx`、`components/layout/mobile-nav.tsx`
- **基础设施**：`docker-compose.yml` worker 服务新增 `TAVILY_API_KEY` 透传；`.env.example` / `.env` 增加占位
- **依赖**：复用现有 `@anthropic-ai/sdk`，新增 `p-limit`（worker 并发控制，可能已存在）；外部依赖 Tavily REST API（`https://api.tavily.com/search`）
- **失败模式**：Tavily 不可用或 LLM 失败时，该策略当天写入 fallback 文案而不是中断整个 job
