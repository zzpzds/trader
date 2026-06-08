## Context

`apps/worker/src/monitoring/analyze.ts` 当前是一个固定 prompt 的 LLM 调用：策略内容 + 持仓 + 近期价格 + memory 笔记 → 三段式分析报告。所有方法论（如何判断 K 线形态、参考价更新规则、风险检查清单）只能写死在策略脚本里，跨策略无法复用。

调研了 vibe-trading 开源项目（MIT）的 finance skill library 设计：77 个 markdown skill 按 category 分组、渐进披露、`load_skill` tool 按需加载。它的核心模式是「每个 skill 是一份独立 markdown 知识件，消费方按需注入」——这部分思路可借鉴。但 vibe-trading 是通用 agent + 多 LLM tool 的研究平台，我们是单人记账定时任务，77 个 skill 里大半是 Python 数据源 SDK 用法和回测引擎，对我们没价值；另外渐进披露需要 `load_skill` tool 与多轮 agent 循环配合，对固定 pipeline 是过度设计。

本次改动落地一套适合本项目体量的最小骨架：DB 存 skill、Web 端 CRUD、N:M 关联到策略、首个消费方仅 `analyze.ts`。

## Goals / Non-Goals

**Goals:**

- skill 是纯 markdown 知识件，独立于策略和 memory，可被多个策略复用（N:M）
- 用户可在 Web 端创建/编辑 skill，无需改代码或重启服务
- `analyze.ts` 在 prompt 中注入策略关联的 skill body，增强分析效果
- monitoring 历史记录保留当时使用的 skill 快照，可事后复盘
- 首次部署时 idempotent seed 5–10 个中文 skill 作为起步内容
- token 成本可控（单次 prompt 注入的 skill 体积有上限）

**Non-Goals:**

- LLM 自动选择 skill（Phase 2，配合 monitoring_runs.suggested_skills）
- seed 同步升级机制（用户编辑过 seed 后如何处理仓库 markdown 升级，留 Phase 2）
- 接入 `parse-strategy.ts` / news `summarize.ts`（Phase 3）
- 渐进披露 / `load_skill` tool / Anthropic tool_use 调用 skill 加载（skill 数量超过 30 才考虑）
- 用户跨账号共享 skill / skill marketplace
- skill body 可执行代码（保持纯 markdown，不引入安全/沙箱负担）

## Decisions

### Skill 选择策略：MVP 仅用户显式配置

**决策：** Phase 1 只支持用户在策略详情页显式选择最多 3 个 skill。`analyze.ts` 不调用任何额外 LLM 来挑 skill；策略未关联 skill 时退回到现有 prompt（无 skill 增强）。

**为什么不做 LLM 自动选：** 单人量化记账场景下，策略是用户自己写的脚本——用户最清楚自己的策略需要什么方法论。多一次 LLM call 增加成本和延迟，但选出来的 skill 大概率是常识性默认（如 candlestick + risk-checklist），实际增益不明显。

**Phase 2 替代方案（非本次范围，但形塑了本次设计）：** 在主 `analyze.ts` 调用的 `report_analysis` tool schema 上多加一个 `suggested_skills: string[]` 字段，让 LLM 在常规分析之外顺手推荐"下次值得挂的 skill"，存到 `monitoring_runs.suggested_skills`，UI 提示用户。这种方式零额外 LLM call、决策权回到用户，比 auto-pick 更轻量。

### Skill body 注入位置：prompt 顶部，memory 之前

**决策：** prompt 结构为 `skillsBlock → memoriesBlock → 策略 → 持仓 → 近期价格 → 输出指令`。

**理由：** skill 是稳定的通用方法论，放在最前不会被任何策略/行情数据影响顺序；memory 是特定标的笔记，紧跟 skill 之后；具体行情数据放在最后段紧贴判断指令，让 LLM 注意力衰减影响最小。

### Token 控制：写入校验 + 关联数量上限

**决策：** 双重防线
- skill `body_md` 在 API 写入时校验 ≤ 6000 字符（约 1500–2000 token）
- 单个 strategy 关联 skill 数量上限 3（API 校验 + UI 限制）

**最坏情况：** 3 × 6000 = 18000 字符 ≈ 5000 token，叠加现有 prompt 仍在合理范围内。

**为什么不做更复杂的：** 目前不上滑动窗口、不上 token 计数（节省依赖）、不上动态截断。简单上限规则容易理解和维护。

### 存储：DB 表（不是文件系统）

**决策：** skill 存 postgres 表，与 strategies/memories/notifications 一致。

**为什么不走文件系统：** 项目核心理念是单人 + Web 上一切可改，不依赖 git workflow。复用现有 Drizzle schema 模式、API 路由模式、UI 模式（仿 strategies / memories）能最快落地。

### Seed 策略：一次性 + 中文重写

