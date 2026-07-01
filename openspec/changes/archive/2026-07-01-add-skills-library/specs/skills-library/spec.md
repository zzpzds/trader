## ADDED Requirements

### Requirement: Skill 数据模型
系统 SHALL 提供独立的 `skills` 表存储可复用的 markdown 方法论文档，每条 skill 包含 `name`（slug，全局唯一）、`description`（一行简介）、`category`（分类）、`body_md`（markdown 正文）、`source`（`seed` 或 `user`）。

#### Scenario: Skill 创建带必填字段
- **WHEN** 用户通过 API 提交一条 skill，包含 `name`、`description`、`category`、`body_md`
- **THEN** 系统校验 `name` 全局唯一、`body_md` 长度 ≤ 6000 字符后写入数据库，`source` 默认置为 `user`，返回创建结果

#### Scenario: 拒绝重复 name
- **WHEN** 用户提交的 `name` 与已有 skill 重复
- **THEN** 系统返回 409 Conflict，不写入数据

#### Scenario: 拒绝超长 body
- **WHEN** 用户提交的 `body_md` 长度 > 6000 字符
- **THEN** 系统返回 400 Bad Request 并提示当前长度，不写入数据

---

### Requirement: Skill 与策略的 N:M 关联
系统 SHALL 提供 `strategy_skills` 关联表，允许一条 skill 被多个策略复用、一个策略最多关联 3 条 skill。

#### Scenario: 关联 skill 到策略
- **WHEN** 用户通过 API 把 skill IDs 列表赋给某策略
- **THEN** 系统校验列表长度 ≤ 3，将该策略原有关联整体替换为新列表

#### Scenario: 拒绝超过 3 条关联
- **WHEN** 用户提交的 skill IDs 列表长度 > 3
- **THEN** 系统返回 400 Bad Request，不修改关联

#### Scenario: Skill 删除时级联清理关联
- **WHEN** 用户删除某条 skill
- **THEN** 系统自动删除 `strategy_skills` 中所有引用该 skill 的关联行（数据库 ON DELETE CASCADE），不阻断删除

#### Scenario: 删除 skill 不影响历史 monitoring_runs 快照
- **WHEN** 一条曾被 monitoring 使用的 skill 被删除
- **THEN** 该 skill 的内容仍保留在历史 `monitoring_runs.skill_snapshot` 字段中，不丢失

---

### Requirement: Skill CRUD API
系统 SHALL 提供 `/api/skills` 与 `/api/skills/[id]` 的列表、新建、读取、更新、删除接口；以及 `/api/strategies/[id]/skills` 的关联整体替换接口。

#### Scenario: 列表 skill
- **WHEN** 客户端 GET `/api/skills`
- **THEN** 系统返回所有 skill 的 `id` / `name` / `description` / `category` / `source` / `updated_at`，按 `category` 升序、`name` 升序排列；不返回 `body_md` 以减少 payload

#### Scenario: 读取单条 skill 完整内容
- **WHEN** 客户端 GET `/api/skills/[id]`
- **THEN** 系统返回该 skill 的全部字段（包含 `body_md`）

#### Scenario: 更新 skill body
- **WHEN** 客户端 PATCH `/api/skills/[id]`，提交 `body_md` 字段
- **THEN** 系统校验长度 ≤ 6000 字符后更新；`source` 字段不可被修改

#### Scenario: 替换策略关联
- **WHEN** 客户端 PUT `/api/strategies/[id]/skills`，提交 `{ skillIds: [uuid, ...] }`
- **THEN** 系统校验长度 ≤ 3 后整体替换该策略的关联（先 DELETE 再 INSERT）

---

### Requirement: Skills 管理页面
系统 SHALL 在 `/skills` 路由提供 skill 列表与编辑界面。

#### Scenario: 列表按 category 分组
- **WHEN** 用户访问 `/skills`
- **THEN** 页面显示所有 skill，按 `category` 分组（默认枚举：`pattern` / `risk` / `valuation` / `behavioral` / `macro` / `other`），每条显示 `name`、`description`、`source` 标签

#### Scenario: 新建/编辑 skill
- **WHEN** 用户点击「新建 skill」或编辑已有 skill
- **THEN** 页面显示编辑器，包含 `name`（slug 输入）、`description`、`category`（下拉，包含 6 个预设值）、`body_md`（textarea + react-markdown 实时预览），底部显示当前 `body_md` 字符数和上限 6000

#### Scenario: 编辑共享 skill 提示
- **WHEN** 用户编辑一条已被 ≥ 1 个策略关联的 skill
- **THEN** 编辑页显示提示「该 skill 当前被 N 个策略关联，编辑会同时影响所有策略」

#### Scenario: 删除 skill 二次确认
- **WHEN** 用户点击删除 skill
- **THEN** 系统弹出二次确认，提示「该 skill 被 N 个策略关联」（如有），用户确认后执行删除

---

### Requirement: 策略详情页关联技能 UI
系统 SHALL 在 `/strategies/[id]` 页面提供「关联技能」区域，允许用户为该策略多选 skill。

#### Scenario: 显示当前关联
- **WHEN** 用户访问策略详情页
- **THEN** 页面显示当前关联的 skill chips（`name` + `category`），并显示数量上限提示「最多 3 个」

#### Scenario: 多选编辑
- **WHEN** 用户点击「编辑关联」
- **THEN** 页面显示可选 skill 列表（按 category 分组），用户可勾选/取消，已选数量达到 3 时禁用其余复选框

#### Scenario: 保存关联
- **WHEN** 用户提交编辑结果
- **THEN** 页面调用 `PUT /api/strategies/[id]/skills`，成功后刷新页面状态

---

### Requirement: 首次部署 idempotent seed
系统 SHALL 在 worker 进程启动时执行幂等 seed 流程，将仓库中预置的中文 skill markdown 写入数据库。

#### Scenario: 首次启动写入 seed
- **WHEN** worker 进程启动且数据库中不存在某 seed skill 的 `name`
- **THEN** 系统从 `apps/web/seed/skills/<slug>.md` 读取内容，按 `name` 写入 skills 表，`source = "seed"`

#### Scenario: 已存在的 skill 不覆盖
- **WHEN** worker 启动时发现某 seed `name` 已在数据库中（无论 `source` 是 `seed` 还是 `user`、无论用户是否编辑过）
- **THEN** 系统跳过该条，不更新

#### Scenario: Seed 失败不阻塞 worker 启动
- **WHEN** seed 流程任意一条失败（如 markdown 读取失败、字段校验失败）
- **THEN** 系统记录 error 日志，跳过该条继续处理其他 seed，worker 主流程不受影响

---

### Requirement: Seed 内容 attribution
系统 SHALL 在仓库根目录提供 `NOTICE` 文件，声明 seed skill 内容参考自 MIT 许可的 vibe-trading 项目并附链接。

#### Scenario: NOTICE 文件存在
- **WHEN** 用户查看仓库根目录
- **THEN** `NOTICE` 文件存在，包含 vibe-trading 项目名称、MIT 许可声明、原项目链接

---

### Requirement: Skill body 字符限制
系统 SHALL 限制单条 skill `body_md` 长度 ≤ 6000 字符；策略关联 skill 数量上限 ≤ 3 条。

#### Scenario: API 写入校验
- **WHEN** 任何创建或更新 skill 的 API 调用提交的 `body_md` > 6000 字符
- **THEN** 系统返回 400 Bad Request

#### Scenario: 关联校验
- **WHEN** 任何替换策略关联的 API 调用提交的 skill IDs 数量 > 3
- **THEN** 系统返回 400 Bad Request
