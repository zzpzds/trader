## ADDED Requirements

### Requirement: Memory CRUD with optional entity binding
用户 SHALL 能够创建、读取、修改、删除"笔记"（memories）。每条笔记包含 `title`、`content`、`kind`（`note` / `idea` / `lesson` / `context`）、可选 `strategyId`（外键到 strategies，删除时置 NULL）、可选 `symbol`（自由文本，不做外键）、`tags`（字符串数组）、`pinned`（布尔，默认 false）、`createdAt`、`updatedAt`。

#### Scenario: Create memory with required fields only
- **WHEN** 用户向 `POST /api/memories` 提交 `{ title, content }`
- **THEN** 系统创建 memory，`kind` 默认 `note`，`strategyId`/`symbol` 为 null，`tags` 为 []，`pinned` 为 false；返回 `201` 与完整记录

#### Scenario: Reject create with missing title or content
- **WHEN** 用户提交 `POST /api/memories` 缺少 `title` 或 `content`
- **THEN** 系统返回 `400 { error }`，不创建记录

#### Scenario: Reject invalid kind
- **WHEN** 用户提交 `POST /api/memories` 或 `PATCH /api/memories/:id` 带 `kind` 不在 4 类枚举内
- **THEN** 系统返回 `400 { error: "invalid kind" }`

#### Scenario: Update partial fields
- **WHEN** 用户向 `PATCH /api/memories/:id` 提交任意字段子集（title / content / kind / strategyId / symbol / tags / pinned）
- **THEN** 系统只更新提供的字段，`updatedAt` 重置为当前时间，未提供的字段不变

#### Scenario: Delete memory
- **WHEN** 用户调用 `DELETE /api/memories/:id` 且记录存在
- **THEN** 系统删除该记录并返回 `204`

#### Scenario: Return 404 for missing id
- **WHEN** 用户对不存在的 id 调用 `GET` / `PATCH` / `DELETE /api/memories/:id`
- **THEN** 系统返回 `404 { error: "Not found" }`

#### Scenario: Strategy deletion preserves memories
- **WHEN** 关联的 strategy 被删除
- **THEN** 所有引用该 strategyId 的 memory 行的 `strategy_id` 字段被置为 NULL（`ON DELETE SET NULL`），笔记本身保留

### Requirement: Full-text memory search with CJK-friendly trigram + LIKE fallback
系统 SHALL 提供基于 PostgreSQL `pg_trgm` 扩展的全文搜索，支持中英文。当查询字符串长度 < 2 时退化到 `ILIKE` 模糊匹配；长度 >= 2 时走 trigram 相似度，阈值 0.1。

#### Scenario: Trigram search returns ordered results
- **WHEN** 用户调用 `GET /api/memories?q=NVDA`（q 长度 >= 2）
- **THEN** 系统执行 `WHERE similarity(title, q) > 0.1 OR similarity(content, q) > 0.1`，按 `GREATEST(...)` 降序、`updated_at` 降序返回

#### Scenario: Short-query LIKE fallback
- **WHEN** 用户调用 `GET /api/memories?q=a`（q 长度 < 2）
- **THEN** 系统使用 `WHERE title ILIKE '%a%' OR content ILIKE '%a%'`，按默认排序（pinned DESC, updated_at DESC）返回

#### Scenario: Filters compose with AND
- **WHEN** 用户调用 `GET /api/memories?strategyId=s1&kind=idea&pinned=true`
- **THEN** 系统返回同时满足三个条件的记录

#### Scenario: Default ordering when no q
- **WHEN** 用户调用 `GET /api/memories`（无 q）
- **THEN** 系统按 `pinned DESC, updated_at DESC` 排序返回

#### Scenario: Limit clamping
- **WHEN** 用户调用 `GET /api/memories?limit=200` 或 `?limit=0`
- **THEN** 系统将 limit 截断到 [1, 100] 区间，无 limit 时默认 20

