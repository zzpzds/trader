---
comet_change: fix-strategy-data-integrity
role: technical-design
canonical_spec: openspec
archived-with: 2026-08-25-fix-strategy-data-integrity
status: final
---

# 策略数据完整性修复技术设计

## 目标与范围

本设计落实 `fix-strategy-data-integrity` 的第一阶段：统一 Web 与 Worker 的持仓交易回放口径，修复 Worker 将 `SELL` 当作新增持仓的错误，并为目标线上策略建立 AIQ → AMKR 的安全修正流程。

本阶段只修复数据输入的正确性，不改变交易策略本身的决策模型。H/B 双参考价、确定性 T1/T2 状态机、基本面证据管道、通知联动、数据库迁移和自动部署均不在本阶段范围内。

## 当前问题与正确性约束

Web 已在 `apps/web/lib/pnl.ts` 中按交易日期和创建时间回放 `BUY/SELL`，使用移动平均成本计算当前持股、成本基础和已实现盈亏。Worker 的 `apps/worker/src/monitoring/job.ts` 在数据库映射时丢弃了 `id`、`type` 和 `createdAt`，随后把所有批次的股数和金额正向相加。因此，只要 position 出现卖出交易，监控分析器收到的持股数量和平均成本就会错误。

修复必须保持以下不变量：

- 相同交易序列在 Web 与 Worker 中产生完全一致的 `heldShares`、`costBasis`、`avgCost`、`grossInvested`、`realizedPnl` 和 `isClosed`。
- 卖出按卖出发生前的移动平均成本释放成本基础；本阶段不切换到 FIFO 或 LIFO。
- 全部卖出后持股和成本基础归零，但已实现盈亏保留；重新买入后当前持仓只由重新买入及后续交易决定。
- 清仓 position 仍进入监控上下文，但不得以平均成本 0 计算持仓收益率，也不得在提示词中出现 `Infinity` 或 `NaN`。
- 热点任务只使用 `strategies.symbols` 作为机器可读标的范围，不从策略正文或脚本反向解析股票代码。

## 组件边界

数据流调整如下：

```text
position_lots
    │  id/type/shares/costPrice/lotDate/createdAt
    ▼
@trader/db/position-replay  ─────►  Web pnl 兼容层 ─────► 页面与 API
    │
    └────────────────────────────► Worker position mapper
                                      │
                                      ▼
                                PositionInfo / prompt
                                      │
                                      ▼
                                  监控分析器

strategies.symbols ─────────────► news job 查询范围
```

共享模块只负责确定性交易回放，不访问数据库、不获取行情、不生成提示词。Web 保留页面相关的总盈亏、删除校验和历史曲线逻辑；Worker 负责把数据库字符串字段转换为共享模块输入，并把回放结果转换为分析器输入。

## 共享交易回放模块

### 文件与导出

新增 `packages/db/src/position-replay.ts`，并在 `packages/db/package.json` 中增加独立导出：

```json
"./position-replay": {
  "types": "./dist/position-replay.d.ts",
  "import": "./dist/position-replay.js",
  "require": "./dist/position-replay.js"
}
```

Web 与 Worker 均从 `@trader/db/position-replay` 导入。该模块不再从 `@trader/db` 根入口重复导出，避免 Worker 测试对数据库 schema 的整包 mock 与纯函数模块耦合，也保持根入口的现有 schema API 不变。由于应用 TypeScript 路径指向 `packages/db/dist/*`，验证时必须先构建 `@trader/db`，再运行依赖该子路径的 Web/Worker 测试和构建。

### 接口

共享接口采用与数据库无关的普通值类型：

```ts
export type PositionTransactionType = "BUY" | "SELL";

export interface PositionTransaction {
  id: string;
  type?: PositionTransactionType | null;
  shares: number;
  price: number;
  date: string;
  createdAt?: string | Date | null;
}

export interface PositionReplayResult {
  heldShares: number;
  costBasis: number;
  avgCost: number;
  grossInvested: number;
  realizedPnl: number;
  isClosed: boolean;
}

export function replayPosition(
  transactions: readonly PositionTransaction[]
): PositionReplayResult;
```

