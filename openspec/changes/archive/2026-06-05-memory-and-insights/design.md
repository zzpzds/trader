## Context

trader 是单人单部署的"持仓 + 策略 + AI 监控"看板，跑在 2GB 小服务器上，技术栈 Next.js 16 + Node.js worker + PostgreSQL 16 + Drizzle + Anthropic 协议 LLM。已有 schema：strategies / positions / positionLots / monitoringRuns / notifications / newsSummaries / priceSnapshots。

LLM 在 monitoring/news 流程中只读策略与行情，无横向上下文记忆；用户可在 lot 上写 `notes` 但无法成体系地记笔记或全局检索。`positionLots` 已是事务全流水（BUY/SELL + 日期 + 价格 + notes），但前端只展示原始时间线，没有任何统计画像。

设计灵感源自 Vibe-Trading：`agent/src/memory/persistent.py`（文件型记忆 + 全文搜索）与 `agent/src/shadow_account/`（行为画像 + 隐含规则）。本次只复刻"记忆"和"行为画像"两块，跳过 Vibe 自家回测引擎（成本过高，需另起 sidecar）。

## Goals / Non-Goals

**Goals:**

- 让用户能写、改、删、搜跨日笔记，按策略/标的/类型筛选
- 让 monitoring 在每次运行时按当前策略 + 标的自动加载相关笔记到 prompt（用户写、LLM 读）
- 提供 `/insights` 页面展示 4 类交易行为指标：基础财务、处置效应、锚定/追高、过度交易
- 单人 < 1000 lot 量级下保持毫秒级响应，部署仍能在 2GB 服务器上跑

**Non-Goals:**

- 笔记导入/导出（CSV、Markdown）
- 笔记版本历史 / 笔记的 LLM 自动撰写或归类
- 行为诊断的历史趋势曲线
- 把 `monitoring_runs.analysis` 也加入笔记检索（LLM 输出本身已经在该表里按时序展示）
- 跨设备同步、移动端推送
- 引入 Python sidecar / 任何新外部服务
- 回测能力（Vibe 的 shadow_account.backtester 不在本次范围）

## Decisions

### D1. 写入主体：用户手动 + monitoring_runs 自然沉淀（不开 LLM 写入路径）

LLM 只读，不主动 `save_memory`。理由：LLM 输出已经持久化在 `monitoring_runs.analysis`，再额外开一条写入路径会引入 prompt 复杂度（需要 tool schema 改造）和垃圾条目风险。如未来需要"翻历史 LLM 分析"，再考虑把 `monitoring_runs` 与 `memories` 在检索时 union。

**替代方案**：让 monitoring 用 tool-use 主动调 `save_memory`。被否：复杂度↑、不可控（容易污染）、且现状下没有用户痛点。

### D2. 实体绑定：全局 + 可选 strategyId/symbol

`memories.strategyId` 可空，`memories.symbol` 自由文本不做 FK。理由：写笔记时不强制选策略（背景资料、未持仓标的的关注笔记都需要支持），按策略筛选时仍可命中（strategyId 非空时按 FK 查）。symbol 不做 FK，因为关注列表中的标的可能尚未持仓。

**替代方案**：纯全局（Vibe 的做法）/ 强制绑策略。前者无法做"该策略的所有笔记"视图，后者限制使用场景。

### D3. 全文搜索：pg_trgm trigram + LIKE fallback

PostgreSQL contrib 自带，CJK 友好（按字符 ngram，不依赖中文分词器）。`q.length >= 2` 走 `similarity()` 阈值 0.1；`q.length < 2` 退化为 `ILIKE %q%`（避免短查询召回过低）。GIN 索引 `gin_trgm_ops` 在 `memories.title` 与 `memories.content` 上。

**替代方案**：tsvector + 中文分词（zhparser）需第三方扩展，docker 镜像得换；纯 `LIKE` 在 100+ 条之后渐慢、无相似度排序。

### D4. monitoring 笔记预加载规则（不调 LLM、不做 embedding）

`loadRelevantMemories(strategyId, symbols)` 三类来源 union 后去重：
1. **pinned 全集**：`pinned = true AND (strategyId = ? OR strategyId IS NULL)`
2. **该策略最近笔记**：`strategyId = ?` 最近 30 天 Top 5
3. **该策略涉及标的的最近笔记**：`symbol IN (?,?,...)` 最近 30 天 Top 5

合并后按 `pinned DESC, updatedAt DESC` 截断到：≤ 8 条 / 每条内容 ≤ 200 字 / 总字符 ≤ 4000。

**替代方案**：embedding + 向量相似度 — 收益不明显（笔记数量在百级，关键词足够），且需要新依赖 / cron 计算 embedding。

### D5. monitoring 失败兜底

`loadRelevantMemories` try/catch；DB 异常时 warn 日志 + 传空数组进 `analyze`，monitoring 流程继续。理由：笔记是辅助信息，不应阻断核心监控。

### D6. insights 计算时机：请求时实时算