### Requirement: Required PostgreSQL pg_trgm extension and GIN indexes
系统部署时 SHALL 启用 `pg_trgm` 扩展并在 `memories.title` 与 `memories.content` 上创建 GIN trigram 索引。该步骤通过 `npm run db:migrate`（=`db:push && db:setup-extensions`）或 docker-compose `db-migrate` profile 自动完成。

#### Scenario: Bootstrap script creates extension and indexes idempotently
- **WHEN** 操作员运行 `npm run db:migrate`
- **THEN** 脚本顺序执行 `drizzle-kit push`（建/同步表）与 `ensure-pg-extensions.ts`（CREATE EXTENSION IF NOT EXISTS pg_trgm + CREATE INDEX IF NOT EXISTS … gin_trgm_ops）；重复执行不报错

#### Scenario: Docker db-migrate target chains both steps
- **WHEN** 运行 `docker compose --profile tools run --rm db-migrate`
- **THEN** 容器执行 `npx drizzle-kit push && npx tsx scripts/ensure-pg-extensions.ts`

### Requirement: Memory pre-loading into monitoring LLM prompt
monitoring 流程 SHALL 在调用 LLM 之前按当前策略与持仓标的从 `memories` 表加载 Top-N 笔记并注入 prompt，用户作为唯一写入主体，LLM 仅读不写。

#### Scenario: Three-bucket union before merge
- **WHEN** monitoring 处理某策略且其持仓标的为 [A, B, C]
- **THEN** 系统执行三类查询并 union 去重（按 id）：
  - pinned 全集：`pinned = true AND (strategy_id = ? OR strategy_id IS NULL)` 全部
  - 该策略最近 30 天笔记：`strategy_id = ?` Top 5（按 updated_at 降序）
  - 该策略涉及标的最近 30 天笔记：`symbol IN (A, B, C)` Top 5

#### Scenario: Prompt budget capping
- **WHEN** union 后的笔记总数 > 8 或单条内容 > 200 字符或总字符 > 4000
- **THEN** 系统按 `pinned DESC, updated_at DESC` 排序后取前 N 条，使总数 ≤ 8、每条 contentPreview ≤ 200 字符、累计字符 ≤ 4000

#### Scenario: Prompt formatting
- **WHEN** 加载到至少 1 条相关笔记
- **THEN** prompt 在"## 策略：…"上方插入"## 你之前留下的相关笔记"段，每条格式为 `- [<flags>] <title>：<contentPreview>`，其中 flags 由 pinned/kind/symbol 拼接

#### Scenario: Empty memories means no section
- **WHEN** 加载结果为空数组
- **THEN** prompt 中不出现"你之前留下的相关笔记"段，其它内容不变

#### Scenario: Loader failure is non-fatal
- **WHEN** `loadRelevantMemories` 抛出异常（DB 故障等）
- **THEN** 系统记录 warn 日志、向 `analyze` 传空数组，monitoring 主流程继续，不让笔记问题阻断核心监控

### Requirement: Memory pages and navigation
Web 界面 SHALL 提供独立的 `/memory` 页面与策略详情页内的"笔记" tab，并在全局导航（sidebar 与 mobile-nav）中加入入口。

#### Scenario: /memory page lists all memories with search
- **WHEN** 用户访问 `/memory`
- **THEN** 系统展示笔记列表（卡片视图，含 title、kind 徽章、strategy/symbol 标签、updatedAt、pinned 图标），顶部含搜索框（debounced 300ms）、kind 筛选、strategy 筛选、"新建笔记"按钮

#### Scenario: Empty state guidance
- **WHEN** `/memory` 页加载后列表为空
- **THEN** 显示"还没有笔记，monitoring 时不会注入任何上下文。"

#### Scenario: Strategy detail notes tab pre-binds strategy
- **WHEN** 用户在 `/strategies/:id` 页打开"笔记" tab 并点"新建笔记"
- **THEN** 表单 `strategyId` 字段预设为该策略 id，提交后笔记自动绑定

#### Scenario: Edit/delete via dialog
- **WHEN** 用户点击列表中任意笔记卡片
- **THEN** 弹出编辑模态框（自定义 fixed overlay），可修改所有字段、可删除（带确认）、可置顶
