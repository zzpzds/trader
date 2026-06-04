## Why

当前系统只支持买入:`position_lots` 每行代表一次建仓,盈利只算未实现浮盈,没有卖出概念,也没有已实现盈利。用户无法记录减仓/清仓,也看不到落袋收益。本次引入买入/卖出统一机制,明确「已实现 + 未实现 = 总盈利」的口径。

## What Changes

- `position_lots` 增加 `type` 列(`'BUY' | 'SELL'`,默认 `'BUY'`),SELL 行复用现有列(`costPrice` 存卖出价、`shares` 存卖出股数、`lotDate` 存卖出日期)。
- 新增卖出端点 `POST /api/positions/manual/sell` 与 `POST /api/strategies/[id]/lots/sell`,走共享 `recordSell` service,校验剩余股数充足、日期/价格合法。
- 盈利计算改为按交易时间回放的移动平均口径:每只股票产出 `realizedPnl`、`unrealizedPnl`、`totalPnl`、`totalPnlPercent`、`isClosed`。回放算法抽到共享 `apps/web/lib/pnl.ts`。
- GET 端点(`/api/positions/manual`、`/api/strategies/[id]/positions`)返回上述盈利字段,并把 `lots` 改为按时间排序、带 `type` 的 `transactions`。
- P&L 历史曲线(账户级 `/api/positions/history`、策略级 `/api/strategies/[id]/history`)改为按日回放交易精确重算,曲线**包含已实现盈利**,清仓后不塌回 0。
- 删除买入若导致历史上某日持股为负 → 拒绝(409);删除卖出始终安全。
- UI:每个持仓卡片新增「卖出」按钮 + `SellForm`,卡片下方统一展示 BUY/SELL 操作历史时间线,卡片头部显示总盈利,已清仓标徽章。手动持仓与策略持仓两处都做。

## Capabilities

### New Capabilities
<!-- 无新增 capability,均为对现有能力的需求修改 -->

### Modified Capabilities
- `position-management`: 持仓批次从「仅买入」扩展为买入/卖出交易记录;新增卖出、操作历史时间线、已清仓状态、删除买入的持股非负守卫。
- `portfolio-pnl-summary`: 盈利口径从「仅未实现浮盈」改为「已实现 + 未实现 = 总盈利」,基于移动平均成本;总盈利% 以历史累计买入本金(grossInvested)为分母。
- `pnl-history-chart`: 历史曲线从「按当前持仓 × 历史价」改为「按日回放交易重算」,包含累计已实现盈利。

## Impact

- 数据库:`position_lots` 加一列,迁移脚本 `scripts/migrate-2026-06-03.sql`(`ALTER TABLE ... ADD COLUMN type text NOT NULL DEFAULT 'BUY'`,现有数据零风险)。
- 代码:`packages/db/src/schema.ts`、新增 `apps/web/lib/pnl.ts`、`apps/web/lib/position-service.ts`、买入/卖出/历史/删除相关 API 路由、`apps/web/components/manual-positions-tab.tsx`、`apps/web/components/sell-form.tsx`、`apps/web/app/strategies/[id]/page.tsx`。
- API:新增 2 个 sell 端点;GET 端点返回结构扩展(`lots` → `transactions`,新增盈利字段);delete-lot 端点新增 409 守卫。
- 测试:`apps/web/lib/__tests__/pnl.test.ts`(回放纯函数)、sell 端点集成测试、history 重算测试。
