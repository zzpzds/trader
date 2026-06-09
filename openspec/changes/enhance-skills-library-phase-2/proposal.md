## Why

Phase 1 (`add-skills-library`) 上线后，技能库可用但有两个「需要用户主动操作」的痛点：(1) 用户不知道自己的策略该挂什么 skill——空挂着监控就没增强；(2) 仓库里 seed markdown 后续升级了，用户也无从感知。Phase 2 解决这两个问题，但保持 Phase 1 设计的核心原则：决策权留在用户手上、不增加额外 LLM 调用、不破坏现有定时任务的稳定性。

## What Changes

- **LLM 推荐技能**：`analyze.ts` 在主 analyze prompt 里多注入一份「全量 skill 简介目录」（仅 name + description），并在 `report_analysis` tool schema 上新增 `suggested_skills: string[]` 字段。LLM 在做完三段式分析后，**顺手**推荐 0–3 个本次分析觉得有用、但用户还没挂上的 skill 名。零额外 LLM call。
- **持久化推荐**：`monitoring_runs` 新增 `suggested_skills jsonb` 列，存 LLM 返回的推荐名列表。
- **策略详情页提示**：「技能」tab 上方新增推荐 banner——当最新 monitoring_run 的 `suggested_skills` 非空且不全在已关联列表内，显示「系统推荐挂上：X、Y、Z（一键采纳）」。点采纳即把推荐合并进当前关联（仍受 ≤ 3 上限约束）。
- **Seed 导入向导**：新增 `/skills/import` 页面，列出 `packages/db/seed/skills/*.md` 里所有 seed 文件，逐个对比 DB 状态：
  - 「未导入」：DB 里还没有同名 skill → 提供「导入」按钮，写入 `source = 'seed'`
  - 「已导入（用户未改过）」：DB 里有同名 skill 且 `source = 'seed'` 且内容 hash 与仓库一致 → 灰显「已最新」
  - 「已导入（用户已编辑）」：DB 里有同名 skill 且内容 hash 与仓库不同 → 显示「用户已编辑，不覆盖」，提供「另存为副本」选项（`<name>-vibe-trading` 之类）
  - **从不自动覆盖用户编辑过的 skill**——仅手动触发的导入向导，不在启动时改写
- **API**：新增 `GET /api/skills/seed/manifest` 返回 seed 列表 + 状态；`POST /api/skills/seed/import` 触发单条导入
- **保留 Phase 1 启动 seed 行为不变**：worker 启动时仍只 upsert 不存在的 seed，已存在的（无论用户改没改过）一律跳过

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `skills-library`：新增 LLM 推荐持久化、推荐 UI、seed 导入向导、seed manifest API
- `daily-monitoring`：analyze.ts 注入 skill catalog 简介 + 解析 `suggested_skills` 字段 + 写入 `monitoring_runs.suggested_skills`

## Impact

- **Code**：
  - `packages/db/src/schema.ts`、`packages/db/drizzle/*` — `monitoring_runs.suggested_skills` jsonb 列
  - `apps/worker/src/monitoring/analyze.ts` — prompt 加目录注入、tool schema 加字段、返回值含 `suggestedSkills`
  - `apps/worker/src/monitoring/job.ts` — 加载 catalog 传入、持久化 `suggestedSkills`
  - `apps/web/lib/skills.ts` — 加 `listSeedManifest()`、`importSeedSkill(name)` 数据访问函数
  - `apps/web/app/api/skills/seed/manifest/route.ts`、`import/route.ts` — 新 API
  - `apps/web/app/skills/import/page.tsx` — 导入向导页面
  - `apps/web/app/strategies/[id]/page.tsx` — SkillsPanel 加推荐 banner（最新 monitoring_run 的 suggestions）
  - `apps/web/lib/__tests__/skills.test.ts`、`apps/worker/src/monitoring/__tests__/{analyze,job}.test.ts` — 扩展测试
- **API**：新增 2 条；`GET /api/strategies/[id]/skills` 响应增加 `latestSuggestedSkills` 字段（或单独新增 `GET /api/strategies/[id]/skills/suggestions` — 设计阶段定）
- **依赖**：无新增 npm 包
- **Token 影响**：每次 analyze prompt 多注入一份 catalog 简介（每条 ~50 字节 × N，5 个 skill ≈ 250 字节）。可控。
- **不在范围**：
  - 不做 seed 启动时自动同步（仍只 import-on-missing）
  - 不做 LLM 自动**选择**已有 skill（决策权仍在用户）
  - 不做推荐的「忽略」状态持久化（用户每次新 run 都会看到最新推荐；如果不满意只需关联或不关联）
  - 不做 seed 之间的版本号 / changelog 机制