**决策：**
- 启动时 idempotent seed：worker/web 启动钩子里跑一个脚本，按 `name` upsert 不存在的 seed skill，已存在的不论用户是否编辑过一律跳过
- seed 内容写在 `apps/web/seed/skills/<slug>.md`，不直接拷 vibe-trading 英文原文，而是中文重写并精简到 1500–3000 字符
- 候选 5–10 个：`candlestick`、`risk-checklist`、`reference-price-management`、`behavioral-finance`、`valuation-basic`，剩余在实施阶段挑

**为什么不做 hash 比对升级：** 增加复杂度但实际收益小（用户编辑过的 skill 我们不会去碰，没编辑过的也不会主动同步）；如果以后 vibe-trading 出了好的新 skill，作为 Phase 2 的"导入向导"页面更直观。

**Attribution：** 根目录新增 `NOTICE` 文件，声明 skill 内容参考自 MIT 许可的 vibe-trading 项目并附链接。

### `monitoring_runs.skill_snapshot` 存完整 body 而不是 ids

**决策：** 在 `monitoring_runs` 表加 `skill_snapshot: jsonb`，结构 `[{ name, body_md_hash, body_md_preview }]`。

**为什么存 preview 而不是完整 body：** skill 完整 body 可能 6000 字符，每天 N 个策略写一次 → 表会涨太快。折中方案：存 hash + 前 500 字符 preview。需要复盘完整内容时，hash 配合 git 历史可以查到当时的版本（用户在 web 改 skill 时，每次写入都保留 audit log 是 Phase 2，本次先不做）。

**为什么不只存 ids：** 仅靠 `skill_id` 无法还原"当天 skill 是什么样"——用户随时可能编辑 skill body。

### Category 字段：text + 应用层枚举

**决策：** DB 字段 `category text not null`，应用层（zod schema / UI 下拉）维护枚举：`pattern` / `risk` / `valuation` / `behavioral` / `macro` / `other`。UI 下拉默认 6 个选项，但用户在 API 直接调用时可写入新值（不阻断）。

**为什么不在 DB 层用 enum 类型：** 加新类目时不用改 migration；同时应用层提供"软约束"避免值乱（一会儿 `risk` 一会儿 `Risk Management`）。

### Skill 删除：CASCADE，不阻断

**决策：** `strategy_skills.skill_id` 设 ON DELETE CASCADE。删 skill 时自动解除策略关联。`monitoring_runs.skill_snapshot` 因为是 jsonb 快照，不受影响。

**为什么不阻断删除：** 单人项目不需要这种保护，CASCADE 简单直接。snapshot 已固化历史不丢。

## Risks / Trade-offs

- **Risk：seed skill 翻译质量参差** → Mitigation：MVP 只 seed 5 个最常用的并人工 review；其余可以 Phase 2 增量补充，不阻塞主流程。

- **Risk：用户给一个策略挂 3 个超长 skill 后 prompt 仍可能感受到 token 压力** → Mitigation：UI 在编辑器底部显示当前 prompt 估算总长度（character count）；后续若发生实际问题再加 token 计数器。

- **Risk：Phase 1 没做 auto-pick，新用户上手不知道怎么用 skill** → Mitigation：seed 一组开箱可用的 skill；策略详情页对没关联 skill 的策略显示一个提示卡片"试试给这个策略关联一个 skill 增强分析"。

- **Risk：skill_snapshot 字段令 monitoring_runs 表行变大** → Mitigation：只存 hash + 前 500 字符 preview，单次新增字符 < 2KB；后续若需完整审计可加独立 audit 表。

- **Trade-off：固定 prompt 顺序（skill→memory→策略→持仓→价格）放弃了 LLM 自适应** → 但简化了调试，每次 prompt 结构稳定，分析行为可复现。

- **Trade-off：N:M 让一个 skill 被多策略共用，编辑会同时影响所有策略** → 用户语义上是合理的（"K 线形态判定"应该是个全局标准），但要在 /skills 编辑页提示"该 skill 被 N 个策略关联"避免无意改动。

## Migration Plan

1. **Schema migration**：`packages/db/drizzle/<next>_add_skills.sql` 包括建 `skills` 表、`strategy_skills` 关联表、`monitoring_runs` 增加 `skill_snapshot` jsonb 列。所有新表/列允许空（`skill_snapshot` 可为 null），不破坏现有 monitoring 流程。

2. **代码部署顺序**：Schema → seed 脚本 → API → UI → analyze.ts 注入。前 4 步即使部署后用户没创建任何关联，monitoring 行为完全不变（等价于「用户没挂 skill」分支）。

3. **Seed 时机**：worker 进程启动时触发，幂等。第一次调用 idempotent seed 把 5 个内置 skill 写入；后续重启不重复写入。

4. **Rollback**：删除新表 + 移除 `monitoring_runs.skill_snapshot` 列。代码 revert 到上一个版本即可，无需数据迁移（skill 数据丢失可接受——用户最多重新 seed 一次）。

5. **不需要 feature flag**：用户没关联 skill 时 monitoring 行为与上线前完全一致；用户主动挂上 skill 才进入新分支。

## Open Questions

- 暂无（所有关键决策已经在 brainstorming 阶段定下）。
