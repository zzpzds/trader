## Why

`apps/worker/src/monitoring/analyze.ts` 现在每天用一个写死的 prompt 给所有策略做监控分析，没有可复用的方法论组件——用户想给某个策略额外灌入"K 线形态判定"或"参考价管理"这类领域知识时，只能改硬编码 prompt。我们需要一个独立的、可在 Web 端编辑的"技能库"，让策略可以按需挂载方法论文档来增强 LLM 分析效果。这是后续给策略生成、新闻摘要等模块复用同一套能力的基础。

## What Changes

- 新增 `skills` 表（`name`/`description`/`category`/`body_md`/`source`）和 `strategy_skills` N:M 关联表
- 新增 `monitoring_runs.skill_snapshot` jsonb 列，落库当次分析使用的 skill 内容快照（用于事后复盘）
- 新增 `/api/skills` 全套 CRUD 接口和 `/api/strategies/[id]/skills` 关联接口
- 新增 `/skills` Web 页面（列表 + markdown 编辑器 + 实时预览）
- 策略详情页 `/strategies/[id]` 增加「关联技能」区域，单个策略最多挂 3 个 skill
- `analyze.ts` 在 prompt 顶部按用户配置注入 skill body
- 首次部署时 idempotent seed 5–10 个翻译/精简过的中文 skill（参考 vibe-trading MIT 项目重写，attribution 写入 `NOTICE`）
- skill body 写入校验 ≤ 6000 字符

## Capabilities

### New Capabilities
- `skills-library`: 独立的技能 markdown 知识库，提供 CRUD 接口、N:M 关联到策略、并向 monitoring 等下游消费方提供注入能力

### Modified Capabilities
- `daily-monitoring`: 监控分析在 prompt 中注入策略关联的 skill body，并把 skill 快照写入 `monitoring_runs`

## Impact

- **Code**：
  - `packages/db/src/schema.ts`、`packages/db/drizzle/*` — schema + migration
  - `apps/web/app/skills/*`、`apps/web/app/api/skills/*` — 新页面 + API
  - `apps/web/app/strategies/[id]/*` — 关联 UI
  - `apps/worker/src/monitoring/analyze.ts`、`job.ts` — 注入 skill + 写入 snapshot
  - `apps/web/seed/skills/*.md` — 中文 seed 内容
  - 启动时执行 seed 脚本（idempotent，只 upsert 不存在的 seed）
- **API**：新增 5 条路由；`/api/strategies/*` 响应中含关联的 skill ids
- **依赖**：无新增 npm 包（复用现有 `react-markdown`、Drizzle、Anthropic SDK）
- **License**：根目录新增 `NOTICE` 文件，声明 skill 内容参考自 MIT 许可的 vibe-trading 项目
- **不在范围**：LLM 自动选择 skill、seed 同步升级、parse-strategy/news 集成、渐进披露 load_skill 工具
