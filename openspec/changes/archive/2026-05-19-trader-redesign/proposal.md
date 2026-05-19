## Why

现有系统以固定 DSL 格式和 AI 对话生成策略，内置回测引擎，导致策略表达能力受限、系统复杂度高。用户实际上更倾向于用外部工具（如 Claude Code）自由编写 Python 策略脚本，系统只需负责解析、持仓跟踪和日常监控。

## What Changes

- **BREAKING** 移除策略 DSL（JSON 格式 config 字段），改为存储原始 Python 脚本 + LLM 生成的 markdown 描述
- **BREAKING** 移除 AI 对话式策略生成（Workshop 页面 + `/api/strategies/chat`）
- **BREAKING** 移除内置回测引擎（Worker backtest 模块 + `/api/backtests`）
- **BREAKING** 删除 `backtests` 表和 `price_cache` 表；现有 `strategies` 表数据清空重建
- 新增策略注入流程：上传/粘贴 Python 脚本 → LLM（tool_use）解析 → markdown 预览确认 → 入库
- 新增持仓管理：支持多股票、分批建仓（position + position_lots），盈亏数据来自每日监控价格快照
- 新增每日监控中心：10:00 CST 定时触发，LLM 分析有持仓策略，生成操作建议并推送站内通知
- 移除参数探索与优化器功能

## Capabilities

### New Capabilities

- `strategy-injection`: 通过上传或粘贴 Python 脚本注入策略，LLM 以 tool_use 模式解析出名称、股票代码、markdown 策略描述
- `position-management`: 对策略下多只股票进行分批建仓/换仓记录，持仓盈亏通过每日监控价格快照计算
- `daily-monitoring`: Worker 每日 10:00 CST 自动分析有持仓的策略（yfinance 拉取价格 + LLM tool_use 分析），输出分析报告，触发站内通知

### Modified Capabilities

（无现有 spec 文件，无需 delta）

## Impact

**删除的代码：**
- `apps/web/app/workshop/` 页面
- `apps/web/app/backtest/` 页面
- `apps/web/app/api/strategies/chat/` 接口
- `apps/web/app/api/backtests/` 接口
- `apps/worker/src/backtest/`（整个目录）
- `apps/worker/src/price/`（整个目录）
- `apps/worker/akshare_fetch.py`
- `packages/db/src/strategy-schema.ts`、`strategy-types.ts`

**修改的代码：**
- `packages/db/src/schema.ts`：策略表重构 + 新增 positions / position_lots / monitoring_runs / notifications 表
- `apps/worker/src/worker.ts`：移除回测 handler，注册每日监控 cron
- `apps/web/lib/strategy-prompt.ts`：删除

**新增的代码：**
- `apps/worker/yahoo_fetch.py`（替换 akshare_fetch.py）
- `apps/worker/src/monitoring/` 目录（job、analyze、yahoo-fetch）
- 前端：策略库、策略详情、持仓管理、监控中心页面

**依赖变更：**
- 移除 `akshare`（Python）；新增 `yfinance`（Python）
- 新增 `p-limit`（Node.js，Worker 并发控制）
