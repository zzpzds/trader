## Context

现有系统是一个基于 Next.js + TypeScript monorepo 的量化交易平台，包含：策略 DSL（JSON 格式，Zod 验证）、AI 对话策略生成、独立回测引擎（Worker + pg-boss）、AKShare Python 数据子进程。

本次重构将系统定位从"自动化策略生成+回测平台"转变为"策略仓位管理+智能监控平台"。策略的生成和回测完全外部化，系统核心职责变为：接收外部 Python 脚本、解析为可读描述、跟踪手动仓位、每日自动分析持仓。

## Goals / Non-Goals

**Goals:**
- 支持 Python 脚本注入并通过 LLM（tool_use）解析为 markdown 策略描述
- 持仓管理：多股票、分批建仓，盈亏来自每日监控价格快照
- 每日 10:00 CST 定时监控：有持仓策略 → yfinance 数据 → LLM 分析 → 通知
- 架构上保持 monorepo + pg-boss Worker 不变，仅替换业务逻辑

**Non-Goals:**
- 实时价格拉取（仅每日一次监控快照）
- 自动下单
- 回测引擎
- 多用户

## Decisions

### D1：LLM 输出使用 tool_use 结构化返回

**决策**：所有需要 LLM 返回结构化数据的场景（策略解析、监控分析）均使用 Claude tool_use 模式，而非依赖 LLM 输出格式的字符串解析。

**原因**：字符串解析依赖 LLM 精确遵守格式要求（如"最后一行输出 ACTION_REQUIRED: true"），实际上不稳定。tool_use 由 Anthropic SDK 保证结构化返回，不会因 LLM 输出格式变化而解析失败。

**替代方案考虑**：JSON mode（`response_format: json_object`）可以保证 JSON 输出，但无法约束字段结构；tool_use 可定义精确的 schema，更可靠。

---

### D2：持仓盈亏数据来自每日监控价格快照

**决策**：持仓页面展示的"当前价格"和"浮动盈亏"来自最近一次 `monitoring_runs.prices` 快照（JSONB 字段），不做独立的实时价格拉取。

**原因**：美股对于中国时区用户是隔夜市场，早上查看的本质是"昨日收盘"分析，不需要实时价格。同时避免增加额外的价格 API 调用逻辑（前端 + API 层）。

**替代方案考虑**：在持仓页加载时调用 Python 子进程拉取实时价格——会增加页面加载时间和复杂度，对此场景收益不大。

---

### D3：monitoring_runs 写入采用先建记录再更新状态的模式

**决策**：监控任务开始时立即写入 `status=pending` 记录，完成时更新为 `completed` 或 `failed`，而非任务完成后一次性写入。

**原因**：若 Worker 进程在分析中途崩溃，不会留下"无记录"的空洞——用户在监控中心可以看到 `pending` 或 `failed` 状态，了解当天监控状态。

---

### D4：持仓 API 自动 upsert position

**决策**：新增 lot 的 API 路径为 `POST /api/strategies/[id]/lots`，服务端自动根据 `(strategy_id, symbol)` upsert position 记录，再创建 lot。

**原因**：用户视角下"给这个策略添加一笔 QQQ 买入记录"是单一操作，不应要求用户先创建 position 再添加 lot（两步操作）。position 表是数据聚合层，对用户透明。

---

### D5：Worker 监控并发控制

**决策**：使用 `p-limit(3)` 限制同时处理的策略数量上限为 3。

**原因**：监控任务每个策略需要 spawn Python 子进程 + 调用 Claude API，无限并发会导致资源压力和 API rate limit 问题。3 是保守但安全的上限，可根据实际情况调整。

---

### D6：保留 pg-boss，不引入 node-cron

**决策**：沿用现有 pg-boss 调度每日监控 cron，不换 node-cron。

**原因**：pg-boss 的 cron 有任务历史、幂等性（同一时间不会重复触发）、进程重启后不丢失调度。node-cron 是纯内存调度，进程重启会漏掉调度。

## Risks / Trade-offs

**[LLM 解析质量不稳定]** → tool_use 保证了格式结构，但内容质量（提取出的 symbols 是否完整、markdown 是否准确）仍取决于脚本质量和 LLM 能力。通过"用户确认预览"步骤缓解，用户可手动修正。

**[yfinance 可用性]** → yfinance 依赖 Yahoo Finance 非官方 API，偶发 403/429 错误。已有重试逻辑（参考原 akshare_fetch.py 模式），monitoring_run 失败会记录 error 字段供排查。

**[监控 LLM 费用]** → 每个策略每天调用一次 Claude API（含价格数据 + 策略描述 prompt）。策略数量少时（< 10）费用可接受，大量策略时需关注。

**[数据迁移破坏性]** → 现有 strategies 数据需清空，用户需重新注入策略脚本。这是已知的 breaking change，在 proposal 中明确说明。

## Migration Plan

1. 运行 Drizzle migration：
   - 清空 `strategies` 表
   - 重建 `strategies` 表结构（删除 config，新增 symbols/content/script）
   - 删除 `backtests`、`price_cache` 表
   - 新增 `positions`、`position_lots`、`monitoring_runs`、`notifications` 表
2. 部署新 Worker（移除回测逻辑，注册监控 cron）
3. 部署新 Web（移除旧页面，新增策略注入/持仓/监控页面）
4. 更新 Python 依赖：`requirements.txt` 替换 `akshare` 为 `yfinance`

**回滚**：如需回滚，恢复代码并从备份恢复数据库（migration 具破坏性，代码回滚不能恢复已删除数据）。

## Open Questions

- 监控任务失败后是否需要自动重试？（当前设计：失败即记录，不重试，用户可手动触发）
- `p-limit(3)` 上限是否合适？待实际运行后根据 Railway 资源情况调整。
