# ai-berkshire 移植 · 子项目 A：Skills 种子库扩充 — Design

> 把 ai-berkshire 的 8 个投研 Skill 适配为 trader 内置 seed skill，扩大 `/skills/import` 向导可选项。
> 灵感源自 `~/code/ai-berkshire/skills/*.md`（四大师价值投资框架），改写为 trader 「针对单个策略/持仓注入 LLM prompt 的方法论卡片」形态。

## 背景与动机

trader 当前 `packages/db/seed/skills/` 仅 5 个 seed skill（behavioral-finance / candlestick / reference-price-management / risk-checklist / valuation-basic），都偏向「短期 + 风险/形态」。缺少基本面、流程纪律、组合管理类方法论。

ai-berkshire 是一套实盘验证的中文投研框架（2024 +69.29% / 2025 +66.38%），其 skill 以 markdown 文件存储，与 trader 的 skill 格式天然兼容。把其中可用于「日常监控分析」场景的方法论纳入 seed，能让用户挂载到 strategy 后直接生效。

### 决策日志

| 决策点 | 选择 | 替代方案 | 理由 |
|---|---|---|---|
| 选取范围 | 全部 8 个候选 skill | 仅核心 3 个 | 用户希望一次到位；都是低成本纯文本文件 |
| Category | 新增 `fundamental` + `process` | 全塞 `other` / 仅新增 `fundamental` | 8 个 skill 大半属基本面，少部分属流程纪律，两个新 category 语义最清晰 |
| 改写深度 | 适度适配 | 原文保留 / 完全重写 | 保留方法论骨架，删除 slash-command 痕迹（`$ARGUMENTS`、并行 Agent、Python 工具调用），重塑上下文为「当前持仓/策略已知」|
| 字符上限 | 全部 ≤ 6000（`SKILL_BODY_MAX`） | 突破上限 | 现有约束，前端表单和 LLM context 都按此设计 |
| 命名 | kebab-case 与原 skill 同名 | 中文文件名 / 重命名 | 与现有 5 个 seed 一致 |

## 范围

### 在范围内

- `packages/db/seed/skills/` 新增 8 个 md 文件，含完整 frontmatter
- `apps/web/lib/skills-ui.ts`：`SKILL_CATEGORIES` 数组加 `fundamental`、`process`；`CATEGORY_LABELS` 加「基本面」「流程纪律」
- 每个新 skill 按统一格式改写（见下文「skill 改写规范」）
- 单元测试：`skills-ui.ts` 类型扩展不破坏现有测试；新增一个 seed-loader 集成测试，确认 8 个新文件能被 `getSeedManifest` 解析通过
- 在每个新 skill md 文件顶部署明「source: ai-berkshire / 改写自原 skill X，方法论保留，工具调用已剥离」

### 不在范围内（YAGNI）

- 改 `apps/worker/src/monitoring/analyze.ts`（属子项目 B/C）
- 改 strategy ↔ skill 数据结构（无需）
- 把 `investment-team` / `earnings-team` / `industry-funnel` / `bottleneck-hunter` / `deep-company-series` / `private-company-research` / `wechat-article` / `industry-research` 这类「多 Agent 长报告 workflow」纳入（与 trader 注入式 prompt 上下文不匹配）
- 同步机制：未来 ai-berkshire skill 更新时如何自动同步（手动复审即可）
- 英文版

## 8 个 skill 的清单与改写要点

