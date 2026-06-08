## 1. 数据库 schema

- [ ] 1.1 在 `packages/db/src/schema.ts` 新增 `skills` 表（`id` uuid pk、`name` text unique、`description` text、`category` text、`body_md` text、`source` text default `'user'`、`created_at`、`updated_at`）
- [ ] 1.2 新增 `strategy_skills` 关联表（`strategy_id` fk、`skill_id` fk ON DELETE CASCADE、复合主键）
- [ ] 1.3 在 `monitoring_runs` 表追加 `skill_snapshot` jsonb 列（nullable，默认 null）
- [ ] 1.4 添加 `strategiesRelations` / `skillsRelations` / `strategySkillsRelations` 三个 Drizzle relations
- [ ] 1.5 生成新 migration 文件 `packages/db/drizzle/<next>_add_skills.sql` 并 review SQL
- [ ] 1.6 在 `packages/db/src/schema.test.ts` 补充表存在性 + 关联性的最小断言
- [ ] 1.7 本地跑一次 `pnpm --filter @trader/db push` 或 `migrate` 确认 migration 通过

## 2. Seed 资源准备

- [ ] 2.1 在仓库根目录创建 `NOTICE` 文件，声明 vibe-trading MIT 来源 + 链接
- [ ] 2.2 创建 `packages/db/seed/skills/` 目录（注：原计划 `apps/web/seed/`，但 Docker 仅 COPY `packages/db` 到 worker 镜像，故落到此处）
- [ ] 2.3 编写 5 个中文 seed markdown：`candlestick.md`、`risk-checklist.md`、`reference-price-management.md`、`behavioral-finance.md`、`valuation-basic.md`，每个 ≤ 6000 字符，frontmatter 含 `name` / `description` / `category`
- [ ] 2.4 内容参考 vibe-trading 对应 skill 但用中文重写并精简到本项目语境（不直接复制英文）

## 3. Seed 执行脚本

- [ ] 3.1 在 `apps/worker/src/lib/seed-skills.ts` 实现 idempotent seed 函数：扫描 `packages/db/seed/skills/*.md`、解析 frontmatter + body、按 `name` 检查存在性、不存在则插入（`source = 'seed'`）
- [ ] 3.2 在 `apps/worker/src/index.ts` 启动流程中调用 seed 函数，错误只记 log 不阻塞
- [ ] 3.3 在 `apps/worker/src/lib/__tests__/seed-skills.test.ts` 写测试：首次插入、重复跳过、单条失败不影响其他

## 4. Skills CRUD API

- [ ] 4.1 创建 `apps/web/lib/skills.ts`：实现 `listSkills`、`getSkill`、`createSkill`、`updateSkill`、`deleteSkill`、`setStrategySkills` 数据访问函数；body 长度校验 ≤ 6000、关联数 ≤ 3 在此层
- [ ] 4.2 创建 `apps/web/app/api/skills/route.ts`：GET（列表，不含 body_md）+ POST（新建）
- [ ] 4.3 创建 `apps/web/app/api/skills/[id]/route.ts`：GET（含 body_md）+ PATCH + DELETE
- [ ] 4.4 创建 `apps/web/app/api/strategies/[id]/skills/route.ts`：PUT（整体替换关联，校验数量 ≤ 3）
- [ ] 4.5 在 `apps/web/lib/__tests__/skills.test.ts` 写单元测试：长度校验、关联数量校验、name 唯一性、CASCADE 行为

## 5. /skills 页面

- [ ] 5.1 创建 `apps/web/app/skills/page.tsx`：列表页，按 category 分组（预设 6 类），显示 name / description / source 标签
- [ ] 5.2 创建 `apps/web/app/skills/new/page.tsx` 与 `apps/web/app/skills/[id]/edit/page.tsx`：编辑器（name / description / category 下拉 / body_md textarea + react-markdown 实时预览 / 字符计数）
- [ ] 5.3 编辑页：当 skill 被 ≥ 1 策略关联时显示警告条
- [ ] 5.4 删除按钮带二次确认对话框（显示关联策略数）
- [ ] 5.5 把 `/skills` 加入主导航（参考 strategies/memories 入口）

## 6. 策略详情页关联 UI

- [ ] 6.1 在 `apps/web/app/strategies/[id]/page.tsx` 增加「关联技能」区域，显示当前关联的 skill chips
- [ ] 6.2 增加「编辑关联」交互（多选弹窗或行内编辑），数量上限 3 在 UI 强制
- [ ] 6.3 提交时调用 `PUT /api/strategies/[id]/skills`，成功后刷新页面状态
- [ ] 6.4 列表/卡片视图（如有）显示关联的 skill 数量徽章

## 7. analyze.ts 注入 skill

- [ ] 7.1 在 `apps/worker/src/monitoring/analyze.ts` 的 `analyzeStrategy` 函数签名增加可选参数 `skills: Array<{ id, name, body_md }>`
- [ ] 7.2 实现 `skillsBlock` 拼接逻辑：空数组 → 空字符串；非空 → `## 可用方法论\n\n### {name}\n{body_md}\n\n---\n\n...`
- [ ] 7.3 修改 prompt 模板：在 `memoriesBlock` 之前插入 `skillsBlock`
- [ ] 7.4 在 `apps/worker/src/monitoring/job.ts` 中：处理每个策略时查询 `strategy_skills` 关联，加载 skill body 后传入 analyzer
- [ ] 7.5 落库 `monitoring_runs.skill_snapshot`：完成时写入 `[{ id, name, body_md_hash (sha256), body_md_preview (前 500 字符) }]`，未关联 skill 时写入空数组 `[]`

## 8. 测试

- [ ] 8.1 扩展 `apps/worker/src/monitoring/__tests__/analyze.test.ts`：断言 skills 参数为空时 prompt 不含「可用方法论」、非空时包含每条 skill 的 body
- [ ] 8.2 扩展 `apps/worker/src/monitoring/__tests__/job.test.ts`（如不存在则新建）：断言 monitoring_runs 写入 skill_snapshot 字段、空关联时为空数组
- [ ] 8.3 跑全量测试 `pnpm test` 确保现有 monitoring / strategies 测试无回归

## 9. 文档

- [ ] 9.1 在 `apps/web/app/skills/page.tsx` 顶部加简短说明「skill 是可挂到策略上的方法论文档，监控分析时会注入到 LLM prompt」
- [ ] 9.2 在 README 截图区或「特色」表加一行「🧩 技能库 — 给策略挂载方法论文档增强 LLM 分析」（视觉一致性，无需新截图）
- [ ] 9.3 验证 `openspec validate add-skills-library --strict` 通过

## 10. 部署校验

- [ ] 10.1 本地 `docker-compose up -d` 重建 web + worker，确认 migration 跑通、seed 写入 5 条 skill
- [ ] 10.2 在 web 上手动建一条 user skill、关联到某个策略
- [ ] 10.3 触发一次 manual monitoring，检查 monitoring_runs.skill_snapshot 字段写入正确
- [ ] 10.4 查看监控报告内容，确认 LLM 输出体现了 skill 注入的方法论指导
