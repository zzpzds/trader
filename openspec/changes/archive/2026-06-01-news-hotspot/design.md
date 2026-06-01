## Context

系统已有 `daily-monitoring` cron（UTC 02:00）跑批，本变更要求在 worker 进程中再加一条 `daily-news` cron（UTC 01:30 = 北京 09:30），处于股市开盘（北京 21:30 美股、本地 09:30 A 股）前 30 分钟，给用户一份"今日要点"。

约束：
- 单 worker 进程内串行调度，但策略级别需并发以缩短端到端时延（典型 3–10 个策略，每个 1–2 次 LLM 调用）
- Tavily 免费档每月 1000 次搜索，需控制 query 数量
- LLM 摘要使用现有 `@anthropic-ai/sdk` + `ANTHROPIC_BASE_URL`（公司有自建网关），模型默认 `claude-3-5-haiku-20241022`，显式可覆盖
- 失败必须降级而非中断：单策略失败不影响其他策略

## Goals / Non-Goals

**Goals:**
- 每天 09:30（北京时间）自动落库一份策略热点摘要
- Web UI 提供最近 7 天的可切换日期视图
- 摘要为中文、≤200 字、纯文本（无 Markdown）
- Tavily 与 LLM 失败时落库 fallback 文案，不让 job 整体失败
- 并发受控（`p-limit(3)`），避免 LLM 配额尖刺

**Non-Goals:**
- 不做实时推送 / WebSocket / 邮件通知（后续可单独提案）
- 不做用户级订阅或分组，所有策略一起跑
- 不做超过 7 天的历史回溯查询
- 不做新闻原文存档查询页（仅在 `raw_articles` JSONB 里留底，不暴露 UI）
- 不做多语种或英文摘要

## Decisions

### Decision 1：使用 Tavily REST API 而不是 LLM web_search 工具

- **选择**：直接 `POST https://api.tavily.com/search`，参数 `search_depth=basic`、`days=1`、`max_results=3`
- **理由**：
  - Tavily 价格透明、专为 LLM 检索优化、返回字段干净（title/url/content）
  - 与现有 LLM 调用解耦，可以独立替换搜索引擎
  - LLM 工具调用模式增加 token 成本和复杂度
- **替代方案**：Anthropic web_search tool（成本高、配额未明）；自建爬虫（违反 ToS、维护成本）

### Decision 2：每策略多个 query，URL 去重后一次摘要

- **方案**：对每个策略生成 `[...symbols.map(s => "${s} stock news"), "${strategy.name} investing news"]` 多个 query，结果按 `url` 去重后一次性给 LLM 汇总
- **理由**：
  - 多 query 提高召回率（symbol 直接命中 + strategy name 兜底）
  - 单次 LLM 调用控制成本
  - URL 去重避免同一篇文章在 prompt 里出现两次

### Decision 3：每天每策略仅 1 行（unique index on strategy_id + summary_date），写入用 upsert

- **方案**：`uniqueIndex("news_summaries_strategy_date_idx").on(strategyId, summaryDate)` + `onConflictDoUpdate`
- **理由**：cron 失败重跑或手动触发时不会产生重复数据；幂等
- **代价**：丢失"当天多次跑"的中间过程，但这与产品需求一致（每天一份摘要）

### Decision 4：7 天滚动窗口，job 开始时清理过期数据

- **方案**：`db.delete(newsSummaries).where(lt(summaryDate, cutoff))`，`cutoff = today - 7d`
- **理由**：避免无限增长；7 天对应 UI 切换器的 7 个 tab，正好够看；删除发生在 job 开头而非 UI 查询时，简化读路径

### Decision 5：失败降级到字符串 fallback，而不是 throw

- **Tavily 失败**：返回 `[]`，进入 LLM 时 prompt 里写"今日新闻：（无新闻）"
- **LLM 失败**：返回字符串 `"摘要生成失败，请稍后重试"`
- **理由**：保证每天每策略都有一行可见数据，UI 不需要处理 null/loading 之外的状态；运维通过日志排查

### Decision 6：API `GET /api/news?date=...` 默认今天，无分页

- **方案**：返回 `{ date, summaries: [{ strategyId, strategyName, content }] }`
- **理由**：策略数量有限（典型 < 20），无需分页；前端根据 date 切换日期；`with: { strategy: { columns: { name: true } } }` 联表取策略名

### Decision 7：UI 在桌面侧边栏 + 移动端底部导航中加「热点」入口

- **位置**：在「持仓」之后、「策略库」之前
- **图标**：`Newspaper`（lucide-react，已是项目依赖）
- **页面**：客户端组件，`useEffect` 拉取 `/api/news?date=...`；7 个日期按钮（今天 / 昨天 / 5 个 M/D 标签）

## Risks / Trade-offs

- **Tavily 配额耗尽** → 单次 job 最多 N 策略 × (M symbols + 1) 次搜索；按 5 策略 × 4 query = 20 次/天 = 600 次/月，留给手动触发约 400 次冗余。Mitigation：`max_results=3` + URL 去重控制 token 成本，监控日志中的 429
- **LLM 成本** → 每策略一次 ~400 max_tokens、prompt 含 strategy.content 前 300 字 + 最多 ~3000 字新闻，按 haiku 单价可接受。Mitigation：保留 `ANTHROPIC_MODEL` env 可降级
- **新闻质量** → Tavily basic depth + 简单 query 可能召回低质内容。Mitigation：交给 LLM 在 prompt 里"重点关注对该策略持仓的潜在影响"过滤；后续可改 advanced depth 或加领域过滤
- **时区漂移** → cron 用 UTC 表达式 `30 1 * * *`；如果 worker 容器时区不是 UTC，pg-boss 仍按 UTC 解读，但 `summary_date` 使用 `new Date().toISOString().slice(0,10)` = UTC 日期，与北京日期可能错位 8 小时。Mitigation：09:30 CST = 01:30 UTC，已在 UTC 当天，无错位；如果手动跑 job 在 UTC 凌晨之前可能写到"昨天"，可接受
- **测试中真实 Tavily / LLM 调用** → 单测全部 mock；端到端验证靠手动触发 job
- **archive 时与已归档的 `2026-06-01-news-hotspot` 同名冲突** → 该归档目录只含空 yaml，archive 命令会基于当前日期 `2026-06-01-news-hotspot` 命名再次冲突。Mitigation：归档时若冲突，按 `--name` 改名或先清理空归档目录

## Migration Plan

1. 合并 schema 改动 → CI / 本地 `drizzle-kit push`，无破坏性
2. 部署 worker（带 `TAVILY_API_KEY`）→ 立即注册 cron，下次 UTC 01:30 触发
3. 部署 web → `/news` 页面可访问，无数据时显示 "暂无热点数据，将在每日 09:30 自动更新"
4. 手动触发一次 `boss.send("daily-news", {})` 验证写入与 UI 渲染
5. 回滚：取消 cron schedule + drop table + 撤页面（数据无外部依赖）

## Open Questions

- 是否要在通知中心同步推一条「今日热点已更新」？（暂不做，待用户反馈）
- 是否要把 `raw_articles` 在 UI 中展开为可点击的原文链接列表？（暂不做，仅留底）
