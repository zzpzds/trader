## 1. 清理旧代码

- [x] 1.1 删除 `apps/web/app/workshop/` 目录（AI 对话策略生成页面）
- [x] 1.2 删除 `apps/web/app/backtest/` 目录（回测页面）
- [x] 1.3 删除 `apps/web/app/api/strategies/chat/` 目录（AI 策略生成接口）
- [x] 1.4 删除 `apps/web/app/api/backtests/` 目录（回测接口）
- [x] 1.5 删除 `apps/worker/src/backtest/` 目录（回测引擎）
- [x] 1.6 删除 `apps/worker/src/price/` 目录（AKShare 数据层）
- [x] 1.7 删除 `apps/worker/akshare_fetch.py`
- [x] 1.8 删除 `packages/db/src/strategy-schema.ts` 和 `strategy-types.ts`
- [x] 1.9 删除 `apps/web/lib/strategy-prompt.ts`
- [x] 1.10 更新 `packages/db/src/index.ts`，移除已删除文件的导出

## 2. 数据库 Schema 迁移

- [x] 2.1 重构 `packages/db/src/schema.ts`：移除 `backtests`、`priceCache` 表定义，重建 `strategies` 表（删除 config，新增 symbols/content/script）
- [x] 2.2 在 schema.ts 中新增 `positions` 表定义（id, strategy_id, symbol, created_at, updated_at, UNIQUE constraint）
- [x] 2.3 在 schema.ts 中新增 `position_lots` 表定义（id, position_id, shares, cost_price, lot_date, notes, created_at）
- [x] 2.4 在 schema.ts 中新增 `monitoring_runs` 表定义（id, strategy_id, run_date, status, analysis, has_action_items, prices JSONB, error, created_at）
- [x] 2.5 在 schema.ts 中新增 `notifications` 表定义（id, monitoring_run_id, title, content, is_read, created_at）
- [x] 2.6 生成并执行 Drizzle migration（`drizzle-kit generate` + `drizzle-kit migrate`）
- [x] 2.7 更新 `packages/db/src/index.ts` 导出所有新表类型

## 3. Python 数据服务

- [x] 3.1 创建 `apps/worker/yahoo_fetch.py`：接收 JSON stdin `{ symbols, period }`，使用 yfinance 拉取 OHLCV 数据，输出 JSON `{ symbol: { latest, bars[] } }`
- [x] 3.2 更新 `requirements.txt`：移除 `akshare`，新增 `yfinance>=0.2.40`
- [x] 3.3 创建 `apps/worker/src/monitoring/yahoo-fetch.ts`：封装 Python 子进程调用（复用 price/fetch.ts 的 spawn 模式，适配新的输入输出协议）

## 4. 策略 CRUD API

- [x] 4.1 重构 `apps/web/app/api/strategies/route.ts`：GET（策略列表）、POST（创建策略，接收 name/symbols/content/script）
- [x] 4.2 重构 `apps/web/app/api/strategies/[id]/route.ts`：GET（详情）、PUT（更新）、DELETE（删除）
- [x] 4.3 创建 `apps/web/app/api/strategies/parse/route.ts`：接收 Python 脚本文本，调用 Claude API tool_use（parse_strategy 工具），返回 `{ name, symbols, content }`

## 5. 持仓 CRUD API

- [x] 5.1 创建 `apps/web/app/api/strategies/[id]/positions/route.ts`：GET 获取策略所有持仓（含 lots + 最近监控价格）
- [x] 5.2 创建 `apps/web/app/api/strategies/[id]/lots/route.ts`：POST 新增 lot（自动 upsert position），body: `{ symbol, shares, costPrice, lotDate, notes }`
- [x] 5.3 创建 `apps/web/app/api/lots/[lotId]/route.ts`：PUT 编辑 lot、DELETE 删除 lot

## 6. 监控 Worker

