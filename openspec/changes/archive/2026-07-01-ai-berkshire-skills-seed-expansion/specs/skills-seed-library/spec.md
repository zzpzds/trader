## ADDED Requirements

### Requirement: Skill categories include fundamental and process
系统 SHALL 在技能分类常量中支持 `fundamental` 与 `process` 两个分类，并分别显示为「基本面」与「流程纪律」。

#### Scenario: Category constants expose new categories
- **WHEN** 代码读取 `SKILL_CATEGORIES`
- **THEN** 数组包含 `fundamental` 与 `process`
- **AND** `other` 仍位于数组末尾作为兜底分类

#### Scenario: Category labels render in Chinese
- **WHEN** UI 调用 `categoryLabel("fundamental")` 或读取 `CATEGORY_LABELS.fundamental`
- **THEN** 返回「基本面」
- **AND** 当 UI 调用 `categoryLabel("process")` 或读取 `CATEGORY_LABELS.process`
- **THEN** 返回「流程纪律」

### Requirement: Seed skill files are structurally valid
系统 SHALL 校验 `packages/db/seed/skills/*.md` 中所有 seed skill 文件都具备可解析 frontmatter、唯一 name、合法 category 和不超过 6000 字符的正文。

#### Scenario: Parse every seed skill file
- **WHEN** 运行 seed skill 文件测试
- **THEN** 测试扫描 `packages/db/seed/skills/*.md`
- **AND** 每个文件都能通过 `parseFrontmatter` 解析

#### Scenario: Seed skill metadata is valid
- **WHEN** 测试解析任意 seed skill 文件
- **THEN** `name` 等于文件名去掉 `.md` 后的 stem
- **AND** `description` 非空
- **AND** `category` 属于 `pattern | risk | valuation | behavioral | macro | fundamental | process | other`

#### Scenario: Seed skill body respects length cap
- **WHEN** 测试解析任意 seed skill 文件
- **THEN** `bodyMd.length` 小于或等于 6000

#### Scenario: Seed skill names are globally unique
- **WHEN** 测试收集所有 seed skill 的 `name`
- **THEN** 去重后的 name 数量等于文件数量

### Requirement: Ai-berkshire seed skills are available for import
系统 SHALL 在仓库 seed 目录中提供 8 个从 ai-berkshire 改写的 seed skill，并能通过现有 seed manifest/import 管线被 `/skills/import` 自动发现。

#### Scenario: Seed directory contains adapted skills
- **WHEN** 系统扫描 `packages/db/seed/skills/`
- **THEN** 至少存在以下 8 个文件：`quality-screen.md`、`investment-checklist.md`、`thesis-tracker.md`、`portfolio-review.md`、`earnings-review.md`、`news-pulse.md`、`management-deep-dive.md`、`dyp-ask.md`

#### Scenario: Adapted skills expose expected categories
- **WHEN** 系统解析新增的 8 个 seed skill
- **THEN** `quality-screen`、`investment-checklist`、`earnings-review`、`news-pulse`、`management-deep-dive` 的 category 为 `fundamental`
- **AND** `thesis-tracker`、`portfolio-review` 的 category 为 `process`
- **AND** `dyp-ask` 的 category 为 `behavioral`

#### Scenario: Import wizard discovers new seeds
- **WHEN** 用户访问 `/skills/import`
- **THEN** 页面通过现有 manifest 接口列出新增 seed skill 的 name、description、category 和状态
- **AND** 未导入过的新增 seed skill 状态显示为缺失或可导入

### Requirement: Adapted skill bodies are trader-monitoring oriented
系统 SHALL 将 ai-berkshire 原 skill 改写为 trader 持仓监控上下文，保留方法论骨架并移除外部执行工作流指令。

#### Scenario: Adapted skill includes source note
- **WHEN** 用户查看任意新增 seed skill 正文
- **THEN** 正文顶部包含改写自 `ai-berkshire/skills/<name>.md` 的说明
- **AND** 说明表明已去除 slash command 与外部工具调用并适配 trader 持仓监控上下文

#### Scenario: Adapted skill excludes slash command workflow
- **WHEN** 测试或人工审查任意新增 seed skill 正文
- **THEN** 正文不包含 `$ARGUMENTS`
- **AND** 正文不要求调用 `Task` 工具或并行 Agent
- **AND** 正文不要求运行 `python3 ~/ai-berkshire/...`
- **AND** 正文不要求把结果写入 `reports/` 文件路径

#### Scenario: Adapted skill frames current strategy context
- **WHEN** 用户将新增 seed skill 关联到某个 strategy 并触发监控分析
- **THEN** skill 正文指导 LLM 基于当前 strategy、position、news 或用户笔记进行检视
- **AND** skill 正文不要求用户重新输入公司名作为 slash command 参数

### Requirement: Adapted skills preserve required methodology skeletons
系统 SHALL 在 8 个新增 seed skill 中保留对应 ai-berkshire 方法论的关键规则、评分表或决策树。

#### Scenario: Quality screen preserves hard rules
- **WHEN** 用户查看 `quality-screen`
- **THEN** 正文包含 7 条去劣指标表
- **AND** 正文包含 3 条豁免规则

#### Scenario: Investment checklist preserves six gates
- **WHEN** 用户查看 `investment-checklist`
- **THEN** 正文包含能力圈、经济特征、护城河、管理层、估值、风险六关
- **AND** 每关包含评分标准和硬性否决规则

#### Scenario: Process skills preserve decision discipline
- **WHEN** 用户查看 `thesis-tracker` 或 `portfolio-review`
- **THEN** `thesis-tracker` 包含「仍成立 / 部分动摇 / 已破产」三态和 thesis 破产即清仓的规则
- **AND** `portfolio-review` 包含集中度阈值、质量分层和估值分层框架

#### Scenario: Fundamental review skills preserve review frameworks
- **WHEN** 用户查看 `earnings-review`、`news-pulse` 或 `management-deep-dive`
- **THEN** `earnings-review` 区分一手资料与二手解读，并包含增长质量、现金流、资产负债表和管理层 commentary 红旗
- **AND** `news-pulse` 包含新闻三类分级和噪音识别规则
- **AND** `management-deep-dive` 包含履历、持股、资本配置、关键决策四维评分和管理层红旗清单

#### Scenario: Behavioral review skill preserves probing questions
- **WHEN** 用户查看 `dyp-ask`
- **THEN** 正文包含 8 到 12 个段永平式核心反问
- **AND** 每个反问包含通过或不通过的判定标准
