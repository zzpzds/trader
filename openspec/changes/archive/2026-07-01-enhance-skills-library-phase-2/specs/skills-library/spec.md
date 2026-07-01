## ADDED Requirements

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
