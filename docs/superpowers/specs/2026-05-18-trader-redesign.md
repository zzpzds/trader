# Trader 系统重新设计文档

**日期**：2026-05-18  
**状态**：待实现  
**替代**：2026-05-11-quant-trader-design.md

---

## 概述

对现有量化交易系统的整体重构，核心思路转变为：

- **策略外部生成**：策略由用户在外部（如 Claude Code）生成 Python 脚本，注入系统后由 LLM 解析为可读 markdown，不再内置 DSL 和 AI 对话生成流程
- **回测外部化**：回测逻辑完全由外部脚本承担，系统不包含独立回测引擎
- **仓位手动管理**：用户手动记录建仓/加仓/换仓操作，支持多股票、分批建仓；盈亏数据由每日监控任务更新
- **智能监控**：每日定时触发，对有持仓的策略进行 AI 分析，生成操作建议并通知用户

**明确不做：**
- 策略 DSL 格式与验证
- AI 对话式策略生成
- 内置回测引擎
- 参数探索与优化器
- 券商 API 自动下单
- 实时价格拉取（价格数据仅来自每日监控快照）
- 多用户体系

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js + React + Tailwind CSS + shadcn/ui |
| 后端 | Next.js API Routes |
| Worker | Node.js 独立进程（pg-boss） |
| 数据库 | PostgreSQL（Railway 托管） |
| 任务队列 | pg-boss |
| AI | Anthropic Claude API（claude-sonnet-4-6，tool_use 模式） |
| 行情数据 | Yahoo Finance（Python 子进程，`yfinance`） |
| 并发控制 | p-limit（Worker 内，最大并发 3） |
| 部署 | Railway |

---

## 数据库 Schema

```sql
-- 策略定义（重构：移除 config JSONB DSL，改为 markdown + 原始脚本）
CREATE TABLE strategies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  symbols    TEXT[] NOT NULL DEFAULT '{}',  -- LLM 解析出的股票代码列表
  content    TEXT NOT NULL,                  -- LLM 生成的 markdown 策略描述
  script     TEXT NOT NULL,                  -- 原始 Python 脚本代码
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 持仓汇总（一个策略可持有多只股票）
CREATE TABLE positions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID REFERENCES strategies(id) ON DELETE CASCADE,
  symbol      TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (strategy_id, symbol)
);

-- 持仓批次明细（支持分批建仓，每次操作一条记录）
CREATE TABLE position_lots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id UUID REFERENCES positions(id) ON DELETE CASCADE,
  shares      NUMERIC NOT NULL,       -- 股数（可为小数，支持碎股）
  cost_price  NUMERIC NOT NULL,       -- 买入成本价
  lot_date    DATE NOT NULL,          -- 建仓日期
  notes       TEXT,                   -- 备注（可选）
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 监控运行记录（每次定时分析的结果）
CREATE TABLE monitoring_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id      UUID REFERENCES strategies(id) ON DELETE CASCADE,
  run_date         DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending | completed | failed
  analysis         TEXT,                             -- LLM 完整分析报告（markdown），失败时为 NULL
  has_action_items BOOLEAN NOT NULL DEFAULT false,
  prices           JSONB,    -- 本次拉取的价格快照，如 {"QQQ": 480.5, "TQQQ": 65.2}
  error            TEXT,     -- 失败原因（status=failed 时填写）
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- 站内通知
CREATE TABLE notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monitoring_run_id UUID REFERENCES monitoring_runs(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  content           TEXT NOT NULL,
  is_read           BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT now()
);
```

**删除的表：** `backtests`、`price_cache`

**盈亏数据来源说明：** 持仓页面展示的当前价格与盈亏，来自该策略最近一次 `status=completed` 的 `monitoring_runs.prices` 快照，不做实时价格拉取。

---

## 系统架构

```
Railway
├── next-app   ← Web + API Routes（用户交互）
└── worker     ← 监控调度层（pg-boss cron，24/7 运行）
      │
      ├── 共享 PostgreSQL
      ├── p-limit（并发上限 3）
      └── Python 子进程（yfinance 行情拉取）
```

