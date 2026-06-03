## Why

用户除了策略下的持仓,还会有"未绑定任何策略"的临时性买入(例如不属于既有策略的随机投机/收藏单),这些持仓今天无法在系统里跟踪。其根因是 `positions.strategy_id` 必须非空、`monitoringRuns.prices` 是按策略组织的——没有策略就没有价格,也就没有 P&L。本次改动同时解决这两个问题,使账户级总览/历史曲线真实反映"全部持仓",并把价格数据从 monitoring run 里解耦,降低未来扩展(如多账户、多 provider)的耦合成本。

## What Changes

- **新增 「手动持仓」概念**:`positions.strategy_id` 改为可空,UI 上 `/positions` 页面增加「策略持仓」/「手动持仓」两个 tab,新增独立的增删查 API。
- **新增 `price_snapshots` 时间序列价格表**(`symbol, date` 主键, OHLCV)作为账户级唯一价格数据源。
- **新增独立 `daily-price-refresh` worker 队列**,每日 01:00 UTC 一次性刷新所有持仓 symbol 的最新价。
- **新增 `manual-backfill` 异步队列**:手动持仓 POST 时入队,worker 后台调 Alpha Vantage 把该 symbol 从 lot 日期回填到今天。
- **修改 daily-monitoring**:不再自己拉行情,改为从 `price_snapshots` 读窗口数据;新增 `strategies.analysis_window_days` 字段允许每条策略独立配置 LLM 分析窗口(默认 60)。
- **修改 portfolio-pnl-summary 与 pnl-history-chart**:数据源从 `monitoringRuns.prices`(按 strategyId 组织)切换到 `price_snapshots`(按 symbol 组织);**包含**手动持仓的 cost / value / 历史曲线贡献。
- **BREAKING(内部)**:`monitoringRuns.prices` 字段保留至少一个发布周期但**不再被新代码写入**;依赖该字段的下游须迁移至 `price_snapshots`。
- **删策略行为变更**:删 strategy 不再级联删除其 positions,而是把这些 positions 的 `strategy_id` 置 NULL(降级为手动持仓)。

## Capabilities

### New Capabilities

- `manual-positions`: 非策略持仓的录入、查询、删除;其在总览页面的展示与最新价加载状态。
- `price-snapshots`: 账户级统一价格数据源(OHLCV 时间序列),含每日刷新作业与按需回填能力。

### Modified Capabilities

- `position-management`: `positions.strategy_id` 改为可空,删 strategy 由 CASCADE 改为 SET NULL。
- `daily-monitoring`: LLM 分析的窗口数据来源切到 `price_snapshots`;每条策略可配置 `analysis_window_days`;`monitoringRuns.prices` 不再写入。
- `portfolio-pnl-summary`: 数据源切到 `price_snapshots`,包含手动持仓。
- `pnl-history-chart`: 数据源切到 `price_snapshots`,包含手动持仓,曲线时点改为按 snapshot 日期(而非 monitoring run 日期)。

## Impact

- **数据库**:`positions` schema 变更(nullable + FK SET NULL + UNIQUE NULLS NOT DISTINCT);`strategies` 加 `analysis_window_days`;新增 `price_snapshots` 表。Drizzle 迁移文件随之产生。
- **Worker**(`apps/worker`):新增 `price-refresh-job.ts`、`price-snapshots.ts` (helper);`worker.ts` 注册两条新队列;`monitoring/job.ts` 重构。
- **Web**(`apps/web`):新增 `/api/positions/manual` 系列路由、`lib/queue.ts`(pg-boss client);`/api/positions/summary`、`/api/positions/history` 重写;`/positions` 页面引入 tabs;新增 `<LotForm>` 共享组件与 `<ManualPositionsTab>`。
- **依赖**:`apps/web` 新增 `pg-boss`;若 UI 用 Radix Tabs 也会引入 `@radix-ui/react-tabs`。
- **运维**:部署需先跑 schema 迁移,再跑一次性 `scripts/backfill-price-snapshots.ts` 脚本(预计数十分钟,受 Alpha Vantage 限速制约),再启新 worker、再发布 web。
- **数据兼容**:`monitoringRuns.prices` 旧值保留可读,但 summary/history 不再读它;后续清理由独立变更负责。
