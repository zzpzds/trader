## Why

持仓管理页只显示当前快照盈亏，用户无法了解整体持仓收益的汇总情况，也无法看到收益率随时间的变化趋势。现有监控运行数据已有按日期的价格快照，可以低成本地支持历史收益率曲线。

## What Changes

- **新增** 持仓管理页顶部的「总持仓收益」汇总卡片，展示所有策略合并的总成本、当前市值、绝对盈亏（$）和百分比收益率
- **新增** 持仓管理页汇总卡片下方的收益率历史折线图，支持 1M / 3M / 全部 时间范围切换
- **新增** 策略详情页「持仓」Tab 顶部的单策略收益率历史折线图，同样支持三档时间范围
- **新增** 两个 API 端点：`GET /api/positions/history` 和 `GET /api/strategies/[id]/history`，基于历史监控运行价格计算每日收益率

## Capabilities

### New Capabilities
- `portfolio-pnl-summary`: 持仓管理总览页头部汇总卡片，聚合所有策略的总成本、当前市值、绝对收益和百分比收益率，含加载/错误/无数据状态
- `pnl-history-chart`: 共享收益率历史折线图组件，用于持仓管理页（全量）和策略详情持仓 Tab（单策略），含时间范围切换、空数据提示和加载骨架屏

### Modified Capabilities
- `position-management`: 持仓管理总览页（Positions overview page）要求扩展——页面顶部新增汇总卡片和收益率图表

## Impact

- `apps/web/app/positions/page.tsx` — 新增汇总卡片和 PnlChart 组件
- `apps/web/app/strategies/[id]/page.tsx` — 持仓 Tab 顶部新增 PnlChart 组件
- `apps/web/components/pnl-chart.tsx` — 新建共享图表组件（Recharts）
- `apps/web/app/api/positions/history/route.ts` — 新建 API
- `apps/web/app/api/strategies/[id]/history/route.ts` — 新建 API
- `apps/web/app/api/positions/summary/route.ts` — 新建 API（汇总卡片数据源）
- `apps/web/package.json` — 新增 `recharts ^2.15.0` 依赖