---

## 核心流程

### 流程 1：策略注入

```
用户上传 .py 文件 或 粘贴代码
        ↓
POST /api/strategies/parse
        ↓
调用 Claude API（tool_use 模式）
  工具定义：parse_strategy(name, symbols, content)
        ↓
LLM 通过 tool_use 结构化返回：
  - name：策略名称
  - symbols：股票代码数组
  - content：markdown 策略描述
    （含：策略概述、触发条件、仓位操作、关键参数表格）
        ↓
前端展示 markdown 预览 + symbols（用户可编辑）
        ↓
用户确认 → POST /api/strategies 入库
```

**tool_use 工具定义：**
```json
{
  "name": "parse_strategy",
  "description": "从 Python 策略脚本中提取结构化信息",
  "input_schema": {
    "type": "object",
    "properties": {
      "name":    { "type": "string",              "description": "策略名称" },
      "symbols": { "type": "array", "items": { "type": "string" }, "description": "涉及的股票代码列表" },
      "content": { "type": "string",              "description": "markdown 格式的策略描述" }
    },
    "required": ["name", "symbols", "content"]
  }
}
```

**解析失败处理：** 若脚本内容不足以识别策略（如空文件、非策略脚本），LLM 返回 symbols 为空数组，前端展示警告提示用户手动填写。

---

### 流程 2：仓位管理（手动）

```
策略详情页 → 持仓 Tab
  ├── 按 symbol 分组展示所有 lots
  ├── 每组显示：总股数、加权均价、最近监控价格、盈亏%
  └── 操作：新增 lot / 编辑 lot / 删除 lot

新增 lot：
  POST /api/strategies/[id]/lots
  body: { symbol, shares, costPrice, lotDate, notes }
  → 服务器自动 upsert position（strategy_id + symbol），再创建 lot

换仓操作（手动）：
  → 减少/删除 A 股票的 lot
  → 为 B 股票新增 lot（position 不存在时自动创建）
```

**盈亏计算：** 持仓页加载时，从该策略最近一次 `status=completed` 的 monitoring_run 取 `prices` 快照，计算各 symbol 的浮动盈亏：
```
盈亏% = (最近监控价 - 加权均价) / 加权均价 × 100
```
若该策略尚无监控记录，盈亏列显示"--"。

---

### 流程 3：每日监控（Worker，10:00 CST）

```
pg-boss cron: '0 2 * * *'（UTC，对应北京时间 10:00）
        ↓
查询所有有 position_lots 记录的策略
        ↓
p-limit(3) 并发执行，每个策略：
  1. 在 monitoring_runs 写入 status=pending 记录
  2. 读取 strategy.content + strategy.symbols
  3. 读取所有 positions + position_lots，计算加权均价
  4. 调用 Python 子进程（yfinance）
     → 拉取 symbols 中每只股票近 60 天 OHLCV + 最新收盘价
     → 将最新价格写入 monitoring_runs.prices
  5. 组装 LLM prompt（见下方）
  6. 调用 Claude API（tool_use 模式）→ 结构化返回分析结果
  7. 更新 monitoring_runs：status=completed，写入 analysis / has_action_items
  8. 若 has_action_items → 写入 notifications
  ↓（任一步骤异常）
  更新 monitoring_runs：status=failed，error=错误信息
```

**监控 LLM tool_use 工具定义：**
```json
{
  "name": "report_analysis",
  "description": "输出持仓分析报告",
  "input_schema": {
    "type": "object",
    "properties": {
      "analysis":        { "type": "string",  "description": "完整分析报告（markdown）" },
      "has_action_items":{ "type": "boolean", "description": "是否有明确操作建议（加仓/减仓/换仓）" },
      "action_summary":  { "type": "string",  "description": "操作建议摘要，用于通知标题（has_action_items=true 时必填）" }
    },
    "required": ["analysis", "has_action_items"]
  }
}
```

