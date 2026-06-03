## Context

今天 `positions.strategy_id` NOT NULL,持仓必须挂在某个策略下;价格数据通过 `monitoringRuns.prices`(每日 LLM 分析的副产物)按 strategyId 组织。这导致两件事都做不到:(1) 用户没有策略时无法记录持仓与 P&L;(2) 任何"账户级"价格统计都被迫绕道 monitoringRuns,产生"按 strategyId 索引价格"这种概念错位。

详细背景与完整设计参见 `docs/superpowers/specs/2026-06-02-manual-positions-design.md`。本文档浓缩关键决策。

## Goals / Non-Goals

**Goals:**
- 支持记录非策略持仓,在 `/positions` 页面与策略持仓视觉隔离展示。
- 手动持仓与策略持仓共享一份历史 P&L 曲线与账户总览(总成本/总市值)。
- 价格数据集中到一张时间序列表,monitoring 与 portfolio 视图都从这一张表读。
- 每条策略可独立配置 LLM 分析的窗口天数。

**Non-Goals:**
- 手动持仓的 LLM 分析或通知(显式排除)。
- "手动持仓 → 策略" 的 UI 转移(数据模型支持,UI 留待后续变更)。
- 删除 `monitoringRuns.prices` 字段(保留至少一个发布周期)。
- 卖出/对账(沿用现有"删 lot"语义)。
- 价格 provider 抽象层重构(三个 provider 已并存,不本次动)。

## Decisions

### D1: `positions.strategy_id` 改 nullable,而非新建 `manual_positions` 表

复用 `positions` 与 `position_lots`,以 `strategy_id IS NULL` 表达"手动"。**理由**:避免 summary / history 等聚合查询需要 UNION 两张表;复用现有 lot 行为,不重复实现。**权衡**:`(strategy_id, symbol)` 唯一索引必须改 `NULLS NOT DISTINCT` 才能阻止同一手动 symbol 重复行(Postgres 15+ 才支持,部署环境已确认满足);所有按 strategyId 过滤的查询天然不含手动持仓,无需额外条件。

### D2: 删 strategy 改 ON DELETE SET NULL(原 CASCADE)

避免误删策略时丢真金白银的 lots:被孤立的持仓自动降级为手动,继续可见。**权衡**:用户若想"清空一个策略包括其持仓"得多一步手动删除——可接受。

### D3: 新建 `price_snapshots(symbol, date, OHLCV)` 时间序列表

替代"读 monitoringRuns.prices"的旧路径。**理由**:同时承载 (i) 最新价(`ORDER BY date DESC LIMIT 1`)与 (ii) 历史 P&L 曲线(按 date 分组),消除"价格按 strategyId 索引"的概念错位;手动持仓与策略持仓共享同一份数据。**权衡**:`monitoringRuns.prices` 字段仍保留,但新代码不再写入——单一数据源期间的过渡冗余。

### D4: 价格刷新作业从 monitoring 中剥离(独立 `daily-price-refresh` 队列)

`daily-price-refresh` 01:00 UTC 跑,聚合所有持仓 symbol 一次性 fetch;`daily-monitoring` 02:00 UTC 跑,只做 LLM 分析,数据从 `price_snapshots` 读。**理由**:
- 解耦"行情数据"和"AI 分析"两个生命周期。
- 手动持仓和策略持仓走同一份刷新流。
- Alpha Vantage 限速严苛(12s/symbol),避免重复抓取节省 quota。

**考虑过的替代**:在 monitoring 内部按需补抓——拒绝,因为它把行情依赖与 LLM 推理紧耦合,且每次 monitoring 重抓一次 60 天数据,quota 浪费明显。

### D5: 手动持仓 backfill 异步化

