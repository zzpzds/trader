## Context

Phase 1 让用户可以在 web 上 CRUD skill、关联到策略、并在监控分析时被注入 prompt。运行了一段后，两个 UX gap 浮现：

1. **冷启动困难**：用户建好策略后不知道挂什么 skill。技能库列表在另一个页面，用户得切来切去判断哪个跟自己策略相关。
2. **Seed 内容更新无感**：开发者后续提交了更精炼的 candlestick.md 到仓库——但 Phase 1 启动 seed 仅 upsert 缺失的，已存在的永远不动。用户没机会看到改进。

Phase 2 的设计原则保持不变：(a) 不破坏 Phase 1 的稳定性 (b) 决策权在用户 (c) 不增加 LLM 调用次数 (d) 简单到可在一个 PR 内做完。

## Goals / Non-Goals

**Goals:**

- LLM 在分析时**顺手**推荐 0–3 个有用的 skill，不增加 LLM 调用次数
- 推荐持久化在 `monitoring_runs.suggested_skills`，可在策略详情页看到
- 用户一键采纳推荐 → 添加到关联（仍受 ≤ 3 上限）
- 提供 `/skills/import` 页面查看 seed 内容、按需手动导入
- 永不覆盖用户编辑过的 skill；用户已编辑时只允许「另存为副本」

**Non-Goals:**

- 自动 seed 升级（启动时改写已存在的 skill）
- LLM 自动选/挂 skill（决策仍在用户手上）
- 推荐的「已忽略」状态记录（不增加 UI/DB 复杂度；新 run 自然刷新推荐）
- Seed 版本号 / changelog / diff 视图
- 推荐质量打分 / A-B 测试

## Decisions

### LLM 推荐通过现有 tool 携带，零额外 LLM call

**决策：** 在 `analyze.ts` 现有 `report_analysis` tool schema 上多加 `suggested_skills: { type: "array", items: { type: "string" } }` 字段。同时在 prompt 中注入一份 catalog 简介：

```
## 可选技能目录
（如果你认为以下方法论中有任何一个对本次分析会有帮助但当前未被启用，请在 suggested_skills 中列出对应的 name；最多 3 条；如果都没必要，返回空数组）
- candlestick: K线形态识别...
- risk-checklist: 风险检查清单...
- ...
```

**为什么不单独加一次 LLM call：** 多一次 call = 多一次延迟 + 多一份 token 消耗 + 多一个失败点。让分析的 LLM 顺手推荐时，它已经读完了策略和持仓，判断更准。

**Trade-off：** 如果分析 LLM 输出 `has_action_items / referencePriceUpdates` 主任务时分心去想 suggestions，可能影响主任务质量。Mitigation：prompt 里把 suggestions 明确放在三段式之后、tool schema 上把它列在最末位、prompt 强调"可选，无必要返回 []"。

### 推荐对象 = 当前未关联的 skill 名

**决策：** prompt 里注入的 catalog 包含 ALL skills，不预先过滤掉已关联的。因为 LLM 已经在 prompt 中看到了"## 可用方法论"区块（已关联的 skill body），它知道哪些已挂；理论上不会再推荐已挂的。但为防御，UI 层渲染推荐时**过滤掉已关联的**。

**为什么 catalog 全量给 LLM：** 减少业务逻辑泄漏到 prompt 模板；让 LLM 自己判断「这个我已经在用了」。

### 推荐持久化在 monitoring_runs，不单独建表

**决策：** 加列 `monitoring_runs.suggested_skills jsonb` 存 LLM 返回的 `string[]`（skill name 列表，不存 id 因为 LLM 输出的就是 name）。

**为什么不单独建表：** 推荐随每次 run 刷新，没有跨 run 的关系（不需要"忽略状态"），也不需要历史趋势。挂在 monitoring_runs 上是最简单的存储位置。

**为什么存 name 不存 id：** LLM 不知道 id；让它输出 name 然后展示时按 name lookup 一下即可。如果 lookup 失败（用户删了某个 skill），UI 优雅降级——只展示能找到的。

### Seed 导入向导：UI 页面 + 单条 POST，不自动改写

**决策：**

- 仓库 seed markdown 仍在 `packages/db/seed/skills/*.md`
- 新增 `getSeedManifest()` 读取这些文件、计算每条的 `name` + `body_md hash`
- API `GET /api/skills/seed/manifest` 返回每条的 `{ name, description, category, currentBodyHash, status: 'missing' | 'in-sync' | 'edited' }`
  - status `missing`：DB 中无同名 skill
  - status `in-sync`：DB 中有 `source='seed'` 且 hash 一致
  - status `edited`：DB 中有同名 skill 但 hash 不同（无论 source）