`type` 允许缺失只用于兼容旧数据，并按现有语义归一为 `BUY`；新数据库记录仍必须保留真实的 `BUY/SELL`。若运行时出现除缺失值之外的未知类型，回放应抛出错误，避免把损坏数据静默解释为卖出。

### 排序与计算规则

函数复制输入后排序，不修改调用方数组。排序顺序为：

1. `date` 升序；
2. 同日按 `createdAt` 升序；
3. 日期和创建时间均相同时按 `id` 升序，保证 Web 与 Worker 不受数据库返回顺序影响。

计算规则保持现有 Web 语义：

- `BUY`：持股增加，成本基础增加 `shares × price`，`grossInvested` 只累计买入金额。
- `SELL`：先以卖出前 `costBasis / heldShares` 得到移动平均成本，已实现盈亏增加 `(sellPrice - avgCost) × shares`，再扣减相应持股和成本基础。
- 回放结束后，小于 `1e-9` 的残余持股视为浮点误差并归零；持股归零时成本基础同步归零。
- `avgCost` 只在持股大于误差阈值时计算，否则为 0。
- `isClosed` 仅在至少存在一条交易且最终持股为 0 时为 `true`；清仓后重新建仓的最终状态为 `false`。
- 共享模块不做金额展示舍入，舍入只发生在 UI 或提示词格式化边界。

输入假定已经通过现有领域校验，包括股数和价格为有效正数、卖出不超过当时持股。现有卖出 API 继续负责阻止超卖；本阶段不自动改写历史异常交易，也不新增 schema 约束。

## Web 兼容层

`apps/web/lib/pnl.ts` 保留原文件和原导入路径，避免修改页面及 API 调用方：

- 将 `TxnType`、`Txn`、`PositionPnl` 映射为共享类型的兼容别名，并重新导出 `replayPosition`。
- `computeTotalPnl`、`canDeleteBuy`、`DatedTxn`、`Snapshot` 和 `buildPnlHistory` 继续留在 Web 模块。
- `computeTotalPnl` 与 `buildPnlHistory` 调用共享回放函数，保持页面当前的总盈亏口径。
- `canDeleteBuy` 继续使用 Web 内部的时间排序做逐步负持仓校验；它不属于跨应用聚合契约。

现有 `apps/web/lib/__tests__/pnl.test.ts` 继续从 `../pnl` 导入，作为兼容性回归测试。这样既验证共享实现，也证明现有 Web 公共接口没有被破坏。

## Worker 映射与监控输入

### 数据查询与映射

`StrategyWithLots.positionLots` 扩展为保留以下数据库字段：

```ts
{
  id: string;
  type: "BUY" | "SELL" | null;
  shares: string;
  costPrice: string;
  lotDate: string;
  createdAt: Date | string | null;
  notes: string | null;
}
```

Drizzle schema 中 `type` 和 `createdAt` 当前均非空；类型中的可空形态只服务旧数据兼容。映射到共享模块时执行：

- `shares` 使用 `parseFloat` 转为 number；
- `costPrice` 映射为 `price`；
- `lotDate` 映射为 `date`；
- 缺失的 `type` 映射为 `BUY`；
- `id` 与 `createdAt` 原样保留用于稳定排序。

Worker 对每个 position 调用一次 `replayPosition`，以结果构造分析器输入，不再使用 `reduce` 对所有 lot 做正向求和。position 是否进入任务仍以存在交易记录为准，因此完全卖出的 position 不会被过滤掉。

### `PositionInfo` 契约

`apps/worker/src/monitoring/analyze.ts` 的输入扩展为：

```ts
export interface PositionInfo {
  symbol: string;
  totalShares: number;
  costBasis: number;
  avgCost: number;
  realizedPnl: number;
  isClosed: boolean;
  referencePrice?: number | null;
  lots: Array<{
    id: string;
    type: "BUY" | "SELL";
    shares: number;
    costPrice: number;
    lotDate: string;
    createdAt?: string | Date | null;
    notes?: string;
  }>;
}
```

`totalShares` 暂时保留命名以缩小调用方改动，但其值明确等于回放结果的 `heldShares`。`costBasis`、`realizedPnl` 和 `isClosed` 直接来自共享结果；明细中的类型和排序字段用于让分析器正确理解完整交易历史。

## 提示词中的清仓表示