单人 < 1000 lot 量级，4 类指标在内存计算几十毫秒完事。API route 加 timing log，> 500ms 报警；超阈值再考虑预算缓存表。

**替代方案**：每日 worker 预算并存 `insights_snapshots` — 复杂度↑，对单人场景过度。

### D7. insights 阈值（mild / severe）

| 指标 | mild | severe |
|---|---|---|
| disposition.score = (avgLossDays - avgWinDays) / max(avgLossDays, ε) | > 0.3 | > 0.6 |
| anchoring.avgChaseHighPct | > 5% | > 15% |
| overtrading.avgTradesPerWeek | > 5 | > 10 |
| overtrading.flipsWithin3d | ≥ 1 | ≥ 3 |

阈值常量集中在 `apps/web/lib/insights.ts` 顶部，方便后续根据真实数据调校。

### D8. 空态：closedTrades < 5 直接返回 `{ empty: true, reason: "insufficient_data" }`

闭仓配对走 FIFO（按 positionId 分组、按 lotDate 升序、BUY 入栈、SELL 弹栈匹配 share 单位）。少于 5 笔时统计无意义。

### D9. anchoring.avgVsRefPct 的局限：用 positions.referencePrice 当前值

`positions.referencePrice` 由 monitoring 每日更新，没有历史快照。lot 时刻的 ref price 不可得，因此该字段是"BUY 价 vs 当前 ref price 偏离"的近似，而非严格的"BUY 价 vs lot 时刻 ref price"。在代码中加注释明示，未来可考虑 `reference_price_history` 表。

### D10. 数据库迁移：drizzle-kit push + 自定义脚本链式跑扩展

drizzle-kit push 不管 `CREATE EXTENSION` 与 `gin_trgm_ops` 索引。新增 `packages/db/scripts/ensure-pg-extensions.ts` 用 `postgres` 客户端跑 `CREATE EXTENSION IF NOT EXISTS pg_trgm` 与 `CREATE INDEX IF NOT EXISTS ... USING gin (... gin_trgm_ops)`。新增 npm script `db:migrate = db:push && db:setup-extensions`。Dockerfile `db-migrate` stage 的 CMD 改为 `npx drizzle-kit push && npx tsx scripts/ensure-pg-extensions.ts`。

**替代方案**：手写一个 numbered SQL migration 文件 — drizzle-kit push 是声明式 schema diff，不消费 numbered SQL，得切换到 drizzle-kit migrate 工作流，影响过大。

### D11. UI 模态框：自定义 fixed overlay，不引入 dialog 库

`apps/web/components/ui/` 没有 `dialog.tsx`，项目用 `@base-ui/react`（不是 radix）。为避免引入新依赖，`MemoryDialog` 用 `fixed inset-0 + bg-black/40 + onClick on backdrop` 自实现一个轻量模态框。够用，且与现有表单（lot-form / sell-form）用 Card inline 渲染的风格协调。

## Risks / Trade-offs

- **pg_trgm 中文短查询召回偏低** → `q.length < 2` 退化到 ILIKE；阈值 0.1 起步；上线观察召回率，必要时降到 0.05 或 union LIKE
- **monitoring prompt 字符预算被疯狂 pin 的笔记吃光** → 硬上限 8 条 / 每条 200 字 / 总 4000 字；pinned 也走相同上限
- **insights 全局视图扫表慢** → v1 不缓存，timing log > 500ms 报警再加缓存
- **`loadRelevantMemories` 失败影响 monitoring** → try/catch + 空数组 + warn 日志
- **avgVsRefPct 用当前 ref price，不是 lot 时刻** → 代码注释明示；未来加历史表再修

## Migration Plan

**首次部署**：
1. `git pull` 拿到本次 18 个 commit
2. 在 trader 根目录跑 `cd packages/db && npm run db:migrate`（或 docker-compose 起 db-migrate profile）
3. 验证：`psql $DATABASE_URL -c "\d memories"` 应显示 `memories_title_trgm_idx` 与 `memories_content_trgm_idx` 两个 GIN 索引
4. `docker compose up -d --force-recreate web worker`（或 npm run dev 本地）
5. 烟测：访问 `/memory` 建一条 pinned 笔记 → 触发 monitoring → 检查 prompt 中是否包含"你之前留下的相关笔记"段（看 monitoring_runs.analysis 是否有引用）→ 访问 `/insights` 看 4 张卡片渲染

**回滚**：
1. `git revert` 这 18 个 commit
2. `DROP TABLE memories CASCADE`（pg_trgm 扩展可保留，无副作用）
3. 重建 web/worker 镜像

实际上回滚风险很低：变更只新增表与代码、不修改任何已有表的 schema、不修改任何已有 API 的行为。

## Open Questions

- 后续是否需要把 `monitoring_runs.analysis` 也接入笔记搜索？等用户使用一段时间后看是否有"翻历史分析"的需求
- pg_trgm 阈值 0.1 是否合适？需要在真实笔记数据上观察召回与排序质量
- 是否需要笔记的"分享"或"导出"？目前是单人系统，先不做
