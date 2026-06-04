<!-- 详细 TDD 分步见 docs/superpowers/plans/2026-06-03-buy-sell-mechanism.md(Task 1-12) -->

## 1. 数据模型

- [x] 1.1 `packages/db/src/schema.ts`:给 `positionLots` 加 `type` 列(`text NOT NULL DEFAULT 'BUY'`),加注释说明 SELL 行 `costPrice`=卖出价
- [x] 1.2 更新/新增 `packages/db` schema 测试断言 `type` 列存在且默认 `'BUY'`
- [x] 1.3 编写迁移脚本 `scripts/migrate-2026-06-03.sql`:`ALTER TABLE position_lots ADD COLUMN type text NOT NULL DEFAULT 'BUY';`

## 2. 共享盈利回放库 `apps/web/lib/pnl.ts`(TDD)

- [x] 2.1 写失败单测 `apps/web/lib/__tests__/pnl.test.ts`:纯买入、买入后部分卖出、多次买卖交错、完全清仓、超卖被拒
- [x] 2.2 实现 `replayPosition(txns)` → `{ heldShares, costBasis, avgCost, grossInvested, realizedPnl, isClosed }`(移动平均,`EPS=1e-9`)
- [x] 2.3 实现 `computeTotalPnl(state, latestPrice)` → `{ realizedPnl, unrealizedPnl, totalPnl, totalPnlPercent }`
- [x] 2.4 实现 `canDeleteBuy(txns, lotId)`:删除该买入后回放任意时点持股 ≥ 0 返回 true
- [x] 2.5 跑测试至全部通过并提交

## 3. 卖出 service

- [x] 3.1 写失败集成测试:`recordSell` 正常卖出、超卖拒绝、卖出日期早于最早买入拒绝
- [x] 3.2 在 `apps/web/lib/position-service.ts` 实现 `recordSell({symbol, shares, price, sellDate, notes, strategyId?})`:定位 position → 回放校验剩余股数 → 插入 `type='SELL'`
- [x] 3.3 `upsertPositionAndCreateLot` 内部插入显式带 `type:'BUY'`
- [x] 3.4 跑测试至通过并提交

## 4. 卖出端点

- [x] 4.1 写失败集成测试:`POST /api/positions/manual/sell` 正常 200 / 超卖 400
- [x] 4.2 创建 `apps/web/app/api/positions/manual/sell/route.ts`(body `{symbol, shares, price, sellDate, notes?}`)
- [x] 4.3 创建 `apps/web/app/api/strategies/[id]/lots/sell/route.ts`(同上,带 strategyId)
- [x] 4.4 跑测试至通过并提交

## 5. GET 端点扩展

- [x] 5.1 写失败测试:`/api/positions/manual` 返回含 `realizedPnl/unrealizedPnl/totalPnl/totalPnlPercent/isClosed/transactions`
- [x] 5.2 修改 `/api/positions/manual` 与 `/api/strategies/[id]/positions`:用 `pnl.ts` 回放,`lots` → 按时间排序的 `transactions`(含 `type`)
- [x] 5.3 跑测试至通过并提交

## 6. 历史曲线回放(`buildPnlHistory`)

- [x] 6.1 写失败测试:含卖出的多日序列断言每日 `percentPnl`(含已实现,清仓后不塌回 0)
- [x] 6.2 在 `pnl.ts` 实现 `buildPnlHistory(txns, snapshots)` → `Array<{date, percentPnl}>`(按日回放 + 价格 carry-forward)
- [x] 6.3 跑测试至通过并提交

## 7. 历史路由接入

- [x] 7.1 `/api/positions/history` 改用 `buildPnlHistory`,跳过 `grossInvested=0` 的日期
- [x] 7.2 `/api/strategies/[id]/history` 改用 `buildPnlHistory`,价格来源从 `monitoringRuns.prices` 切到 `price_snapshots`
- [x] 7.3 更新/补充 history 路由测试并跑通,提交

## 8. 删除买入守卫

- [x] 8.1 写失败测试:删除致负持股的 BUY 返回 409;删除 SELL 始终 200
- [x] 8.2 在 `apps/web/app/api/positions/manual/lots/[lotId]/route.ts` 与 `apps/web/app/api/lots/[lotId]/route.ts` 接入 `canDeleteBuy`,违例返回 409
- [x] 8.3 跑测试至通过并提交

## 9. SellForm 组件

- [x] 9.1 创建 `apps/web/components/sell-form.tsx`(类比 `lot-form.tsx`):字段 symbol(锁定)、股数、卖出价、日期、备注;前端校验股数 ≤ 剩余持股
- [x] 9.2 提交

## 10. 手动持仓 UI 接入

- [x] 10.1 `apps/web/components/manual-positions-tab.tsx`:卡片头部显示「总盈利 $X (Y%)」(红涨绿跌),已清仓徽章 + 停止价格轮询
- [x] 10.2 卡片下方渲染 `transactions` 操作历史时间线(BUY/SELL 标签 + 颜色 + 每行删除)
- [x] 10.3 卡片加「卖出」按钮打开 `SellForm`,成功后刷新
- [x] 10.4 提交

## 11. 策略持仓 UI 接入

- [x] 11.1 `apps/web/app/strategies/[id]/page.tsx` 持仓 Tab:复用与手动持仓一致的总盈利展示、操作历史时间线、卖出入口、已清仓徽章
- [x] 11.2 提交

## 12. 验证与上线

- [x] 12.1 全量测试:`pnpm --filter @trader/web test -- --run` 与 `packages/db` 测试全绿
- [x] 12.2 在数据库执行 `scripts/migrate-2026-06-03.sql`
- [x] 12.3 浏览器手动验证:买入→部分卖出→清仓的总盈利、操作历史、已清仓徽章、账户/策略历史曲线含已实现
- [x] 12.4 最终提交(若验证中有小修)
