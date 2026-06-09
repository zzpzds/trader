## 1. DB schema

- [x] 1.1 在 `packages/db/src/schema.ts` 给 `monitoringRuns` 加 `suggestedSkills: jsonb("suggested_skills").$type<string[]>()`，nullable
- [x] 1.2 生成 migration
- [x] 1.3 在 `packages/db/src/schema.test.ts` 加断言：列存在且 nullable
- [x] 1.4 build + 测试通过

## 2. analyze.ts: catalog 注入 + suggested_skills

- [x] 2.1 给 `analyzeStrategy` 加第 7 个可选参数 `availableSkills: Array<{ name; description }> = []`
- [x] 2.2 实现 `catalogBlock` 拼接：空 → 空字符串；非空 → `## 可选技能目录\n（…说明…）\n- {name}: {description}\n…\n\n`
- [x] 2.3 prompt 模板插入 `${catalogBlock}` 在 `${skillsBlock}` 之后、`${memoriesBlock}` 之前
- [x] 2.4 在 `report_analysis` tool schema 末尾追加 `suggested_skills: { type: "array", items: { type: "string" }, description: "Optional: 0–3 skill names from the catalog that would help future analyses..." }`
- [x] 2.5 在 `AnalysisResult` 类型 + 解析逻辑里加 `suggestedSkills: string[]`，从 tool_use input 读取（缺失时默认 `[]`）
- [x] 2.6 扩展 analyze.test.ts：断言 catalog 注入位置正确、断言 result.suggestedSkills 解析

## 3. job.ts: 加载 catalog + 持久化推荐

- [x] 3.1 在 `processStrategy` 中加载所有 skills 的 name+description（一次 db.query.skills.findMany columns:{name,description}）；如果 catalog 大可考虑加缓存，初版直接每次查
- [x] 3.2 把 catalog 作为第 7 个参数传给 `analyze(...)`
- [x] 3.3 完成 monitoring_run 更新时，把 `analysisResult.suggestedSkills` 写入 `suggestedSkills` 列
- [x] 3.4 扩展 job.test.ts：断言 catalog 被传入、断言 suggestedSkills 列写入

## 4. seed manifest 后端

- [ ] 4.1 在 `apps/web/lib/skills.ts` 实现 `getSeedManifest()` 返回 `Array<{ name, description, category, currentBodyHash, status }>`
- [ ] 4.2 在 `apps/web/lib/skills.ts` 实现 `importSeedSkill({ name, mode })` 处理 create / overwrite-seed / duplicate 三种模式；mode 与状态校验在此层
- [ ] 4.3 创建 `apps/web/app/api/skills/seed/manifest/route.ts`：GET → manifest
- [ ] 4.4 创建 `apps/web/app/api/skills/seed/import/route.ts`：POST → 调用 importSeedSkill；mode 不匹配状态时返回 409；找不到 seed 文件返回 404
- [ ] 4.5 复用 Phase 1 的 `resolveSeedDir` 逻辑——抽到公共位置（建议放 `@trader/db` package 或创建 `apps/web/lib/seed-dir.ts`），让 web 也能定位 seed 目录
- [ ] 4.6 扩展 `apps/web/lib/__tests__/skills.test.ts`：覆盖 manifest 状态判断、import 三种模式、副本命名冲突时递增

## 5. /skills/import 页面

- [x] 5.1 创建 `apps/web/app/skills/import/page.tsx`：列表 + 状态徽章 + 操作按钮
- [x] 5.2 列表头部加返回 `/skills` 的链接 + 简短说明
- [x] 5.3 副本导入成功后展示「已创建副本：<新 name>」提示
- [x] 5.4 在 `/skills` 列表页头部加「导入向导」链接（小入口，不改 nav）

## 6. SkillsPanel 推荐 banner

- [x] 6.1 修改 `GET /api/strategies/[id]/skills` 响应增加 `latestSuggestedSkills: string[]` 字段（来自最新 status='completed' 的 monitoring_run.suggestedSkills；过滤 DB 中已不存在的 name）
- [x] 6.2 在 SkillsPanel 顶部 view mode 渲染 banner（仅当过滤已关联后剩余推荐 ≥ 1 时显示）
- [x] 6.3 「全部采纳」按钮：合并 + 受 ≤ 3 上限，调用 PUT
- [x] 6.4 「挑选」按钮：进入 edit mode 并预先勾选推荐项（受 ≤ 3）
- [x] 6.5 「关闭」按钮：本地 state 隐藏 banner，不持久化
- [x] 6.6 推荐为空 / 全部已关联 / banner 已关闭 时不渲染

## 7. 收尾

- [ ] 7.1 跑全量测试：db / worker / web 全绿
- [ ] 7.2 `openspec validate enhance-skills-library-phase-2 --strict` 通过
- [ ] 7.3 README 特色表更新（在 Phase 1 那行后追加一句"+ LLM 推荐 + 导入向导"，或单独一行——视觉一致性即可）