**监控 LLM prompt 结构：**
```
你是一名量化交易助手。请根据以下信息分析当前持仓状态。

## 策略描述
{strategy.content}

## 当前持仓
| 股票 | 持仓股数 | 加权均价 | 最新价 | 盈亏% |
|------|---------|---------|-------|------|
{每只股票一行}

## 近期价格数据（最近 20 个交易日）
{每只股票的 OHLCV 摘要}

请分析：
1. 根据策略规则，当前市场状态是否触发了加仓、减仓或换仓条件
2. 如有操作建议，请明确说明：操作类型、涉及标的、具体理由
3. 整体持仓风险评估

完成分析后，调用 report_analysis 工具输出结果。
```

---

## Python 子进程服务

**文件：** `apps/worker/yahoo_fetch.py`

```
# 替换 akshare_fetch.py
# 协议：JSON stdin → JSON stdout（保持现有 subprocess 通信模式）
# 输入：{ "symbols": ["QQQ", "TQQQ"], "period": "3mo" }
# 输出：{
#   "QQQ":  { "latest": 480.5, "bars": [{ "date", "open", "high", "low", "close", "volume" }, ...] },
#   "TQQQ": { "latest": 65.2,  "bars": [...] }
# }
```

`requirements.txt` 更新：
```
yfinance>=0.2.40
pandas>=2.0.0
```

---

## API Routes

### 策略相关

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/strategies` | 策略列表 |
| POST | `/api/strategies` | 创建策略 |
| GET | `/api/strategies/[id]` | 策略详情 |
| PUT | `/api/strategies/[id]` | 更新策略（名称/content/symbols） |
| DELETE | `/api/strategies/[id]` | 删除策略 |
| POST | `/api/strategies/parse` | LLM 解析脚本（返回预览，不入库） |

### 持仓相关

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/strategies/[id]/positions` | 获取策略所有持仓（含最近监控价格） |
| POST | `/api/strategies/[id]/lots` | 新增 lot（自动 upsert position） |
| PUT | `/api/lots/[lotId]` | 编辑 lot |
| DELETE | `/api/lots/[lotId]` | 删除 lot |

### 监控相关

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/monitoring/runs` | 监控历史列表（支持按策略/日期过滤） |
| GET | `/api/monitoring/runs/[id]` | 监控运行详情 |
| POST | `/api/monitoring/trigger` | 手动触发全部策略监控 |
| POST | `/api/monitoring/trigger/[strategyId]` | 手动触发单个策略监控 |

### 通知相关

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/notifications` | 通知列表（含未读数） |
| PUT | `/api/notifications/[id]/read` | 标记已读 |
| PUT | `/api/notifications/read-all` | 全部标记已读 |

---

## UI 结构

### 导航

```
Trader
├── 策略库          — 策略列表，注入新策略入口
├── 持仓管理        — 所有策略持仓总览（含盈亏）
├── 监控中心        — 历史分析记录
└── 🔔 [未读角标]   — 导航栏右侧通知入口
```

### 策略库页面（`/strategies`）

- 策略卡片列表：名称、涉及股票标签（symbols）、持仓数量、创建时间
- "注入策略" 按钮 → 打开注入面板
  - Tab 1：上传 `.py` 文件
  - Tab 2：粘贴代码
  - "解析" → LLM 处理中（loading 状态） → 展示 markdown 预览 + symbols（可编辑）
  - 解析失败时展示警告，允许用户手动填写 symbols
  - "确认保存" → 入库

### 策略详情页（`/strategies/[id]`）

- 顶部：策略名称、symbols 标签
- Tabs：
  - **策略描述**：渲染 markdown content
  - **原始脚本**：代码块展示 Python 脚本
  - **持仓**：按 symbol 分组，展示 lots 列表（含最近监控价格/盈亏）+ 聚合数据 + 增删改操作
  - **最近分析**：该策略最近 10 次 monitoring_run 列表（日期、状态、是否有操作建议），点击展开完整报告

### 持仓管理页（`/positions`）

