# Quant Trader 系统设计文档

**日期**：2026-05-11  
**状态**：待实现

---

## 概述

一个 AI 驱动的美股量化交易系统，支持自然语言策略构建、历史回测、参数优化和持仓管理。

**两阶段交付：**
- **Phase 1**：策略构建 + 回测引擎（核心价值，可独立使用）
- **Phase 2**：贝叶斯参数优化 + 持仓管理（模拟仓/实仓）

**非目标（明确不做）：**
- 券商 API 自动下单（实仓由用户手动执行）
- 多用户 / 账号体系
- 加密货币、期货等非美股市场
- 跨周期条件（如日线 + 小时线联动）
- 复杂逻辑表达式（OR 入场、时序条件）

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 15 + React + Tailwind CSS + shadcn/ui |
| 后端 | Next.js API Routes |
| Worker | Node.js 独立进程 |
| 数据库 | PostgreSQL（Neon 或 Railway 托管） |
| 任务队列 | pg-boss（基于 PostgreSQL，无需 Redis） |
| AI | Anthropic Claude API（claude-sonnet-4-6） |
| 行情数据 | yahoo-finance2 |
| 技术指标 | technicalindicators（npm） |
| 图表 | recharts |
| 部署 | Railway（Web 服务 + Worker 服务） |

---

## 策略 DSL

所有模块共用的核心数据结构，存储为 PostgreSQL JSONB。

### 支持的技术指标

| 类型 | 参数 | 输出 |
|------|------|------|
| `SMA` | `{ period }` | 单值 |
| `EMA` | `{ period }` | 单值 |
| `MACD` | `{ fastPeriod, slowPeriod, signalPeriod }` | `.macd` `.signal` `.histogram` |
| `RSI` | `{ period }` | 单值 (0–100) |
| `BBANDS` | `{ period, stdDev }` | `.upper` `.middle` `.lower` |
| `VOLUME_MA` | `{ period }` | 单值 |

### 条件类型

**入场条件**（全部满足，AND 逻辑）：

```typescript
type EntryCondition =
  | { type: 'crossover';   a: string; b: string | number }  // a 上穿 b
  | { type: 'crossunder';  a: string; b: string | number }  // a 下穿 b
  | { type: 'above';       a: string; b: string | number }  // a > b
  | { type: 'below';       a: string; b: string | number }  // a < b
  | { type: 'pct_above';   a: string; b: string; pct: number } // a > b×(1+pct)
  | { type: 'position_down'; pct: number }  // 持仓亏损超过 X%（加仓触发）
  | { type: 'position_up';   pct: number }  // 持仓盈利超过 X%（加仓触发）
```

**出场条件**（任一满足，OR 逻辑）：

```typescript
type ExitCondition =
  | EntryCondition
  | { type: 'stop_loss';     pct: number }  // 从入场价下跌 X%
  | { type: 'take_profit';   pct: number }  // 从入场价上涨 X%
  | { type: 'trailing_stop'; pct: number }  // 从最高点回落 X%
```

### 完整策略结构

```typescript
interface Strategy {
  id: string
  name: string
  description: string
  symbol: string                              // 单股票，如 "AAPL"
  timeframe: '1d' | '1h' | '15m'
  indicators: {
    id: string                                // 条件中引用的名称
    type: IndicatorType
    params: Record<string, number>
    source?: 'open' | 'high' | 'low' | 'close' | 'volume'  // 默认 close
  }[]
  entryConditions: EntryCondition[]           // 全部满足才买入
  exitConditions: ExitCondition[]             // 任一满足即卖出
  positionSizing: { type: 'fixed_pct'; value: number }
  maxAdditions: number                        // 最多加仓次数，默认 0
  executionPrice: 'next_open' | 'current_close'  // 默认 next_open
}
```

**多输出指标引用方式**：在条件中使用 `"macd_1.signal"`、`"bb.upper"` 等点号语法访问子字段。

---

## 数据库 Schema

