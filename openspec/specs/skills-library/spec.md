# skills-library Specification

## Purpose
TBD - created by archiving change add-skills-library. Update Purpose after archive.
## Requirements
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

### Requirement: Seed manifest 查询
系统 SHALL 提供 `GET /api/skills/seed/manifest` 接口，返回仓库中所有 seed markdown 文件的状态。

#### Scenario: 列出 seed 状态
- **WHEN** 客户端 GET `/api/skills/seed/manifest`
- **THEN** 系统读取 `packages/db/seed/skills/*.md`，对每条 seed 解析 frontmatter，计算 body sha256 hash，并对照数据库返回 `Array<{ name, description, category, currentBodyHash, status: 'missing' | 'in-sync' | 'edited' }>`

#### Scenario: status 判定逻辑
- **WHEN** 计算某条 seed 的 status
- **THEN**
  - 数据库中无同名 skill → `missing`
  - 数据库中有同名且 sha256(db.body_md) 与 currentBodyHash 一致 → `in-sync`
  - 数据库中有同名且 hash 不同 → `edited`

#### Scenario: Seed 目录不可读时降级
- **WHEN** seed 目录不存在或读取失败
- **THEN** 接口返回 500 with `{ error: "seed manifest unavailable" }`，不影响其他 API

---

### Requirement: Seed 单条导入
系统 SHALL 提供 `POST /api/skills/seed/import` 接口，支持手动导入单条 seed skill。

#### Scenario: 创建缺失的 seed
- **WHEN** 客户端 POST `{ name: "candlestick", mode: "create" }` 且该 seed 状态为 `missing`
- **THEN** 系统读取仓库 markdown，写入 `skills` 表，`source = "seed"`，返回 201 with 新 skill row

#### Scenario: 覆盖未编辑过的 seed
- **WHEN** 客户端 POST `{ name, mode: "overwrite-seed" }` 且该 seed 状态为 `in-sync`（用户未编辑过，但仓库 markdown 已升级则状态会变为不一致）
- **THEN** 系统更新 DB 中该 skill 的 `body_md`、`description`、`category`，保持 `source = "seed"`，返回 200

#### Scenario: 拒绝覆盖用户编辑过的 seed
- **WHEN** 客户端 POST `{ name, mode: "overwrite-seed" }` 且 seed 状态为 `edited`
- **THEN** 系统返回 409 Conflict with `{ error: "skill has been edited; use mode='duplicate' to import as a copy" }`

#### Scenario: 副本导入
- **WHEN** 客户端 POST `{ name, mode: "duplicate" }`
- **THEN** 系统找一个不冲突的新名（如 `<name>-vibe-trading`，若已存在则追加 `-2`、`-3` 直至找到可用 name），写入新 skill 行 `source = "seed"`，返回 201 with 新 skill row（含实际使用的 name）

#### Scenario: 启动 seed 行为不变
- **WHEN** worker 启动执行幂等 seed
- **THEN** 行为同 Phase 1：仅对 `missing` 状态的 seed 执行 create，对 `in-sync` 和 `edited` 一律跳过；不调用本接口

---

### Requirement: Seed 导入向导页面
系统 SHALL 在 `/skills/import` 路由提供 seed 导入向导。

#### Scenario: 列出所有 seed 及状态
- **WHEN** 用户访问 `/skills/import`
- **THEN** 页面调用 `/api/skills/seed/manifest`，对每条 seed 显示 name、description、category、状态徽章（未导入 / 已最新 / 已修改）

#### Scenario: 状态对应操作按钮
- **WHEN** 用户查看每条 seed
- **THEN** 按状态显示对应按钮
  - `missing` → 「导入」按钮，调用 `POST /api/skills/seed/import { mode: "create" }`
  - `in-sync` 但仓库 hash 升级（即 currentBodyHash ≠ DB hash 但 source=seed） → 「同步更新」按钮，调用 mode `overwrite-seed`
  - `edited` → 「另存为副本」按钮，调用 mode `duplicate`
  - `in-sync` 且 hash 一致 → 灰显「已最新」无操作

#### Scenario: 操作成功反馈
- **WHEN** 用户成功执行任一操作
- **THEN** 该条状态实时刷新，显示新状态并 toast/inline 提示成功

#### Scenario: 操作失败反馈
- **WHEN** 操作返回非 2xx
- **THEN** 该条显示红色错误消息，包含服务器返回的 error 字段

---

### Requirement: 推荐采纳 UI
系统 SHALL 在策略详情页「技能」tab 顶部，根据最新 monitoring_run 的 `suggested_skills` 显示推荐 banner，允许用户一键采纳。

#### Scenario: 显示推荐
- **WHEN** 用户访问某策略详情页「技能」tab，且最新 monitoring_run 的 `suggested_skills` 包含至少一项当前未关联的 skill name
- **THEN** SkillsPanel 顶部显示 banner，列出过滤后剩余的推荐 name（最多展示 3 个），并显示 「全部采纳」「挑选」「关闭」三个按钮

#### Scenario: 全部采纳
- **WHEN** 用户点击「全部采纳」
- **THEN** 系统将推荐合并进当前关联列表，受 STRATEGY_SKILLS_MAX (3) 限制（合并后超过 3 时优先保留已关联，按推荐顺序追加直到达 3 个），调用 `PUT /api/strategies/[id]/skills`

#### Scenario: 挑选
- **WHEN** 用户点击「挑选」
- **THEN** 进入编辑模式，预先勾选当前关联 + 全部推荐项（同样受 ≤ 3 限制；若超出，预先按推荐顺序勾选直至 3 个）

#### Scenario: 关闭
- **WHEN** 用户点击「关闭」
- **THEN** banner 在本次页面会话中消失；不持久化忽略状态；下次进入页面或下次 monitoring 完成后重新出现

#### Scenario: 推荐为空时不显示
- **WHEN** 最新 monitoring_run 的 `suggested_skills` 为空，或所有推荐项已经在当前关联中
- **THEN** banner 不渲染

#### Scenario: 推荐 name 在 skill 库中已不存在时优雅过滤
- **WHEN** LLM 推荐了一个 skill name 但 DB 中已无该 skill（用户期间删除了）
- **THEN** UI 在过滤时丢弃这些 name，不展示，不报错

---

### Requirement: 推荐查询接口
系统 SHALL 在 `GET /api/strategies/[id]/skills` 响应中，新增 `latestSuggestedSkills: string[]` 字段，包含最新 completed monitoring_run 的 `suggested_skills`（按写入顺序）。

#### Scenario: 有 monitoring_run 时返回 suggested_skills
- **WHEN** 客户端 GET `/api/strategies/[id]/skills`，且该策略最新 status='completed' 的 monitoring_run 存在 `suggested_skills` 数据
- **THEN** 响应 `{ skillIds: [...], latestSuggestedSkills: [...] }`

#### Scenario: 无 monitoring_run 或字段为空
- **WHEN** 该策略无 completed monitoring_run，或最新 run 的 suggested_skills 为 null/空数组
- **THEN** 响应 `{ skillIds: [...], latestSuggestedSkills: [] }`