- 所有策略的持仓汇总表
- 按策略分组展示
- 每条持仓显示：股票代码、总股数、加权均价、最近监控价、浮动盈亏%
- 最近监控价格来源：该策略最近一次 completed 的 monitoring_run.prices
- 点击 → 跳转到对应策略详情的持仓 Tab

### 监控中心页（`/monitoring`）

- 顶部统计：本周分析次数、产生建议次数、失败次数
- 运行记录列表（按日期倒序）
  - 每条：日期、策略名、状态（completed/failed/pending）、是否有操作建议、分析摘要
  - 失败记录显示错误原因
- 点击 → 展开完整 markdown 分析报告
- 支持按策略、日期范围、状态过滤

### 通知面板

- 导航栏铃铛图标，未读数角标
- 点击展开抽屉/下拉列表
- 每条通知：标题（来自 action_summary）、时间、是否已读
- 点击通知 → 跳转到对应 monitoring run 详情
- "全部标记已读" 按钮

---

## Worker 变更

**删除：**
- `apps/worker/src/backtest/`（整个目录）
- `apps/worker/src/price/`（整个目录）
- `apps/worker/akshare_fetch.py`

**保留并改造：**
- `apps/worker/src/worker.ts` — 移除 run-backtest handler，注册监控 cron job

**新增：**
- `apps/worker/src/monitoring/job.ts` — 监控主逻辑（含 p-limit 并发控制）
- `apps/worker/src/monitoring/yahoo-fetch.ts` — Python 子进程封装
- `apps/worker/src/monitoring/analyze.ts` — LLM 分析逻辑（tool_use 模式）
- `apps/worker/yahoo_fetch.py` — yfinance 数据拉取脚本

**pg-boss cron 注册：**
```typescript
await boss.schedule('daily-monitoring', '0 2 * * *', {}, {
  tz: 'UTC'  // 对应北京时间 10:00 CST
})
```

**并发控制（job.ts 内）：**
```typescript
import pLimit from 'p-limit'
const limit = pLimit(3)  // 最多同时处理 3 个策略
await Promise.all(strategies.map(s => limit(() => analyzeStrategy(s))))
```

---

## 迁移说明

现有数据库需执行以下变更（通过 Drizzle migration）：

1. **清空 `strategies` 表中的现有记录**：旧 DSL 格式策略无法自动转换，需用户重新注入脚本
2. `strategies` 表：删除 `config` 列，新增 `symbols TEXT[]`、`content TEXT NOT NULL`、`script TEXT NOT NULL`
3. 删除 `backtests` 表
4. 删除 `price_cache` 表
5. 新增 `positions` 表
6. 新增 `position_lots` 表
7. 新增 `monitoring_runs` 表
8. 新增 `notifications` 表（替换旧的 notifications 如有）

---

## 交付范围

### 核心功能

- [ ] 数据库 schema 迁移（Drizzle migration）
- [ ] `yahoo_fetch.py`（yfinance 子进程，替换 akshare）
- [ ] 策略注入 API（`/api/strategies/parse` tool_use + `/api/strategies`）
- [ ] 策略 CRUD API
- [ ] 持仓 + lot CRUD API（含 position auto-upsert）
- [ ] 监控 Worker（cron + p-limit + LLM tool_use 分析 + 通知写入）
- [ ] 监控错误状态记录（status/error 字段）
- [ ] 手动触发监控 API（全部 + 单策略）
- [ ] 通知 API

### 前端页面

- [ ] 策略库页面（列表 + 注入面板）
- [ ] 策略详情页（描述 / 脚本 / 持仓 / 最近分析 Tabs）
- [ ] 持仓管理总览页（含监控快照盈亏）
- [ ] 监控中心页面（含失败状态展示）
- [ ] 通知面板组件（导航栏集成）

### 清理工作

- [ ] 删除旧 Workshop 页面
- [ ] 删除旧回测相关页面和 API
- [ ] 删除 Worker 中的回测引擎代码
- [ ] 删除 DSL schema 定义文件