持仓摘要按状态分支渲染：

- 未清仓：展示当前股数、平均成本、成本基础、已实现盈亏、参考价和最新价；只有 `avgCost > 1e-9` 且最新价是有限数值时，才计算当前持仓相对平均成本的收益率。
- 已清仓：明确展示“已清仓 / 当前 0 股 / 成本基础 $0 / 已实现盈亏”，可保留参考价和最新价作为上下文，但写明“当前持仓收益率不适用”。该分支不执行除法。

清仓 position 继续出现在 `## 当前持仓` 区块中。这样监控可以利用已实现盈亏和历史交易判断后续策略，但不会把历史卖出误认为当前仓位。若行情缺失，最新价展示为 `N/A`，不影响清仓状态和已实现盈亏。

提示词同时增加 `## 交易历史` 区块。每个 position 的 lots 按 `lotDate`、`createdAt`、`id` 排序后展示 `BUY/SELL`、股数、成交价和日期；这使前述交易类型与稳定排序字段真正进入 LLM 上下文，而不只是停留在 TypeScript 对象中。

## 热点查询与目标策略一致性

`apps/worker/src/news/job.ts` 的运行逻辑不需要修改：它已经逐项读取 `strategy.symbols` 并生成 `${symbol} stock news`。新增回归测试使用替换后的目标配置，断言会调用 `AMKR stock news`，且不会调用 `AIQ stock news`。

测试不从正文或脚本推断标的，目的是锁定 `strategies.symbols` 的规范字段地位。线上修正后，目标策略三个字段应满足：

- `symbols` 精确为 `NVDA, GOOGL, MSFT, META, AMKR`；
- 正文不含 AIQ，并说明 AMKR 使用 T2、总仓位 10k、首次建仓 20%、后续每次加仓 10%；
- 脚本不含 AIQ/T1 的残留，并与正文使用相同的 AMKR/T2 仓位参数。

## 生产数据修正流程

生产数据修正与代码实现、部署分开执行。没有用户对生产写入的再次明确确认时，只准备和审阅载荷，不发送 PUT、不部署，也不手动触发热点或监控任务。

获得确认后的执行顺序为：

1. 立即 GET `bd181ef3-298c-487c-bc02-c0bb69664912`，校验返回 ID，并保存写入前的 `symbols/content/script/updatedAt` 快照。
2. 基于该最新快照生成部分 PUT 载荷，只包含 `symbols`、`content`、`script`，不回写名称、调度、分析窗口或其他字段。
3. 发送 PUT 后立即再次 GET。
4. 对回读结果做结构化校验：标的列表精确匹配五个目标代码，三个字段均无 `AIQ`，正文与脚本均包含 AMKR、T2、20% 首仓和 10% 加仓语义。
5. 任一校验失败即停止，不触发下游任务。若本次生产确认同时包含失败回滚授权，则以写入前快照中的三个字段发送回滚 PUT 并再次回读；否则保留快照并请求用户决定。

由于当前 API 没有在本设计中声明乐观锁能力，写入前快照必须在实际变更窗口重新获取，不能复用设计阶段的旧响应。部分 PUT 可避免覆盖无关字段；回滚同样只恢复这三个目标字段。

## 错误处理与可观测性

- 共享回放是同步纯函数。未知交易类型直接抛错，由 Worker 现有 `processStrategy` 错误路径将 monitoring run 标记为失败并记录错误；不生成基于损坏持仓的 AI 结论。
- 无行情数据的现有 fallback 与失败逻辑保持不变。清仓 position 仍可读取行情，但其提示词不会依赖行情计算持仓收益率。
- 浮点误差只通过统一的 `1e-9` 阈值收敛，不在中间步骤按货币位数截断。
- 不记录新的用户敏感信息。生产快照仅用于本次配置变更审计，不包含请求头或环境密钥。
- 不修改或格式化与本 change 无关的现有工作区文件。

## Implementation Divergence

### 生产 AIQ → AMKR 配置写入按用户豁免收口

2026-08-17 的生产写入尝试在获得明确授权后因连接失败未到达服务器；紧随其后的只读 GET 证明线上 `symbols`、`content`、`script` 和 `updatedAt` 均未改变，因此未执行回滚。用户随后明确要求停止重试，并确认策略脚本/配置替换不再作为本次变更的验收阻塞项。

