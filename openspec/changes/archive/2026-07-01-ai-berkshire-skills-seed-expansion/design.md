## Context

trader 已有技能库能力：seed markdown 存放在 `packages/db/seed/skills/`，worker 启动时可 seed，web 的 `/skills/import` 可通过 seed manifest 手动导入仓库内置 skill。现有 seed skill 数量少且分类偏短线/风险，无法覆盖价值投资监控中常见的基本面复核、买入前 checklist、thesis 验伪、组合复盘和管理层评估。

本变更基于已经写好的 superpowers 实现计划 `docs/superpowers/plans/2026-06-30-ai-berkshire-port-A-skills-seed.md`，将 `~/code/ai-berkshire/skills/*.md` 中 8 个适合 trader 监控上下文的投研 skill 改写为 seed 文件。变更保持纯 additive：不改 schema、不改 API、不改 worker prompt 拼接逻辑。

## Goals / Non-Goals

**Goals:**

- 新增 `fundamental` 和 `process` 两个 skill category，并提供中文 label。
- 新增 8 个 ai-berkshire 改写版 seed skill，全部可被现有 seed/import 管线发现。
- 保证每个 seed skill 的 frontmatter 可解析、name 唯一、category 合法、body 不超过 `SKILL_BODY_MAX`。
- 移除原 ai-berkshire 文档中的 slash command、并行 Agent、Python 工具调用、报告文件路径等外部 workflow 指令，改写为 trader 持仓监控 prompt 方法论。

**Non-Goals:**

- 不新增数据库表、字段或 migration。
- 不修改策略与 skill 的关联上限、API 或 UI 交互流程。
- 不移植 ai-berkshire 中的多 Agent 长报告 workflow，例如 `investment-team`、`earnings-team`、`industry-research`、`wechat-article`。
- 不解决 LLM 基本面数据源不足问题；这里只提供方法论 seed，数据增强留给后续变更。

## Decisions

1. **使用 seed markdown 而不是代码内置数组。**
   - 选择：每个 skill 作为 `packages/db/seed/skills/<name>.md` 文件。
   - 替代：把内容写入 TypeScript 常量或数据库 migration。
   - 理由：现有 seed/import 管线已经围绕 markdown 文件工作；新增文件能被 worker seed 和 web import wizard 自动发现，部署风险最低。

2. **新增 `fundamental` 与 `process` 两个 category。**
   - 选择：扩展 `apps/web/lib/skills-ui.ts` 的 `SKILL_CATEGORIES` 与 `CATEGORY_LABELS`。
   - 替代：全部放入 `other`，或只新增 `fundamental`。
   - 理由：8 个 skill 中多数是基本面复核，`thesis-tracker` 与 `portfolio-review` 更像流程纪律；拆分后 `/skills` 和 `/skills/import` 的分组更清晰。

3. **改写保留方法论骨架，但删除外部执行流程。**
   - 选择：保留指标表、评分表、硬性否决、决策树、豁免规则；删除 `$ARGUMENTS`、`Task`、`python3`、并行 Agent 和 reports 路径。
   - 替代：原文照搬，或完全重写。
   - 理由：原文是 slash-command 研究工作流，不适合直接注入 trader 的 monitoring prompt；但方法论本身有复用价值，应尽量保留。

4. **新增 seed 文件验证测试。**
   - 选择：在 `packages/db/src/seed-skills.test.ts` 扫描 `packages/db/seed/skills/*.md`。
   - 替代：只依赖 web import 测试或手工验收。
   - 理由：seed 文件是纯文本，最容易出现 frontmatter 拼写、category 漏同步、body 超长等问题；扫描测试成本低且能覆盖所有现有/新增文件。

5. **不从 db package 引入 web 常量。**
   - 选择：测试内联 allowed categories 和 `BODY_MAX = 6000`。
   - 替代：让 `@trader/db` import `apps/web/lib/skills-ui.ts`。
   - 理由：db package 不应依赖 web app 文件；少量常量重复可接受，运行时还有 `validateSkillCategory` 兜底。

## Risks / Trade-offs

- 改写压缩导致方法论失真 -> 每个 skill 改写时优先保留表格、评分、硬性否决和豁免规则，只压缩案例和说明段。
- 新 category 与测试常量 drift -> seed 文件测试覆盖新增 category；web skills 测试覆盖运行时分类校验。
- `npm run build -w apps/web` 可能暴露既有无关类型错误 -> 记录失败位置，区分本变更引入的问题和既有问题；本变更至少需要 `npm run test -w apps/web -- skills` 与 seed 测试通过。
- 新 seed skill 导入后 LLM 未必有充分财务数据 -> skill 文本应要求基于现有数据给出信息不足提示，不强迫臆测。

## Migration Plan

1. 扩展 category 常量和 label。
2. 添加 seed 文件扫描测试，并先确认现有 5 个 seed 通过。
3. 逐个改写并新增 8 个 seed markdown，每新增一个运行 seed 测试。
4. 最终运行 db seed 测试、web skills 测试和 web build。
5. 在已有运行环境中访问 `/skills/import`，验证 13 个 seed skill 可见，新 category 标签显示正确。

Rollback strategy: 删除新增 8 个 markdown 文件、移除 `fundamental`/`process` category、删除 seed 文件测试即可回退；无数据库 migration 或持久数据迁移。

## Open Questions

- `npm run build -w apps/web` 当前可能受既有 `position-service.ts` 类型错误阻塞；该错误是否在本变更中顺手修复，还是作为独立变更处理，需要实施时确认。
