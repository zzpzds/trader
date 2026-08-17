# Brainstorm Summary

- Change: fix-strategy-data-integrity
- Date: 2026-08-17
- Status: confirmed

## 确认的技术方案

- 第一阶段只修复两类数据完整性问题：Worker 将 `SELL` 错算为持仓，以及目标线上策略的 `symbols`、正文、脚本在 AIQ/AMKR 上不一致。
- 在 `packages/db` 新增纯交易回放模块，输入 `id/type/shares/price/date/createdAt`，输出 `heldShares/costBasis/avgCost/grossInvested/realizedPnl/isClosed`，沿用移动平均成本法。
- `apps/web/lib/pnl.ts` 保留为兼容层，复用并重新导出共享回放；Web 专用的总盈亏、删除校验和历史曲线继续留在该模块，现有调用方不更改导入路径。
- Worker 查询与映射完整保留 `id`、`type`、`lotDate`、`createdAt`，调用共享回放构造监控输入，不再正向累加全部 lot。
- 分析输入增加 `costBasis`、`realizedPnl`、`isClosed`；交易明细保留 BUY/SELL 类型及稳定排序字段。
- 完全卖出且未重新买入的 position 仍进入监控上下文，但明确标记为“已清仓”、当前 0 股、平均成本 0，并保留已实现盈亏；不得计算持仓收益率。重新买入后按完整历史自然回放。
- 热点任务继续只以 `strategies.symbols` 为机器字段，不从正文或脚本解析标的。
- 线上目标策略修正与代码部署分离：写入前 GET 并保存完整快照，只 PUT `symbols/content/script`，写入后回读确认 `NVDA/GOOGL/MSFT/META/AMKR`、无 AIQ，且 AMKR 为 T2 的 20% 首仓、10% 加仓。
- 本阶段不实现 H/B 双参考价、确定性 T1/T2 状态机、基本面证据管道或通知联动；未经再次确认，不写生产数据、不部署、不手动触发热点或监控。

## 关键取舍与风险

- 选择现有 `@trader/db` 承载共享纯函数，不复制 Worker 算法，也不新增 workspace 包；以小范围导出和测试接缝调整换取 Web/Worker 长期同口径。
- 共享函数假定交易已经通过领域校验；现有卖出 API 继续负责阻止超卖，本阶段不自动修复或改写历史异常交易。
- 老数据缺少 `type` 时继续按现有兼容语义视为 BUY；正常新数据必须保留真实 BUY/SELL 类型。
- 清仓文案必须绕过平均成本收益率计算，避免除零或输出 `Infinity`。
- 生产回读校验失败时立即停止后续任务，并可使用写入前快照通过同一 API 回滚。
- 工作区两项既有用户改动 `apps/web/lib/__tests__/skills.test.ts`、`packages/db/seed/skills/super-growth-alpha.md` 原样保留，不触碰、不纳入本变更。

## 测试策略

- 共享纯函数：覆盖纯买入、部分卖出、全部卖出、清仓后重新建仓、乱序输入、同日按 `createdAt` 排序。
- 固定示例：买入 5 股 @600、卖出 5 股 @660、再买入 5 股 @600，结果必须为持股 5、成本 3000、均价 600、已实现盈亏 300、未清仓。
- Web：保留现有 P&L 测试并从兼容层调用，证明抽取不改变页面/API 口径。
- Worker：使用包含 BUY/SELL 的数据库返回值运行 job，验证分析器收到正确聚合值与交易类型；清仓提示不得出现 `Infinity`。
- 热点：AIQ→AMKR 用例必须只调用 `AMKR stock news`，不得调用 `AIQ stock news`。
- 按 `@trader/db` → Web/Worker 顺序执行相关测试、类型检查和构建，最后核对工作区边界。
- 生产数据验证单独记录 GET 前后快照、PUT 载荷和回滚载荷；未获确认只生成载荷，不执行写入。

## Spec Patch

- 为 `daily-monitoring` 增加验收场景：完全清仓的 position 仍以 0 股、已实现盈亏和清仓状态进入分析，不得计算持仓收益率或产生 `Infinity`。