因此，本次实施与验证仅将“共享持仓回放、Worker BUY/SELL 聚合修复、清仓安全渲染、以 `strategies.symbols` 为热点规范来源”视为已交付范围。线上策略仍保留 AIQ/T1 配置；不得将本次收口描述为生产 AMKR/T2 替换成功。已准备的 AMKR/T2 载荷和回滚快照只作为未来可选维护材料；若将来执行，必须重新获得明确生产写入授权，并重跑 fresh-GET 防漂移门。

## 测试设计

### 共享模块

新增 `packages/db/src/position-replay.test.ts`，覆盖：

- 纯买入与加权平均成本；
- 部分卖出后持股、成本基础、平均成本和已实现盈亏；
- 全部卖出后 `heldShares = 0`、`costBasis = 0`、`isClosed = true`；
- 清仓后重新建仓；
- 输入乱序；
- 同日交易按 `createdAt` 排序，以及最终 `id` 决胜顺序；
- 缺失 `type` 按 BUY 兼容；
- 未知运行时类型抛错。

固定业务样例为：买入 5 股 @600、卖出 5 股 @660、再买入 5 股 @600。预期持股 5、成本基础 3000、平均成本 600、已实现盈亏 300、`isClosed = false`。

### Web

保留并运行现有 `apps/web/lib/__tests__/pnl.test.ts`。必要时只补充共享类型兼容断言，不迁移调用方测试路径。现有纯买入、部分卖出、全部清仓、总盈亏、删除限制和历史曲线用例必须继续通过。

### Worker

- 在 `apps/worker/src/monitoring/__tests__/job.test.ts` 增加包含 BUY、SELL 和 `createdAt` 的数据库返回值，检查传给分析器的 `totalShares/costBasis/avgCost/realizedPnl/isClosed` 及 lots 类型。
- 增加清仓后重新建仓样例，结果必须与共享模块固定样例一致。
- 在 `apps/worker/src/monitoring/__tests__/analyze.test.ts` 检查清仓摘要包含 0 股、已实现盈亏和“收益率不适用”，且完整请求文本不含 `Infinity` 或 `NaN`。
- 在 `apps/worker/src/news/__tests__/job.test.ts` 增加 AIQ → AMKR 用例，断言只生成 AMKR 查询。

### 执行顺序

验证顺序固定为：

1. 运行 `@trader/db` 新增及全量测试；
2. 构建 `@trader/db`，生成新的子路径产物和声明文件；
3. 运行 Web P&L 相关测试；
4. 运行 Worker monitoring/analyze/news 相关测试；
5. 构建 Worker 和 Web；
6. 运行必要的工作区全量测试，并核对 git diff 只包含当前 change 文件与已知用户改动。

生产 API 的 GET/PUT/回读记录独立于代码测试。没有生产写入确认时，验证报告应明确标记“载荷已准备、生产写入待确认”，不能把未执行的线上修正报告为已完成。

## 文件影响清单

预计实现阶段涉及：

- `packages/db/src/position-replay.ts`
- `packages/db/src/position-replay.test.ts`
- `packages/db/package.json`
- `apps/web/lib/pnl.ts`
- `apps/web/lib/__tests__/pnl.test.ts`（仅在兼容性断言需要时）
- `apps/worker/src/monitoring/job.ts`
- `apps/worker/src/monitoring/analyze.ts`
- `apps/worker/src/monitoring/__tests__/job.test.ts`
- `apps/worker/src/monitoring/__tests__/analyze.test.ts`
- `apps/worker/src/news/__tests__/job.test.ts`

不涉及数据库 schema、迁移文件或生产部署配置。

## 完成标准

- Web 与 Worker 对全部受支持交易序列使用同一共享回放函数并产出一致结果。
- Worker 的卖出记录不再增加持股或成本，交易明细保留 BUY/SELL 和稳定排序信息。
- 完全清仓的 position 安全进入分析上下文，保留已实现盈亏且不计算当前持仓收益率。
- 热点测试证明保存后的 AMKR 标的驱动查询，AIQ 不再进入目标策略的热点范围。
- 相关测试和构建通过；未获额外确认前，生产策略不被写入且系统不被部署。
