# 持仓买入/卖出机制设计

日期:2026-06-03

## 背景与目标

当前系统只支持**买入**:`position_lots` 表每条记录代表一次建仓(股数、成本价、日期、备注),盈利只计算**未实现浮盈**(`(最新价 − 均价) × 总股数`)。没有任何卖出概念,也没有已实现盈利。

本次目标:

1. 引入**卖出**机制,买入和卖出共用一套基础设施。
2. 每只股票的买入和卖出统一展示在持仓卡片下方的**操作历史时间线**。
3. 明确盈利计算口径:已实现 + 未实现 = 总盈利,基于**加权(移动)平均成本**。

适用范围:**手动持仓**(`/positions` 手动 tab)和**策略持仓**(策略详情页)两者都做,逻辑统一。

## 核心决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 成本口径 | 加权平均成本(移动平均) | 卖出无需和买入批次配对,模型最轻,与现有均价口径一致 |
| 数据模型 | `position_lots` 加 `type` 列 | 迁移最小(只加一列),复用全部现有 service/API/UI,操作历史天然是同表时间线 |
| 清仓后 | 保留为"已清仓" | 保留交易记录便于复盘,已实现盈利仍计入总收益 |
| 盈利展示 | 每只股票只显示总盈利(已实现+未实现合计) | 简洁;两部分仍在内部追踪 |
| 历史曲线 | 按时间精确重算,实时计算不落库 | 数据量小、计算廉价;落库会引入缓存失效负担,不划算 |

## 第 1 节:数据模型

给 `position_lots` 加一列:

```
type  text NOT NULL DEFAULT 'BUY'   -- 'BUY' | 'SELL'
```

字段语义复用现有列(不改名):

| 列 | BUY 时 | SELL 时 |
|---|---|---|
| `shares` | 买入股数 | 卖出股数 |
| `costPrice` | 买入成本价 | 卖出价 |
| `lotDate` | 买入日期 | 卖出日期 |
| `notes` | 备注 | 备注 |

> 语义注记:SELL 行的 `costPrice` 实际存的是卖出价。在 schema 中加注释说明。

迁移脚本:`ALTER TABLE position_lots ADD COLUMN type text NOT NULL DEFAULT 'BUY';`(现有数据自动全为 BUY,零风险)。`positions` 表不动。一条 position 下挂一串按时间排列的 BUY/SELL 记录 = 这只股票的完整操作历史。

## 第 2 节:盈利计算(移动平均)

按交易时间顺序(`lotDate` 升序,同日按 `createdAt`)回放每只股票的交易,维护:

- `heldShares`(当前持股)
- `costBasis`(当前持股的总成本)
- `realizedPnL`(累计已实现盈利)

```
BUY(s, p):   heldShares += s;  costBasis += s*p
SELL(s, p):  avg = costBasis / heldShares           # 卖出时点的移动均价
             realizedPnL += (p - avg) * s
             costBasis   -= avg * s
             heldShares  -= s
```

回放完后,每只股票:

- **均价** = `costBasis / heldShares`(剩余持仓)
- **未实现盈利** = `latestPrice × heldShares − costBasis`
- **总盈利** = `realizedPnL + 未实现盈利`(对外展示的就是这个)
- **总盈利%** = `总盈利 / grossInvested × 100`,其中 `grossInvested` = 历史所有 BUY 的 `shares×price` 之和。含义:投入过的本金赚了百分之几。

已清仓的股票:`heldShares=0`、未实现=0、总盈利 = `realizedPnL`,标"已清仓"。

百分比四舍五入沿用现有口径:`Math.round(x * 10000) / 100`(精确到 0.01%)。

## 第 3 节:P&L 历史曲线按时间精确重算

`/api/positions/history`(账户级)和 `/api/strategies/[id]/history`(策略级)改为重放交易重建每日快照。

对范围内每一天 `d`(从最早交易日或 range 起点到今天):

