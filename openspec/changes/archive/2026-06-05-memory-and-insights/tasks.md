## 1. Schema and Migrations

- [x] 1.1 Add `memories` table to `packages/db/src/schema.ts`（含 4 类 kind enum、可选 strategyId FK + ON DELETE SET NULL、symbol、tags jsonb、pinned、3 个普通索引、relations）
- [x] 1.2 Create `packages/db/scripts/ensure-pg-extensions.ts` (CREATE EXTENSION pg_trgm + 两个 GIN gin_trgm_ops 索引，幂等)
- [x] 1.3 Add npm scripts `db:setup-extensions` 与 `db:migrate` 到 `packages/db/package.json`
- [x] 1.4 Update `Dockerfile` `db-migrate` target 链上扩展安装步骤
- [x] 1.5 Cover memories table in `packages/db/src/schema.test.ts`（4 个 case：列、kind 默认、pinned 默认、strategyId 可空）

## 2. Memory Backend

- [x] 2.1 Implement `apps/web/lib/memory-search.ts` 查询构建器（trgm/like/none 三种 mode，limit 钳制，filter 透传）
- [x] 2.2 Unit-test memory-search builder (`apps/web/lib/__tests__/memory-search.test.ts`，5 个 case)
- [x] 2.3 Implement `GET/POST /api/memories` (`apps/web/app/api/memories/route.ts`)；trgm 用 `similarity()` + 0.1 阈值，like 用 `ILIKE`，filter AND 组合
- [x] 2.4 Test list+create endpoint（5 个 case：返回行、q 触发 trgm、必填校验、kind 校验）
- [x] 2.5 Implement `GET/PATCH/DELETE /api/memories/:id` (`apps/web/app/api/memories/[id]/route.ts`)；PATCH 接受任意字段子集，DELETE 返回 204
- [x] 2.6 Test by-id endpoint（7 个 case：404、200、PATCH 字段、PATCH 404、PATCH 校验、DELETE 204、DELETE 404）

## 3. Memory UI

- [x] 3.1 Add `/memory` 与 `/insights` 链接到 `apps/web/components/layout/sidebar.tsx`（StickyNote / LineChart 图标）
- [x] 3.2 Add 同样两条到 `apps/web/components/layout/mobile-nav.tsx`（短标签）
- [x] 3.3 Implement `apps/web/components/memory-dialog.tsx`（自定义 fixed overlay 模态框；title / content / kind / strategy / symbol / pinned）
- [x] 3.4 Implement `apps/web/app/memory/page.tsx`（列表 + 搜索 debounce + kind / strategy 筛选 + 新建按钮 + 空态）
- [x] 3.5 Add "笔记" tab 到 `apps/web/app/strategies/[id]/page.tsx`（NotesPanel 子组件，预绑定 strategyId）

## 4. LLM Integration

- [x] 4.1 Implement `apps/worker/src/monitoring/load-memories.ts`（三类来源 union + 去重 + cap 8/200/4000；DB 异常吞错返回空数组）
- [x] 4.2 Test merge/cap (`apps/worker/src/monitoring/__tests__/load-memories.test.ts`，5 个 case：去重、排序、8 条上限、200 字截断、4000 总字符上限)
- [x] 4.3 Modify `apps/worker/src/monitoring/analyze.ts`：accept optional `memories: RelevantMemory[] = []`，prompt 中条件渲染"## 你之前留下的相关笔记"段
- [x] 4.4 Add 3 个新 case 到 `apps/worker/src/monitoring/__tests__/analyze.test.ts`（含、不含、back-compat）
- [x] 4.5 Wire `apps/worker/src/monitoring/job.ts` 在 analyze 调用前 await loadRelevantMemories(db, strategyId, symbols)

## 5. Insights Backend

- [x] 5.1 Implement `apps/web/lib/insights.ts`（FIFO 配对 + 4 类指标 + flag 阈值 + 空态）
- [x] 5.2 Test 5 个 case (`apps/web/lib/__tests__/insights.test.ts`)：空态、基础财务、处置 severe、锚定 severe、过度交易 severe
- [x] 5.3 Implement `GET /api/insights` (`apps/web/app/api/insights/route.ts`)；接受 strategyId、JOIN positions+lots、加 timing log
- [x] 5.4 Test 1 个 case：< 5 closed trades 返回 empty

## 6. Insights UI

- [x] 6.1 Implement `apps/web/app/insights/page.tsx`（全局/按策略两 tab，4 张卡片，flag 颜色，空态）

## 7. Verification

- [x] 7.1 全 workspace 测试通过：packages/db (17) + apps/worker (66) + apps/web (142) = 225/225
- [x] 7.2 type-check clean：apps/web 与 apps/worker 都 `tsc --noEmit` 无新错误
- [x] 7.3 修复发现的预存日期 stale 测试：`app/api/notifications/__tests__/route.test.ts` 加 `vi.useFakeTimers + setSystemTime("2026-05-21")`
