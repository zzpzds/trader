## 1. 数据库 schema

- [x] 1.1 `packages/db/src/schema.ts` 新增 `skills` 表（项目惯例 `text` id 而非 uuid 类型）— commit `72e004c`
- [x] 1.2 新增 `strategy_skills` 关联表，FK ON DELETE CASCADE，复合主键 — commit `72e004c`
- [x] 1.3 `monitoring_runs.skill_snapshot` jsonb nullable — commit `72e004c`；type 提取为 `SkillSnapshot` — commit `0b62479`
- [x] 1.4 三个 Drizzle relations 添加，`strategiesRelations` 增量加 `skills: many(strategySkills)` — commit `72e004c`
- [x] 1.5 migration `packages/db/drizzle/0001_small_risque.sql` 生成（含本次新增 + 历史 drift catch-up）— commit `72e004c`
- [x] 1.6 schema.test.ts 增加 8 条断言覆盖 skills/strategy_skills/skill_snapshot/relation — commit `72e004c`
- [ ] 1.7 本地跑 migration 确认（**留给用户**：dev DB 已有 drift，需 controller 在 TTY 下交互运行 `npm run db:push -w @trader/db`）

## 2. Seed 资源准备

- [x] 2.1 根目录 `NOTICE` 文件 — commit `31c63c9`
- [x] 2.2 `packages/db/seed/skills/` 目录（路径调整：原计划 `apps/web/seed/`，但 Docker 仅 COPY `packages/db` 到 worker 镜像，故落到此处）— commit `31c63c9`
- [x] 2.3 5 个中文 seed markdown，每个 1700–2000 字符 — commit `31c63c9`
- [x] 2.4 内容中文重写，非翻译，适配本项目 reference_price/monitoring 语境 — commit `31c63c9`

## 3. Seed 执行脚本

- [x] 3.1 `apps/worker/src/lib/seed-skills.ts` idempotent seed 函数（手写 frontmatter parser，无新依赖）— commit `31c63c9`
- [x] 3.2 worker 启动流程调用 seed（位置调整：`apps/worker/src/worker.ts` 而非 `index.ts`，因 db 在 worker.ts 构造）— commit `31c63c9`
- [x] 3.3 `seed-skills.test.ts` 10 个测试覆盖 parser + 三个 spec 场景 — commit `31c63c9`

## 4. Skills CRUD API

- [x] 4.1 创建 `apps/web/lib/skills.ts`：实现 `listSkills`、`getSkill`、`createSkill`、`updateSkill`、`deleteSkill`、`setStrategySkills` 数据访问函数；body 长度校验 ≤ 6000、关联数 ≤ 3 在此层
- [x] 4.2 创建 `apps/web/app/api/skills/route.ts`：GET（列表，不含 body_md）+ POST（新建）
- [x] 4.3 创建 `apps/web/app/api/skills/[id]/route.ts`：GET（含 body_md）+ PATCH + DELETE
- [x] 4.4 创建 `apps/web/app/api/strategies/[id]/skills/route.ts`：PUT（整体替换关联，校验数量 ≤ 3）
- [x] 4.5 在 `apps/web/lib/__tests__/skills.test.ts` 写单元测试：长度校验、关联数量校验、name 唯一性、CASCADE 行为

## 5. /skills 页面

- [x] 5.1 创建 `apps/web/app/skills/page.tsx`：列表页，按 category 分组（预设 6 类），显示 name / description / source 标签
- [x] 5.2 创建 `apps/web/app/skills/new/page.tsx` 与 `apps/web/app/skills/[id]/edit/page.tsx`：编辑器（name / description / category 下拉 / body_md textarea + react-markdown 实时预览 / 字符计数）
- [x] 5.3 编辑页：当 skill 被 ≥ 1 策略关联时显示警告条
- [x] 5.4 删除按钮带二次确认对话框（显示关联策略数）
- [x] 5.5 把 `/skills` 加入主导航（参考 strategies/memories 入口）

## 6. 策略详情页关联 UI

- [x] 6.1 在 `apps/web/app/strategies/[id]/page.tsx` 增加「关联技能」区域，显示当前关联的 skill chips
- [x] 6.2 增加「编辑关联」交互（多选弹窗或行内编辑），数量上限 3 在 UI 强制
- [x] 6.3 提交时调用 `PUT /api/strategies/[id]/skills`，成功后刷新页面状态
- [~] 6.4 列表/卡片视图（如有）显示关联的 skill 数量徽章 — 跳过：`/strategies` 列表当前未展示其他元数据徽章，加 skill 计数会显得突兀；spec 标记为「如有」

## 7. analyze.ts 注入 skill

- [x] 7.1 在 `apps/worker/src/monitoring/analyze.ts` 的 `analyzeStrategy` 函数签名增加可选参数 `skills: Array<{ id, name, body_md }>`
- [x] 7.2 实现 `skillsBlock` 拼接逻辑：空数组 → 空字符串；非空 → `## 可用方法论\n\n### {name}\n{body_md}\n\n---\n\n...`
- [x] 7.3 修改 prompt 模板：在 `memoriesBlock` 之前插入 `skillsBlock`
- [x] 7.4 在 `apps/worker/src/monitoring/job.ts` 中：处理每个策略时查询 `strategy_skills` 关联，加载 skill body 后传入 analyzer
- [x] 7.5 落库 `monitoring_runs.skill_snapshot`：完成时写入 `[{ id, name, body_md_hash (sha256), body_md_preview (前 500 字符) }]`，未关联 skill 时写入空数组 `[]`

## 8. 测试

- [x] 8.1 扩展 `apps/worker/src/monitoring/__tests__/analyze.test.ts`：断言 skills 参数为空时 prompt 不含「可用方法论」、非空时包含每条 skill 的 body
- [x] 8.2 扩展 `apps/worker/src/monitoring/__tests__/job.test.ts`：断言 monitoring_runs 写入 skill_snapshot 字段、空关联时为空数组
- [x] 8.3 跑全量测试 `npm test --workspaces`：db 25/25、worker 81/81、web 178/178 全绿

## 9. 文档

- [x] 9.1 在 `apps/web/app/skills/page.tsx` 顶部加简短说明（已在 Task 5 实施时一并完成）
- [x] 9.2 在 README「特色」表加「🧩 技能库」行
- [x] 9.3 验证 `openspec validate add-skills-library --strict` 通过

## 10. 部署校验

- [ ] 10.1 本地 `docker-compose up -d` 重建 web + worker，确认 migration 跑通、seed 写入 5 条 skill（**留给用户**：dev DB 已有 drift，需要在干净环境验证）
- [ ] 10.2 在 web 上手动建一条 user skill、关联到某个策略（**留给用户**）
- [ ] 10.3 触发一次 manual monitoring，检查 monitoring_runs.skill_snapshot 字段写入正确（**留给用户**）
- [ ] 10.4 查看监控报告内容，确认 LLM 输出体现了 skill 注入的方法论指导（**留给用户**）
