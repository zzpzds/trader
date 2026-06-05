## Why

trader 当前每次 monitoring 都是无状态的 — LLM 看不到历史判断、用户的复盘和对某只标的的长期看法；同时 `positionLots` 已经积累了完整事务流水，但没有任何回溯分析（胜率、处置效应、追高、过度交易）。本次变更补足"个人交易系统"长期缺失的两块：横向上下文（让 monitoring 跨日记忆），纵向自省（让用户看到自己的交易行为画像）。灵感源自 Vibe-Trading（`agent/src/memory/persistent.py` 与 `agent/src/shadow_account/`），但完全在 trader 现有 Node.js + PostgreSQL 栈中原生实现，不引入 Python sidecar。

## What Changes

- 新增 `memories` 表 + pg_trgm GIN 索引（CJK 友好的全文搜索）
- 新增 `/api/memories/*` CRUD + 检索 API（GET 列表/单条、POST、PATCH、DELETE）
- 新增 `/api/insights` 计算 API（接受可选 `strategyId`，请求时实时计算）
- 新增 `/memory` 页面（笔记管理：列表、搜索、新建、编辑、删除、置顶）
- 新增 `/insights` 页面（全局 / 按策略 两个 tab，4 类指标卡片 + 严重程度 flag）
- `/strategies/[id]` 页新增 "笔记" tab（按策略筛选，新建时自动绑定）
- 全局导航（sidebar + mobile-nav）新增"笔记"和"行为诊断"入口
- monitoring 流程接入：`apps/worker/src/monitoring/load-memories.ts`（按 pinned + strategyId + symbols 检索 Top-N，去重并截断到 8 条/4000 字符），`analyze.ts` 接受 `memories` 入参并把"你之前留下的相关笔记"段插入 prompt
- Docker `db-migrate` target 与 `npm run db:migrate` 链上 `ensure-pg-extensions.ts`（CREATE EXTENSION pg_trgm + GIN 索引）

## Capabilities

### New Capabilities

- `memory-notes`: 用户笔记的存储、检索、和向 monitoring LLM prompt 的注入。包含写入主体（用户手动）、读取触发（monitoring 时自动预加载）、相似度搜索（pg_trgm trigram + LIKE 短查询 fallback）、prompt 字符预算（≤8 条/≤200 字/总 4000 字）、置顶语义。
- `trade-insights`: 基于现有 `positionLots` + `priceSnapshots` 的交易行为诊断。包含 4 类指标（基础财务、处置效应、锚定/追高、过度交易）的计算口径、阈值（mild/severe）、空态判定（< 5 笔已平仓）、和 UI 呈现规则。

### Modified Capabilities

无。本次变更不修改任何已有 capability 的需求。`daily-monitoring` 的 prompt 字符串变了（多一段笔记注入），但其行为契约（严格按规则判断 + tool_use 输出）未变，因此不算 spec-level 修改。

## Impact

- **新表**：`memories`（含 strategyId FK→strategies.id ON DELETE SET NULL）
- **PostgreSQL 扩展**：必须启用 `pg_trgm`（contrib，零额外依赖）
- **新代码**：
  - `apps/web/lib/{memory-search,insights}.ts` + 单元测试
  - `apps/web/app/api/{memories,memories/[id],insights}/route.ts`
  - `apps/web/app/{memory,insights}/page.tsx`
  - `apps/web/components/memory-dialog.tsx`
  - `apps/worker/src/monitoring/load-memories.ts` + 单元测试
  - `packages/db/scripts/ensure-pg-extensions.ts`
- **修改代码**：
  - `packages/db/src/schema.ts`（+memories 表 + relation）
  - `packages/db/src/schema.test.ts`（+4 case）
  - `packages/db/package.json`（+`db:setup-extensions` / `db:migrate` script）
  - `Dockerfile`（db-migrate stage 链上扩展安装）
  - `apps/web/components/layout/{sidebar,mobile-nav}.tsx`（+2 nav 项）
  - `apps/web/app/strategies/[id]/page.tsx`（+notes tab）
  - `apps/worker/src/monitoring/{analyze,job}.ts`（接受 memories + 在 job 中加载）
- **依赖**：无新 npm 包；复用现有 drizzle-orm / postgres / lucide-react / vitest / Anthropic SDK
- **运维**：首次部署需运行 `npm run db:migrate`（或 docker-compose `db-migrate` profile）以创建表 + 扩展 + GIN 索引
- **不影响**：strategies / positions / position_lots / monitoring_runs / notifications / news_summaries / price_snapshots 已有表的 schema、现有 API 行为、现有 UI 页面（除 sidebar/mobile-nav 增加链接和 strategies/[id] 增加 tab）