- API `POST /api/skills/seed/import` 接受 `{ name, mode: 'create' | 'overwrite-seed' | 'duplicate' }`：
  - `create`：仅 missing 状态可用，写入新行
  - `overwrite-seed`：仅 in-sync 但仓库 hash 改变（即 seed 仓库版本升级了，用户未改过）可用，覆盖 body
  - `duplicate`：edited 状态可用，写入 `<name>-vibe-trading-<n>` 副本
- UI `/skills/import` 列出 manifest，每条按状态给对应按钮

**为什么不在 worker 启动时自动 overwrite-seed：** 即便用户没改过，自动改写他眼皮底下的 skill 仍然是「不告而取」。手动向导让用户掌控节奏。

**Hash 算法：** sha256，跟 `monitoring_runs.skill_snapshot` 用同一套，方便人脑对账。

### Seed manifest 读取路径在 web 进程中

**决策：** Web 端而不是 worker 端读取 seed 目录。Web 通过 `@trader/db/seed` 子路径或 `require.resolve("@trader/db/package.json")` + `path.join("seed", "skills")` 找到目录（同 Phase 1 worker 的方式）。

**为什么 web 而不是 worker：** 用户操作发生在 web。worker 端的 seed 函数（启动 idempotent 上传）不变。

### 推荐 banner 在 SkillsPanel 顶部

**决策：** 策略详情页 SkillsPanel 在 view mode 顶部新增 banner（仅当最新 monitoring_run 的 `suggested_skills` 非空且去掉已关联后仍非空）：

```
┌──────────────────────────────────────────────────────┐
│ 💡 系统建议挂上：candlestick · valuation-basic        │
│              [全部采纳] [挑选] [关闭]                 │
└──────────────────────────────────────────────────────┘
```

- 「全部采纳」：把推荐合并到当前关联（受 ≤ 3 上限；超出时按推荐顺序截取）
- 「挑选」：进入 edit mode，自动勾上推荐项
- 「关闭」：本会话内隐藏（不持久化）

**没有「永久忽略」按钮：** 不增加状态。用户下次跑 monitoring 自然看到新推荐。

## Risks / Trade-offs

- **Risk：LLM 主任务质量被分散** → Mitigation：把 suggestions 放在 tool schema 最末位 + prompt 末尾强调「无必要返回空数组」+ 监控 run 数据观察主指标 has_action_items 准确度有无变化。如果观察到回归，prompt 加强约束或回退此 feature。

- **Risk：catalog 简介注入让每次 prompt 多 ~250 字节 token** → Mitigation：可控（5–20 个 skill 量级）。token 成本可观察，必要时只注入「未关联」的 catalog。

- **Risk：Seed manifest 在 web 进程读取磁盘可能在某些部署环境出错（只读 fs / 边缘 runtime）** → Mitigation：用同一套 `require.resolve` + `node:fs/promises` 路径解析（Phase 1 worker 已验证可在 docker 内工作）；web 也是 node 运行时。如果失败，UI 优雅降级显示「无法读取 seed manifest」错误。

- **Risk：`overwrite-seed` 模式判断错（用户其实改过但 hash 碰巧一致）** → 几乎不可能（sha256），不 mitigate。

- **Trade-off：UI 推荐 banner 用「最新 monitoring_run 的 suggestions」** → 如果用户在两次 monitoring 之间多次访问页面，看到的都是同一份建议；不会因为打开页面而触发新的 LLM 调用。这是预期行为。

- **Trade-off：「关闭」banner 不持久化** → 简单。代价是切换页面再回来又看到。可接受，因为用户的最终行为是采纳或不采纳，不需要"暂时关闭"长期生效。

## Migration Plan

1. **Schema migration**：`packages/db/drizzle/<next>_add_suggested_skills.sql` 加 `monitoring_runs.suggested_skills jsonb nullable`。Drizzle 会跟着上次生成的 baseline 自动 diff。Nullable 默认 null 不破坏现存代码。
2. **代码部署顺序**：schema → analyze.ts/job.ts（持久化推荐但 UI 还没读）→ web seed manifest API → /skills/import 页面 → SkillsPanel 推荐 banner。每一步前一步能独立部署，互不阻塞。
3. **Rollback**：删列 + revert 代码。`monitoring_runs.suggested_skills` 数据丢失可接受。
4. **不需要 feature flag**：用户没操作 → 行为完全等同 Phase 1。

## Open Questions

- 暂无（所有关键决策已在 proposal 阶段定下）。