```sql
-- 策略定义
CREATE TABLE strategies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  config      JSONB NOT NULL,   -- 完整 Strategy DSL
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 回测记录
CREATE TABLE backtests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id     UUID REFERENCES strategies(id) ON DELETE CASCADE,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  initial_capital NUMERIC NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending/running/completed/failed
  results         JSONB,   -- { totalReturn, sharpe, maxDrawdown, winRate, trades[], equityCurve[] }
  error           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 行情缓存（两个服务共享）
CREATE TABLE price_cache (
  symbol    TEXT NOT NULL,
  timeframe TEXT NOT NULL,   -- '1d' | '1h' | '15m'
  ts        TIMESTAMPTZ NOT NULL,
  open      NUMERIC NOT NULL,
  high      NUMERIC NOT NULL,
  low       NUMERIC NOT NULL,
  close     NUMERIC NOT NULL,
  volume    NUMERIC NOT NULL,
  PRIMARY KEY (symbol, timeframe, ts)
);

-- Phase 2: 持仓组合
CREATE TABLE portfolios (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id     UUID REFERENCES strategies(id),
  name            TEXT NOT NULL,
  mode            TEXT NOT NULL,   -- 'paper' | 'live'
  initial_capital NUMERIC NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',  -- active/paused/closed
  started_at      TIMESTAMPTZ DEFAULT now()
);

-- Phase 2: 当前持仓
CREATE TABLE positions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id     UUID REFERENCES portfolios(id) ON DELETE CASCADE,
  symbol           TEXT NOT NULL,
  total_shares     NUMERIC NOT NULL,
  avg_cost         NUMERIC NOT NULL,
  addition_count   INT NOT NULL DEFAULT 0,
  opened_at        TIMESTAMPTZ DEFAULT now()
);

-- Phase 2: 交易记录
CREATE TABLE trades (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID REFERENCES portfolios(id) ON DELETE CASCADE,
  symbol       TEXT NOT NULL,
  action       TEXT NOT NULL,    -- 'buy' | 'sell'
  shares       NUMERIC NOT NULL,
  price        NUMERIC NOT NULL,
  commission   NUMERIC NOT NULL DEFAULT 0,
  source       TEXT NOT NULL,    -- 'auto'（模拟）| 'manual'（实仓）
  executed_at  TIMESTAMPTZ NOT NULL
);

-- Phase 2: 站内通知
CREATE TABLE notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type         TEXT NOT NULL,    -- 'signal' | 'info' | 'warning'
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  strategy_id  UUID REFERENCES strategies(id),
  portfolio_id UUID REFERENCES portfolios(id),
  read         BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT now()
);
```

---

## 系统架构

### 两个 Railway 服务

```
Railway
├── next-app   ← Web + API Routes（用户交互）
└── worker     ← 计算层（pg-boss 消费者，24/7 运行）
      │
      └── 共享 PostgreSQL（数据 + pg-boss 任务队列）
```

### 数据流

**回测流（Phase 1）：**
1. 用户点击"运行回测" → `POST /api/backtests` 创建记录 + pg-boss 入队 `run-backtest`
2. Worker 消费任务 → 从 `price_cache` 读取或拉取行情 → 执行回测引擎 → 写回 `backtests.results`
3. 前端通过 SSE（`GET /api/backtests/:id/stream`）监听完成事件 → 渲染图表

**AI 策略生成流（Phase 1）：**
1. 前端发送对话消息 → `POST /api/strategies/chat`
2. API Route 调用 Claude API（流式 SSE），系统提示包含完整 DSL Schema 定义和策略生成规则
3. Claude 在对话中补全策略细节，最终输出合法的 Strategy JSON
4. 前端解析 JSON，实时更新策略预览面板
5. 用户确认 → `POST /api/strategies` 保存

**信号监控流（Phase 2）：**
- Worker 通过 pg-boss cron 每 15 分钟执行一次（仅交易时段 09:30–16:00 ET）
- 拉取所有 active 持仓对应策略的最新行情
- 评估出场/入场（加仓）条件
- 模拟仓：自动写入 `trades`，更新 `positions`，创建 `notifications`
- 实仓：仅创建 `notifications` 提醒用户手动操作

### IBKR 手续费模型