`POST /api/positions/manual` 立刻 201 返回,把 `manual-backfill` 任务投递给 pg-boss;worker 调 `ensurePriceSnapshots(symbol, fromDate)` 拉满"lot 日期 → 今天"。前端轮询 `GET /api/positions/manual`,价格就位前显示"价格加载中"。**理由**:Alpha Vantage 一个 90 天回填要 ~12s,HTTP 同步等不可接受。

### D6: backfill 范围 = 最早 lot 日期 → 今天(不固定 60 天)

避免 lot 日期早于固定窗口时缺失历史。`fetchPrices` 内部按 `daysBack > 100` 自动切 Alpha Vantage `outputsize=full`,深度可控。

### D7: `analysis_window_days` 放 strategies 表(默认 60)

不同时间尺度的策略需要独立窗口(短线 30 天、长线 365 天)。**权衡**:配置入口需要在策略编辑页加输入;默认值与现行硬编码一致,无回归。

### D8: UI 用 Tab 隔离,但总览/曲线跨 tab

`/positions` 页面顶部总览卡 + PnL 曲线**始终**展示账户级(策略 + 手动合并),Tab 只切下方列表。**理由**:用户的核心诉求是"看到全部账户的总收益",拆账反而丢信息;隔离仅在列表细节维度,不污染汇总。

## Risks / Trade-offs

- **[迁移期数据空洞]** schema 变更后但 `daily-price-refresh` 还没跑过一次时,`price_snapshots` 是空的,monitoring 与 summary/history 都失败。**Mitigation**:部署顺序固定为 (1) schema 迁移 → (2) 一次性 `scripts/backfill-price-snapshots.ts` → (3) 启新 worker → (4) 发布 web;过渡期内 `runMonitoringJob` 保留"snapshot 全空时 fallback 到 inline `fetchPrices`",1-2 周后清理。

- **[Alpha Vantage 限速]** 大量持仓的初次 backfill 数十分钟串行(12s/symbol)。**Mitigation**:在维护窗口内执行;不在用户请求路径上同步等待;`manual-backfill` 单 symbol 投递,失败由 pg-boss 重试 3 次,继续失败则下一次 `daily-price-refresh` 自动续命。

- **[NULLS NOT DISTINCT 依赖 PG15+]** 部署环境若降级到 PG14 即破。**Mitigation**:已确认当前部署在 PG15+;在 schema 迁移测试中加显式断言,基础架构变更触发 CI 失败。

- **[`monitoringRuns.prices` 双写冗余]** 字段保留但不写,旧代码若被误调用会读到 stale 数据。**Mitigation**:本次变更显式删除写入路径(grep 验证 `prices: priceSnapshots` 在新 `job.ts` 不存在);旧端点切换到 `price_snapshots`;字段在下一独立变更中清理。

- **[Tab 状态与 URL]** 如果用户从书签直接跳到 `/positions?tab=manual`,但用户从未启用过手动持仓,显示空列表 + "暂无手动持仓"——可接受,无功能损失。

## Migration Plan

1. **DB schema 迁移**:`drizzle-kit generate` + 上线时执行(三处变更:positions nullable + 唯一索引重建、strategies 加 analysis_window_days、新表 price_snapshots)。
2. **一次性回填**:跑 `scripts/backfill-price-snapshots.ts`,每个现存 symbol 从 `MIN(MIN(lot.lot_date for that symbol), today − MAX(strategies.analysis_window_days))` 回填到今天。
3. **启用新 worker**:`daily-price-refresh` 与 `manual-backfill` 队列注册;`runMonitoringJob` 改读 `price_snapshots`(过渡期保留 inline fallback)。
4. **发布 web**:暴露手动持仓 UI 与 API,旧 summary/history 端点切换数据源。
5. **稳定 1-2 周后**:删除 `runMonitoringJob` 中的 inline fallback;独立变更清理 `monitoringRuns.prices` 字段。

**回滚**:每一步可独立 down migration;关键功能无 feature flag 但 worker 端有 fallback,即使新代码有问题也能用旧路径短期续命。