- [x] 6.1 安装 `p-limit` 依赖到 `apps/worker`
- [x] 6.2 创建 `apps/worker/src/monitoring/analyze.ts`：组装监控 prompt，调用 Claude API tool_use（report_analysis 工具），返回 `{ analysis, has_action_items, action_summary }`
- [x] 6.3 创建 `apps/worker/src/monitoring/job.ts`：主监控逻辑，查询有持仓策略 → p-limit(3) 并发 → 写 pending → 调 yahoo-fetch → 调 analyze → 更新 completed/failed → 写通知
- [x] 6.4 重构 `apps/worker/src/worker.ts`：移除 run-backtest handler，注册 `daily-monitoring` cron job（`0 2 * * *` UTC）
- [x] 6.5 更新 `apps/worker/src/index.ts` 入口，确保监控模块正确引入

## 7. 监控与通知 API

- [x] 7.1 创建 `apps/web/app/api/monitoring/runs/route.ts`：GET 监控历史列表（支持 strategyId、date 过滤参数）
- [x] 7.2 创建 `apps/web/app/api/monitoring/runs/[id]/route.ts`：GET 监控运行详情
- [x] 7.3 创建 `apps/web/app/api/monitoring/trigger/route.ts`：POST 触发全部策略监控
- [x] 7.4 创建 `apps/web/app/api/monitoring/trigger/[strategyId]/route.ts`：POST 触发单个策略监控
- [x] 7.5 创建 `apps/web/app/api/notifications/route.ts`：GET 通知列表（含未读数）
- [x] 7.6 创建 `apps/web/app/api/notifications/[id]/read/route.ts`：PUT 标记单条已读
- [x] 7.7 创建 `apps/web/app/api/notifications/read-all/route.ts`：PUT 全部标记已读

## 8. 前端：策略库页面

- [x] 8.1 重构 `apps/web/app/strategies/page.tsx`：策略卡片列表（名称、symbols 标签、持仓数量、创建时间）
- [x] 8.2 创建策略注入面板组件（Tab：上传文件 / 粘贴代码）
- [x] 8.3 实现文件上传和代码粘贴逻辑，调用 `/api/strategies/parse` 展示解析结果（loading + 预览）
- [x] 8.4 实现 markdown 预览渲染和 symbols 标签编辑
- [x] 8.5 实现"确认保存"逻辑，调用 `POST /api/strategies` 并跳转详情页

## 9. 前端：策略详情页

- [x] 9.1 创建 `apps/web/app/strategies/[id]/page.tsx`：顶部信息（名称、symbols）+ 四个 Tab（描述/脚本/持仓/最近分析）
- [x] 9.2 实现"策略描述" Tab：渲染 markdown content（使用 react-markdown）
- [x] 9.3 实现"原始脚本" Tab：代码块展示 Python 脚本，支持复制
- [x] 9.4 实现"持仓" Tab：按 symbol 分组，展示 lots 列表（总股数/加权均价/最近监控价/盈亏%）+ 增删改 lot 操作
- [x] 9.5 实现"最近分析" Tab：展示该策略最近 10 次 monitoring_run，点击展开完整报告

## 10. 前端：持仓管理总览页

- [x] 10.1 创建 `apps/web/app/positions/page.tsx`：按策略分组展示所有持仓（股票代码/总股数/加权均价/最近监控价/盈亏%）
- [x] 10.2 实现从最近 monitoring_run.prices 快照计算盈亏的展示逻辑

## 11. 前端：监控中心页面

- [x] 11.1 创建 `apps/web/app/monitoring/page.tsx`：顶部统计（本周次数/建议次数/失败次数）+ 运行记录列表
- [x] 11.2 实现记录列表：日期、策略名、状态标签（completed/failed/pending）、是否有操作建议
- [x] 11.3 实现展开完整分析报告（markdown 渲染）
- [x] 11.4 实现按策略、日期范围过滤

## 12. 前端：通知面板

- [x] 12.1 在导航栏组件中集成通知铃铛图标，展示未读数角标（轮询或页面加载时拉取）
- [x] 12.2 实现通知下拉列表：标题、时间、已读状态
- [x] 12.3 实现点击通知跳转到 monitoring run 详情并标记已读
- [x] 12.4 实现"全部标记已读"按钮

## 13. 导航结构更新

- [x] 13.1 更新导航栏组件：移除旧菜单项（策略工坊/回测中心），新增策略库、持仓管理、监控中心
- [x] 13.2 更新根路由重定向到 `/strategies`