```typescript
function calcCommission(shares: number, price: number): number {
  const perShare = 0.005
  const min = 1.00
  const max = price * shares * 0.01
  return Math.min(Math.max(perShare * shares, min), max)
}
```

### 执行价格

- 默认：信号触发后使用**次日开盘价**（`next_open`），避免 look-ahead bias
- 可选：当天收盘价（`current_close`），对应 MOC 订单场景

---

## 回测引擎

由 Worker 服务执行，纯 TypeScript 实现。

**执行流程：**
1. 检查 `price_cache` 中该 symbol + timeframe 的数据覆盖范围；缺失部分调用 yahoo-finance2 拉取并持久化后再读取，确保数据连续
2. 使用 `technicalindicators` 计算所有指标，逐根 K 线对齐
3. 按时间顺序逐根 K 线迭代：
   - 如无持仓：评估 `entryConditions`（全部满足则买入）
   - 如有持仓：评估 `exitConditions`（任一满足则卖出）+ `entryConditions`（满足加仓条件且 `addition_count < maxAdditions` 则加仓）
4. 每笔成交记录价格、手续费；更新 `avg_cost`（加仓后加权平均）
5. 回测完成后计算指标：总收益率、年化收益率、Sharpe Ratio、最大回撤、胜率、平均持仓周期
6. 生成权益曲线数组（每日净值）

**Yahoo Finance 数据限制：**
- 15min：仅 60 天历史（price_cache 会持续积累，随时间增长）
- 1h：约 730 天历史
- 1d：10 年以上

---

## UI 结构

### 导航（左侧固定 Sidebar）

```
📈 Trader
├── [Phase 1] 🔧 策略工坊
├── [Phase 1] 📊 回测中心
├── [Phase 2] ⚡ 参数探索
├── [Phase 2] 💼 持仓管理
└── 🔔 通知（未读数角标）
```

### 策略工坊（Phase 1 主界面）

左右分栏：
- **左栏**：AI 对话框（带消息历史，流式输出）
- **右栏**：策略结构实时预览（可读格式）+ "保存" / "直接回测" 按钮
- 顶部：策略列表入口（可切换/编辑已有策略）

### 回测中心（Phase 1）

左右分栏：
- **左栏**：策略选择 + 时间区间 + 初始资金 + "运行" 按钮 + 历史回测列表
- **右栏**：关键指标卡片（总收益、Sharpe、最大回撤、胜率）+ 权益曲线（recharts）+ 交易明细列表

### 参数探索（Phase 2）

- 选择策略 + 设定每个可调参数的搜索范围（最小值/最大值）
- 启动贝叶斯优化（后台运行，进度条显示）
- 结果：按 Sharpe 排序的参数组合列表 + 最优参数一键应用

### 持仓管理（Phase 2）

- 组合列表（模拟仓 / 实仓标签）
- 当前持仓卡片（股票、均价、现价、盈亏）
- 交易记录列表
- 通知中心（信号提醒、自动成交记录）

---

## Phase 1 交付范围

- [ ] PostgreSQL 初始化（strategies / backtests / price_cache 三张表）
- [ ] Next.js 项目脚手架（Tailwind + shadcn/ui）
- [ ] Worker 服务脚手架（pg-boss 初始化）
- [ ] Claude API 对话接口（策略生成 + 修改）
- [ ] 策略 CRUD API + 前端列表/详情
- [ ] 策略工坊页面（对话 + 实时预览）
- [ ] 回测引擎（指标计算 + 仓位模拟 + 手续费）
- [ ] 回测 API + pg-boss 任务（含 SSE 进度推送）
- [ ] 回测中心页面（配置 + 结果图表）
- [ ] Railway 部署配置

## Phase 2 交付范围（后续）

- [ ] 贝叶斯优化器（自实现 GP + EI，约 300–400 行）
- [ ] 参数探索页面
- [ ] portfolios / positions / trades / notifications 表
- [ ] 信号监控 Worker 任务（每 15min cron）
- [ ] 模拟仓自动成交逻辑
- [ ] 实仓通知逻辑
- [ ] 持仓管理页面
- [ ] 通知中心