1. 取所有 `lotDate ≤ d` 的交易,按第 2 节算法回放,得到每只股票当天的 `heldShares`、`costBasis`、累计 `realizedPnL`。
2. 当天每只股票价格 `price(symbol, d)` = `price_snapshots` 中 `date ≤ d` 的最新 `close`。
3. 账户当天汇总:
   ```
   marketValue      = Σ heldShares × price
   remainingCost    = Σ costBasis
   realizedCum      = Σ realizedPnL
   unrealized       = marketValue − remainingCost
   总盈利$           = unrealized + realizedCum
   grossInvested(d) = Σ (lotDate≤d 的所有 BUY 的 shares×price)
   percentPnl(d)    = 总盈利$ / grossInvested(d) × 100
   ```

曲线**包含已实现盈利**,与第 2 节"总盈利"口径一致——某天清仓落袋后,曲线不会因持股归零而塌回 0,而是体现已锁定收益。

性能:history 路由已在内存聚合 snapshot;新增的只是按日回放交易,按日循环里维护增量游标即可,无性能问题。**不落库缓存**——若将来数据量大到接口明显变慢(>几百 ms),再引入物化表 + 失效机制。

## 第 4 节:API 变更

**新增卖出端点**(对称于现有买入):

- `POST /api/positions/manual/sell` — body `{ symbol, shares, price, sellDate, notes? }`
- `POST /api/strategies/[id]/lots/sell` — 同上(策略持仓)

两者都走新 service 函数 `recordSell(...)`:找到对应 position → 校验剩余股数足够 → 插入一条 `type='SELL'` 的 `position_lots` 记录。

**`upsertPositionAndCreateLot`** 签名不动,内部插入时显式带 `type: 'BUY'`。

**GET 端点扩展**:`/api/positions/manual` 和 `/api/strategies/[id]/positions` 返回里,每个 position 增加 `realizedPnl`、`unrealizedPnl`、`totalPnl`、`totalPnlPercent`、`isClosed`(heldShares===0),并把 `lots` 改名为 `transactions`(含 `type`),按时间排序。

第 2 节的回放算法抽到共享 `lib/pnl.ts`,被 GET 端点和 history 两处复用。

## 第 5 节:UI 变更

**操作历史时间线**:每个持仓卡片下方的列表,统一展示 BUY/SELL,按日期排序:

```
2026-05-01  买入  100 股 @ $10.00
2026-05-20  卖出   50 股 @ $15.00   · 备注
```

买入/卖出用文字标签 + 颜色区分(红涨绿跌约定)。每行保留删除按钮。

**卖出入口**:每个持仓卡片加「卖出」按钮,点开 `SellForm`(新组件,类比 `LotForm`):字段 symbol(锁定)、股数、卖出价、日期、备注。

**盈利展示**:卡片头部显示"总盈利 $X (Y%)";已清仓的标"已清仓"徽章、价格列不再轮询。

改动文件:`apps/web/components/manual-positions-tab.tsx`、策略详情页持仓 tab、新增 `apps/web/components/sell-form.tsx`。

## 第 6 节:校验、边界、测试

**校验**:

- 卖出股数 > 剩余持股 → 拒绝(400),不允许做空/超卖。
- 卖出日期 ≤ 今天;价格 > 0、股数 > 0。
- 卖出日期早于该股最早买入日 → 拒绝。

**边界**:

- 删除某条买入后若导致历史上某天出现"持股为负" → 该删除被拒绝(否则回放算法会崩)。删除卖出总是安全。
- 全部卖出后保留 position(已清仓),仍计入账户总收益曲线。

**测试**(Vitest + TDD):

- `lib/pnl.ts` 回放算法单测:纯买入、买入后部分卖出、多次买卖交错、完全清仓、超卖被拒。
- sell 端点集成测试:正常卖出、超卖 400、清仓后状态。
- history 重算:含卖出的多日序列断言每日 percentPnl。
