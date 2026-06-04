## Context

`position_lots` 每行是一次买入(shares/costPrice/lotDate/notes),盈利只算 `(最新价 − 均价) × 总股数` 的未实现浮盈。没有卖出,也没有已实现盈利。需要在最小迁移成本下引入卖出,统一买入/卖出基础设施,并明确盈利口径。适用范围:手动持仓与策略持仓两者,逻辑统一。完整需求见 `proposal.md` 与 `docs/superpowers/specs/2026-06-03-buy-sell-mechanism-design.md`。

约束:数据库迁移为手写 SQL(非 drizzle migrate),部署在阿里云 docker-compose;Next.js 版本与训练数据有出入,改动前需参考 `node_modules/next/dist/docs/`;颜色约定红涨绿跌;百分比四舍五入沿用 `Math.round(x * 10000) / 100`。

## Goals / Non-Goals

**Goals:**
- 引入卖出,买入/卖出共用 `position_lots` 表与 service/API/UI。
- 明确盈利口径:已实现 + 未实现 = 总盈利,基于移动平均成本。
- 每只股票统一展示 BUY/SELL 操作历史时间线;清仓后保留为「已清仓」。
- 历史曲线按时间精确重算,包含已实现盈利。

**Non-Goals:**
- 不做买卖批次配对(FIFO/LIFO/指定批次),只用移动平均。
- 不做做空/超卖。
- 不落库缓存每日回放结果(YAGNI,数据量小)。
- 盈利对外只展示总盈利,不拆已实现/未实现两行。

## Decisions

**1. 数据模型:`position_lots` 加 `type` 列,而非新建 trades 表。**
`type text NOT NULL DEFAULT 'BUY'`(`'BUY' | 'SELL'`)。SELL 行复用现有列:`shares`=卖出股数、`costPrice`=卖出价、`lotDate`=卖出日期、`notes`=备注(schema 加注释说明语义)。理由:迁移最小(只加一列,现有数据自动全为 BUY,零风险),复用全部现有 service/API/UI,操作历史天然是同表时间线。备选(新建 `trades` 表)被否:迁移与读写两套基础设施成本高,收益小。

**2. 盈利口径:移动平均回放。** 按 `lotDate` 升序、同日按 `createdAt` 回放每只股票,维护 `heldShares`、`costBasis`、`realizedPnl`:
```
BUY(s, p):   heldShares += s;  costBasis += s*p
SELL(s, p):  avg = costBasis / heldShares
             realizedPnl += (p - avg) * s
             costBasis   -= avg * s
             heldShares  -= s
```
回放后:均价 = `costBasis/heldShares`;未实现 = `latestPrice × heldShares − costBasis`;总盈利 = `realizedPnl + 未实现`;总盈利% = `总盈利 / grossInvested × 100`(`grossInvested` = 所有 BUY 的 `shares×price` 之和)。已清仓:`heldShares=0`、未实现=0、总盈利=`realizedPnl`。算法抽到共享 `apps/web/lib/pnl.ts`,被 GET 端点与 history 复用。浮点比较用 `EPS = 1e-9`。

**3. 历史曲线按日回放重算,不落库。** 对范围内每一天 d:取 `lotDate ≤ d` 的交易回放得当日 `heldShares/costBasis/realizedPnl`,价格取 `price_snapshots` 中 `date ≤ d` 的最新 `close`,账户/策略当天汇总 `总盈利$ = (marketValue − remainingCost) + realizedCum`,`percentPnl(d) = 总盈利$ / grossInvested(d) × 100`。曲线含已实现,清仓后不塌回 0。策略级 history 从 `monitoringRuns.prices` 切到 `price_snapshots`,与账户级一致。性能:按日循环维护增量游标即可;若将来 >几百 ms 再引入物化表。

**4. 删除守卫。** 删除买入若导致历史上某日持股为负 → 拒绝(409);删除卖出始终安全。纯函数 `canDeleteBuy(txns, lotId)` 在两处 delete 路由复用。

## Risks / Trade-offs

- [SELL 行 `costPrice` 实为卖出价,语义双关] → schema 列注释 + service 层封装 `recordSell`,读侧统一通过 `pnl.ts` 解释,避免散落理解。
- [移动平均与税务/券商 FIFO 口径不一致] → 明确为 Non-Goal,文档说明本系统采用移动平均。
- [history 按日回放在数据量增大时变慢] → 当前数据量下廉价;设阈值(>几百 ms)再物化,避免过早优化。
- [删除买入的负持股守卫] → 用纯函数回放校验,加单测覆盖(超卖/中途删买致负)。

## Migration Plan

1. 部署前执行 `scripts/migrate-2026-06-03.sql`:`ALTER TABLE position_lots ADD COLUMN type text NOT NULL DEFAULT 'BUY';`(现有数据全部置为 BUY)。
2. 代码改动向后兼容:旧数据无 SELL 行,回放等价于纯买入,展示与改动前一致。
3. 回滚:删列 `ALTER TABLE position_lots DROP COLUMN type;`(回滚前需确认无业务依赖 SELL 行;若已有 SELL 数据,删列会丢失卖出记录)。