| 文件名 | category | 原 skill 一句话 | 改写要点 |
|---|---|---|---|
| `quality-screen.md` | fundamental | 7 条去劣指标 + 3 条豁免规则 | 删 `$ARGUMENTS`；上下文改为「请用 7 条指标检视当前持仓 / 候选标的」；保留指标表 + 豁免规则原文 |
| `investment-checklist.md` | fundamental | 巴菲特六关 buy checklist | 删并行 Agent 调度；改为「buy 信号触发时请按六关逐项打分」；保留六关骨架，每关压缩至 ≤ 400 字 |
| `thesis-tracker.md` | process | 买入后的 thesis 验伪纪律 | 改为「请基于本次持仓的 thesis 字段（如有），检视当前数据是否仍支持原 thesis」 |
| `portfolio-review.md` | process | 组合视角分析框架 | 改为「请基于全部持仓，给出集中度 / 质量 / 价位 三维度评估」|
| `earnings-review.md` | fundamental | 财报精读框架 | 改为「若策略含财报触发规则或近 30 天有财报，按此框架精读」|
| `news-pulse.md` | fundamental | 新闻脉搏分析 | 与 trader 现有 news 模块对接：「请基于新闻摘要识别对当前持仓的实际影响（不是泛泛点评）」|
| `management-deep-dive.md` | fundamental | 管理层纵深研究 | 改为「请基于公开记录评估管理层资本配置、持股、关键决策」|
| `dyp-ask.md` | behavioral | 段永平问答风格 | 改为「请用段永平风格反问：本生意 10 年后还在吗？管理层是不是在乎股东？……」保留原 8-12 个核心反问 |

每个文件的统一头部模板：

```markdown
---
name: <kebab-case-name>
description: <一句话描述，用作 `availableSkills` catalog 里的 hint，必须以「请…」「在…时…」开头>
category: fundamental | process | behavioral
---

# <中文标题>

> 改写自 ai-berkshire/skills/<name>.md（原作者实盘验证 2024-2025），保留方法论骨架，去除 slash command / 工具调用，适配为 trader 持仓监控上下文。

## 一、何时使用本方法论

<触发条件，1-2 段>

## 二、核心步骤

<指标表 / 评分标准 / 决策树 / 豁免规则>

## 三、输出格式建议（给 LLM）

<3-5 行 markdown 模板>
```

## skill 改写规范

每个新 skill 必须满足：

1. **去 slash-command 化**：不出现 `$ARGUMENTS`、`Task` 工具、`Agent` 并行、`python3` 调用
2. **上下文重塑**：原 skill 假设「从零研究一家公司」；改写为「当前策略/持仓/价格已知，请用此方法检视」
3. **6000 字符硬上限**：超出则压缩示例和案例段落，方法论本身（表格、规则）必须完整保留
4. **frontmatter 三字段齐全**：name、description、category 必填（与 `parseFrontmatter` 兼容）
5. **类别归属准确**：fundamental 用于基本面方法论，process 用于流程/纪律，behavioral 仅 dyp-ask（段永平问答属于反思性反问）

## 测试策略

1. **类型测试**：`SKILL_CATEGORIES` 扩充后，`SkillCategory` 类型 union 自动包含两个新值；现有 lib/skills 测试不破
2. **种子加载测试**：新增 `packages/db/seed-helpers.test.ts`（如不存在）或扩展现有测试，断言新增 8 个 md 全部能被 `parseFrontmatter` 解析、name/description/category 三字段齐全、category 在合法集合内
3. **UI 测试**：`apps/web/app/skills/__tests__/` 已有 import-page 测试，加一个 case 验证 fundamental / process 在 category filter 里出现
4. **手动验收**：本地 `npm run dev` 后访问 `/skills/import`，确认 8 个新 skill 显示，每个能预览正文 + 一键导入

## 风险与开放问题

| 风险 | 影响 | 应对 |
|---|---|---|
| 改写压缩后方法论失真 | 中 | 每个 skill 改写完成后通读，与原 ai-berkshire 文件对比，关键表格/规则未丢即可 |
| Category 新增破坏现有 user skill | 低 | category 在 db 里是 free text，新增枚举值不影响已有数据 |
| 用户挂载 fundamental 类 skill 后 LLM 无数据可用 | 中 | 由子项目 C（财务校验器）解决；本子项目先把 skill 备好，分析质量提升留给 C |
| 中文标点与 markdown 兼容性 | 低 | 现有 5 个 seed 都是中文，已验证 |

## 验收标准

- [ ] `packages/db/seed/skills/` 下新增 8 个 md 文件，frontmatter 全部解析通过
- [ ] `npm run build -w packages/db` 通过
- [ ] `npm run test -w apps/web` 通过
- [ ] `/skills/import` 向导显示新增 8 个 skill，category 标签正确
- [ ] 把 quality-screen 挂到任一 strategy，触发一次 monitoring 后能在 prompt 中看到正文（worker 日志可见或 monitoring_run.analysis 引用其内容）
