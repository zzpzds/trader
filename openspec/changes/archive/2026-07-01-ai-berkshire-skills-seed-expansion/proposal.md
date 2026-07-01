## Why

当前技能库 seed 只有 5 个内置方法论，覆盖偏短期形态、风险和基础估值；缺少基本面复核、买入纪律、持仓 thesis 验伪、组合结构复盘等价值投资流程。已有 `~/code/ai-berkshire/skills/*.md` 中有一组可复用的中文投研方法论，适合改写为 trader 的 seed skill，通过 `/skills/import` 提供给用户导入并挂载到策略监控。

## What Changes

- 扩展技能分类，新增 `fundamental`（基本面）和 `process`（流程纪律），并保持 `other` 作为最后的兜底分组。
- 在 `packages/db/seed/skills/` 新增 8 个 ai-berkshire 改写版 seed skill：
  - `quality-screen`
  - `investment-checklist`
  - `thesis-tracker`
  - `portfolio-review`
  - `earnings-review`
  - `news-pulse`
  - `management-deep-dive`
  - `dyp-ask`
- 每个新 seed skill 保留原方法论骨架，但移除 slash command、并行 Agent、外部 Python 工具和报告文件路径等不适合 trader prompt 注入场景的内容。
- 增加 seed skill 文件校验测试，扫描所有 `packages/db/seed/skills/*.md`，验证 frontmatter、唯一 name、合法 category 和正文长度上限。
- 不改变数据库 schema、API contract 或 worker 分析流程；新增 seed 文件将通过现有 seed manifest/import 管线自动暴露给 `/skills/import`。

## Capabilities

### New Capabilities
- `skills-seed-library`: 内置技能种子库应支持分类扩展、仓库 markdown seed 文件校验，以及从 ai-berkshire 改写的基本面/流程纪律类 seed skill。

### Modified Capabilities
- None.

## Impact

- Affected code:
  - `apps/web/lib/skills-ui.ts`
  - `packages/db/src/seed-skills.test.ts`
  - `packages/db/seed/skills/*.md`
- Affected UI:
  - `/skills` 分类展示会出现「基本面」「流程纪律」
  - `/skills/import` 会自动列出新增 seed skill
- Affected tests:
  - `npm run test -w packages/db -- seed-skills`
  - `npm run test -w apps/web -- skills`
  - `npm run build -w apps/web`
- No database migration, runtime dependency, or external service change.
