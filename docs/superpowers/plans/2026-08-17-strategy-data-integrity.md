---
change: fix-strategy-data-integrity
design-doc: docs/superpowers/specs/2026-08-17-strategy-data-integrity-design.md
base-ref: 778a7f54639f1a561d5a8effba25f6adf2a6dbd7
---

# 策略数据完整性修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Web 与 Worker 使用同一交易回放语义，修复 Worker 的 SELL 聚合和清仓提示词问题，并准备可审计、需再次确认后才能执行的 AIQ → AMKR 线上配置修正。

**Architecture:** 在 `@trader/db/position-replay` 新增无数据库副作用的纯回放模块，Web 通过现有 `pnl.ts` 兼容层复用，Worker 把完整 lot 映射到共享输入后再构造 `PositionInfo`。监控提示词分别渲染当前持仓与有序交易历史；热点查询仍只依赖 `strategies.symbols`。生产配置更新与代码提交分离，并以最新 GET 快照、部分 PUT、回读校验和可选回滚构成独立操作门。

**Tech Stack:** TypeScript 5.7、Vitest 2、npm workspaces、Drizzle ORM、Next.js 16、Node.js Worker、OpenSpec/Comet。

---

## 执行约束

- 不触碰或暂存既有用户改动 `apps/web/lib/__tests__/skills.test.ts` 与 `packages/db/seed/skills/super-growth-alpha.md`。
- `add-strategy-state-engine` 与 `connect-fundamental-evidence-monitoring` 只作为后续 change 保留，本计划不实现其中任务。
- 所有源码编辑使用 `apply_patch`；每次提交只 `git add` 本任务列出的精确路径。
- `@trader/db` 的应用导入解析到 `dist/*`，所以任何 Web/Worker 测试和构建前必须先完成 `npm run build -w @trader/db`。
- 生产 PUT、部署及手动触发热点/监控均不包含在自动执行范围；到达生产写入步骤时必须暂停并取得新的明确确认。

### Task 1: 建立共享持仓回放模块

**Files:**

- Create: `packages/db/src/position-replay.ts`
- Create: `packages/db/src/position-replay.test.ts`
- Modify: `packages/db/package.json`

- [x] **Step 1: 写共享回放的失败测试**

创建 `packages/db/src/position-replay.test.ts`，完整覆盖移动平均成本、清仓、重新建仓和确定性排序：

```ts
import { describe, expect, it } from "vitest";
import {
  replayPosition,
  type PositionTransaction,
} from "./position-replay";

function txn(
  id: string,
  type: "BUY" | "SELL" | null,
  shares: number,
  price: number,
  date: string,
  createdAt?: string
): PositionTransaction {
  return { id, type, shares, price, date, createdAt };
}

describe("replayPosition", () => {
  it("calculates weighted average cost for buys", () => {
    const result = replayPosition([
      txn("a", "BUY", 100, 10, "2026-01-01"),
      txn("b", "BUY", 100, 12, "2026-01-02"),
    ]);

    expect(result).toMatchObject({
      heldShares: 200,
      costBasis: 2200,
      avgCost: 11,
      grossInvested: 2200,
      realizedPnl: 0,
      isClosed: false,
    });
  });

  it("deducts a partial sell using moving average cost", () => {
    const result = replayPosition([
      txn("a", "BUY", 100, 10, "2026-01-01"),
      txn("b", "BUY", 100, 12, "2026-01-02"),
      txn("c", "SELL", 100, 15, "2026-01-03"),
    ]);

    expect(result.heldShares).toBe(100);
    expect(result.costBasis).toBeCloseTo(1100, 9);
    expect(result.avgCost).toBeCloseTo(11, 9);
    expect(result.realizedPnl).toBeCloseTo(400, 9);
    expect(result.isClosed).toBe(false);
  });

  it("keeps realized pnl when fully sold", () => {
    const result = replayPosition([
      txn("a", "BUY", 5, 600, "2026-05-11"),
      txn("b", "SELL", 5, 660, "2026-07-13"),
    ]);

    expect(result.heldShares).toBe(0);
    expect(result.costBasis).toBe(0);
    expect(result.avgCost).toBe(0);
    expect(result.realizedPnl).toBe(300);
    expect(result.isClosed).toBe(true);
  });

  it("replays full liquidation followed by re-entry", () => {
    const result = replayPosition([
      txn("a", "BUY", 5, 600, "2026-05-11"),
      txn("b", "SELL", 5, 660, "2026-07-13"),
      txn("c", "BUY", 5, 600, "2026-07-23"),
    ]);

    expect(result).toMatchObject({
      heldShares: 5,
      costBasis: 3000,
      avgCost: 600,
      realizedPnl: 300,
      isClosed: false,
    });
  });

  it("sorts by date, createdAt, then id without mutating input", () => {
    const input = [
      txn("b", "SELL", 5, 660, "2026-07-13", "2026-07-13T10:00:00Z"),
      txn("a", "BUY", 5, 600, "2026-07-13", "2026-07-13T09:00:00Z"),
    ];
    const originalOrder = input.map((item) => item.id);

    const result = replayPosition(input);

    expect(result.realizedPnl).toBe(300);
    expect(result.isClosed).toBe(true);
    expect(input.map((item) => item.id)).toEqual(originalOrder);
  });

  it("uses id as the final deterministic tie breaker", () => {
    const result = replayPosition([
      txn("b", "SELL", 5, 660, "2026-07-13", "2026-07-13T09:00:00Z"),
      txn("a", "BUY", 5, 600, "2026-07-13", "2026-07-13T09:00:00Z"),
    ]);

    expect(result.realizedPnl).toBe(300);
    expect(result.isClosed).toBe(true);
  });

  it("treats a missing legacy type as BUY", () => {
    const result = replayPosition([
      { id: "legacy", shares: 2, price: 100, date: "2026-01-01" },
    ]);

    expect(result.heldShares).toBe(2);
    expect(result.costBasis).toBe(200);
  });

  it("rejects an unknown runtime transaction type", () => {
    expect(() =>
      replayPosition([
        {
          id: "bad",
          type: "HOLD" as never,
          shares: 1,
          price: 100,
          date: "2026-01-01",
        },
      ])
    ).toThrow("Unknown position transaction type: HOLD");
  });
});
```

- [x] **Step 2: 运行测试并确认 RED**

Run:

```bash
npm run test -w @trader/db -- src/position-replay.test.ts
```

Expected: FAIL，错误指出 `./position-replay` 模块不存在。

- [x] **Step 3: 实现最小共享回放函数**

创建 `packages/db/src/position-replay.ts`：

```ts
const EPS = 1e-9;

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

function createdAtMillis(value: string | Date | null | undefined): number {
  if (value == null) return 0;
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function orderedTransactions(
  transactions: readonly PositionTransaction[]
): PositionTransaction[] {
  return [...transactions].sort((left, right) => {
    if (left.date !== right.date) return left.date < right.date ? -1 : 1;
    const createdAtDelta =
      createdAtMillis(left.createdAt) - createdAtMillis(right.createdAt);
    if (createdAtDelta !== 0) return createdAtDelta;
    return left.id.localeCompare(right.id);
  });
}

function normalizeType(
  type: PositionTransaction["type"]
): PositionTransactionType {
  if (type == null) return "BUY";
  if (type === "BUY" || type === "SELL") return type;
  throw new Error(`Unknown position transaction type: ${String(type)}`);
}

export function replayPosition(
  transactions: readonly PositionTransaction[]
): PositionReplayResult {
  let heldShares = 0;
  let costBasis = 0;
  let grossInvested = 0;
  let realizedPnl = 0;

  for (const transaction of orderedTransactions(transactions)) {
    if (normalizeType(transaction.type) === "BUY") {
      heldShares += transaction.shares;
      costBasis += transaction.shares * transaction.price;
      grossInvested += transaction.shares * transaction.price;
      continue;
    }

    const avgCost = heldShares > EPS ? costBasis / heldShares : 0;
    realizedPnl += (transaction.price - avgCost) * transaction.shares;
    costBasis -= avgCost * transaction.shares;
    heldShares -= transaction.shares;
  }

  if (heldShares < EPS) {
    heldShares = 0;
    costBasis = 0;
  }

  return {
    heldShares,
    costBasis,
    avgCost: heldShares > EPS ? costBasis / heldShares : 0,
    grossInvested,
    realizedPnl,
    isClosed: transactions.length > 0 && heldShares < EPS,
  };
}
```

- [x] **Step 4: 暴露独立 package 子路径**

在 `packages/db/package.json` 的 `exports` 中，在 `./schema` 后加入：

```json
"./position-replay": {
  "types": "./dist/position-replay.d.ts",
  "import": "./dist/position-replay.js",
  "require": "./dist/position-replay.js"
}
```

不要修改 `packages/db/src/index.ts`；共享模块只从独立子路径导出。

- [x] **Step 5: 运行测试和构建并确认 GREEN**

Run:

```bash
npm run test -w @trader/db -- src/position-replay.test.ts
npm run test -w @trader/db
npm run build -w @trader/db
```

Expected: 三条命令全部成功；`packages/db/dist/position-replay.js` 与 `.d.ts` 生成。

- [x] **Step 6: 勾选 OpenSpec 1.1 与共享回放相关的 1.3，并提交**

只勾选已经由本任务测试证明的条目。提交命令：

```bash
git add packages/db/src/position-replay.ts packages/db/src/position-replay.test.ts packages/db/package.json openspec/changes/fix-strategy-data-integrity/tasks.md
git commit -m "feat(db): add shared position replay"
```

### Task 2: 将 Web P&L 改为共享实现的兼容层

**Files:**

- Modify: `apps/web/lib/pnl.ts`
- Modify: `apps/web/lib/__tests__/pnl.test.ts`

- [ ] **Step 1: 阅读本仓库要求的 Next.js 指南**

Run:

```bash
cat node_modules/next/dist/docs/01-app/index.md
```

Expected: 确认本任务只修改普通 TypeScript library，不引入或变更 Next.js framework API。

- [ ] **Step 2: 写兼容层委托的失败测试**

在 `apps/web/lib/__tests__/pnl.test.ts` 增加共享函数导入：

```ts
import { replayPosition as sharedReplayPosition } from "@trader/db/position-replay";
```

在 `describe("replayPosition")` 开头增加：

```ts
it("delegates replay to the shared db module", () => {
  expect(replayPosition).toBe(sharedReplayPosition);
});
```

- [ ] **Step 3: 构建 DB 并运行 Web 测试确认 RED**

Run:

```bash
npm run build -w @trader/db
npm run test -w @trader/web -- lib/__tests__/pnl.test.ts
```

Expected: DB 构建成功；Web 测试只在新断言处 FAIL，因为当前 `pnl.ts` 仍定义自己的 `replayPosition`。

- [ ] **Step 4: 将 `pnl.ts` 顶部替换为兼容导入和类型别名**

保留 `EPS`、`sortTxns` 以及 Web 专用函数，删除本地 `PositionPnl` 接口与本地 `replayPosition` 实现，并在文件顶部使用：

```ts
import {
  replayPosition,
  type PositionReplayResult,
  type PositionTransaction,
  type PositionTransactionType,
} from "@trader/db/position-replay";

export { replayPosition };

const EPS = 1e-9;

export type TxnType = PositionTransactionType;

export interface Txn extends PositionTransaction {
  type: TxnType;
}

export type PositionPnl = PositionReplayResult;
```

`computeTotalPnl` 和 `buildPnlHistory` 继续调用当前文件绑定的 `replayPosition`；`canDeleteBuy` 继续调用本文件私有的 `sortTxns`。

- [ ] **Step 5: 运行 Web 回归测试和构建**

Run:

```bash
npm run build -w @trader/db
npm run test -w @trader/web -- lib/__tests__/pnl.test.ts
npm run build -w @trader/web
```

Expected: P&L 测试全部 PASS；Next.js build 成功，页面/API 现有导入不需要修改。

- [ ] **Step 6: 勾选 OpenSpec 1.2，确认 1.3 全部覆盖后提交**

```bash
git add apps/web/lib/pnl.ts apps/web/lib/__tests__/pnl.test.ts openspec/changes/fix-strategy-data-integrity/tasks.md
git commit -m "refactor(web): reuse shared position replay"
```

### Task 3: 修复 Worker 的 BUY/SELL 聚合输入

**Files:**

- Modify: `apps/worker/src/monitoring/job.ts`
- Modify: `apps/worker/src/monitoring/analyze.ts`
- Modify: `apps/worker/src/monitoring/__tests__/job.test.ts`

- [ ] **Step 1: 写 Worker 重新建仓回放的失败测试**

在 `apps/worker/src/monitoring/__tests__/job.test.ts` 的 `describe("runMonitoringJob")` 中增加：

```ts
it("replays BUY, SELL, and re-entry before calling analyze", async () => {
  mockAnalyze.mockReset();
  mockAnalyze.mockResolvedValueOnce({
    analysis: "ok",
    hasActionItems: false,
    referencePriceUpdates: [],
    suggestedSkills: [],
  });

  const setMock = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue({}),
  });
  const updateMock = vi.fn().mockReturnValue({ set: setMock });
  const insertReturning = vi.fn().mockResolvedValue([{ id: "run-replay" }]);
  const insertMock = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({ returning: insertReturning }),
  });

  const mockDb = {
    query: {
      strategies: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "strategy-replay",
            name: "Replay strategy",
            content: "rules",
            symbols: ["META"],
            analysisWindowDays: 30,
          },
        ]),
      },
      positions: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "position-meta",
            symbol: "META",
            referencePrice: null,
            positionLots: [
              {
                id: "buy-1",
                type: "BUY",
                shares: "5",
                costPrice: "600",
                lotDate: "2026-05-11",
                createdAt: new Date("2026-05-11T09:00:00Z"),
                notes: null,
              },
              {
                id: "sell-1",
                type: "SELL",
                shares: "5",
                costPrice: "660",
                lotDate: "2026-07-13",
                createdAt: new Date("2026-07-13T09:00:00Z"),
                notes: "full exit",
              },
              {
                id: "buy-2",
                type: "BUY",
                shares: "5",
                costPrice: "600",
                lotDate: "2026-07-23",
                createdAt: new Date("2026-07-23T09:00:00Z"),
                notes: "re-entry",
              },
            ],
          },
        ]),
      },
      skills: { findMany: vi.fn().mockResolvedValue([]) },
    },
    insert: insertMock,
    update: updateMock,
    select: makeSelect([
      {
        symbol: "META",
        date: "2026-08-16",
        open: "600",
        high: "610",
        low: "590",
        close: "605",
        volume: 1000n,
      },
    ]),
  } as any;

  await runMonitoringJob(mockDb);

  const positions = mockAnalyze.mock.calls[0][2];
  expect(positions).toHaveLength(1);
  expect(positions[0]).toMatchObject({
    symbol: "META",
    totalShares: 5,
    costBasis: 3000,
    avgCost: 600,
    realizedPnl: 300,
    isClosed: false,
  });
  expect(positions[0].lots.map((lot: any) => lot.type)).toEqual([
    "BUY",
    "SELL",
    "BUY",
  ]);
  expect(positions[0].lots[1]).toMatchObject({
    id: "sell-1",
    createdAt: new Date("2026-07-13T09:00:00Z"),
  });
});
```

- [ ] **Step 2: 运行 Worker 测试并确认 RED**

Run:

```bash
npm run build -w @trader/db
npm run test -w @trader/worker -- src/monitoring/__tests__/job.test.ts
```

Expected: 新用例 FAIL；实际 `totalShares` 为 15，且分析输入缺少 `costBasis`、`realizedPnl`、`isClosed` 和 lot 类型。

- [ ] **Step 3: 扩展 Worker 数据契约**

在 `apps/worker/src/monitoring/job.ts` 增加：

```ts
import {
  replayPosition,
  type PositionTransactionType,
} from "@trader/db/position-replay";
```

把 `StrategyWithLots.positionLots` 改为：

```ts
positionLots: Array<{
  id: string;
  type: PositionTransactionType | null;
  shares: string;
  costPrice: string;
  lotDate: string;
  createdAt: Date | string | null;
  notes: string | null;
}>;
```

在数据库结果映射中完整保留字段：

```ts
positionLots: p.positionLots.map((lot) => ({
  id: lot.id,
  type: lot.type ?? "BUY",
  shares: lot.shares,
  costPrice: lot.costPrice,
  lotDate: lot.lotDate,
  createdAt: lot.createdAt,
  notes: lot.notes,
})),
```

在 `apps/worker/src/monitoring/analyze.ts` 中定义并使用：

```ts
export interface PositionLotInfo {
  id: string;
  type: "BUY" | "SELL";
  shares: number;
  costPrice: number;
  lotDate: string;
  createdAt?: string | Date | null;
  notes?: string;
}

export interface PositionInfo {
  symbol: string;
  totalShares: number;
  costBasis: number;
  avgCost: number;
  realizedPnl: number;
  isClosed: boolean;
  referencePrice?: number | null;
  lots: PositionLotInfo[];
}
```

- [ ] **Step 4: 用共享回放替换 Worker 的正向求和**

将 `positionInfos` 映射中的两个 `reduce` 删除，替换为：

```ts
const positionInfos: PositionInfo[] = strategy.positions.map((position) => {
  const lots = position.positionLots.map((lot) => ({
    id: lot.id,
    type: lot.type ?? "BUY",
    shares: parseFloat(lot.shares),
    costPrice: parseFloat(lot.costPrice),
    lotDate: lot.lotDate,
    createdAt: lot.createdAt,
    notes: lot.notes ?? undefined,
  }));

  const replay = replayPosition(
    lots.map((lot) => ({
      id: lot.id,
      type: lot.type,
      shares: lot.shares,
      price: lot.costPrice,
      date: lot.lotDate,
      createdAt: lot.createdAt,
    }))
  );

  return {
    symbol: position.symbol,
    totalShares: replay.heldShares,
    costBasis: replay.costBasis,
    avgCost: replay.avgCost,
    realizedPnl: replay.realizedPnl,
    isClosed: replay.isClosed,
    referencePrice:
      position.referencePrice !== null
        ? parseFloat(position.referencePrice)
        : null,
    lots,
  };
});
```

- [ ] **Step 5: 运行 Worker job 测试并确认 GREEN**

Run:

```bash
npm run build -w @trader/db
npm run test -w @trader/worker -- src/monitoring/__tests__/job.test.ts
```

Expected: 新用例得到持股 5、成本 3000、均价 600、已实现盈亏 300，原有 job 测试也全部 PASS。

- [ ] **Step 6: 勾选 OpenSpec 2.1、2.2、2.3 并提交**

```bash
git add apps/worker/src/monitoring/job.ts apps/worker/src/monitoring/analyze.ts apps/worker/src/monitoring/__tests__/job.test.ts openspec/changes/fix-strategy-data-integrity/tasks.md
git commit -m "fix(worker): replay monitoring transactions"
```

### Task 4: 安全渲染清仓状态和交易历史

**Files:**

- Modify: `apps/worker/src/monitoring/analyze.ts`
- Modify: `apps/worker/src/monitoring/__tests__/analyze.test.ts`

- [ ] **Step 1: 为现有 analyzer 测试补齐强类型 fixtures**

将测试导入改为：

```ts
import {
  createAnalyzer,
  type PositionInfo,
  type PositionLotInfo,
} from "../analyze.js";
```

在 `mockClient` 后增加：

```ts
function position(overrides: Partial<PositionInfo> = {}): PositionInfo {
  return {
    symbol: "QQQ",
    totalShares: 10,
    costBasis: 1000,
    avgCost: 100,
    realizedPnl: 0,
    isClosed: false,
    lots: [],
    ...overrides,
  };
}

function lot(overrides: Partial<PositionLotInfo> = {}): PositionLotInfo {
  return {
    id: "lot-1",
    type: "BUY",
    shares: 10,
    costPrice: 100,
    lotDate: "2026-01-01",
    createdAt: "2026-01-01T09:00:00Z",
    ...overrides,
  };
}
```

把本文件每个传给 `analyze` 的内联 position 改成 `position({ ... })`。原来非空的 lot 改成 `lot({ shares, costPrice, lotDate })`，所有测试原有 symbol、股数、均价和参考价保持不变。

- [ ] **Step 2: 写清仓提示词与交易类型的失败测试**

在 `describe("analyzeStrategy")` 中增加：

```ts
it("renders a closed position without Infinity and includes ordered transaction types", async () => {
  const client = mockClient(
    makeToolUseResponse({ analysis: "ok", has_action_items: false })
  );
  const analyze = createAnalyzer(client);

  await analyze(
    "Closed strategy",
    "rules",
    [
      position({
        symbol: "META",
        totalShares: 0,
        costBasis: 0,
        avgCost: 0,
        realizedPnl: 300,
        isClosed: true,
        lots: [
          lot({
            id: "sell",
            type: "SELL",
            shares: 5,
            costPrice: 660,
            lotDate: "2026-07-13",
            createdAt: "2026-07-13T09:00:00Z",
          }),
          lot({
            id: "buy",
            type: "BUY",
            shares: 5,
            costPrice: 600,
            lotDate: "2026-05-11",
            createdAt: "2026-05-11T09:00:00Z",
          }),
        ],
      }),
    ],
    { META: { latest: 556.71, bars: [] } }
  );

  const prompt = (client.messages.create as any).mock.calls[0][0]
    .messages[0].content as string;
  expect(prompt).toContain("META: 已清仓");
  expect(prompt).toContain("当前 0 shares");
  expect(prompt).toContain("已实现盈亏 $300.00");
  expect(prompt).toContain("当前持仓收益率不适用");
  expect(prompt).not.toContain("Infinity");
  expect(prompt).not.toContain("NaN");
  expect(prompt.indexOf("BUY 5 shares @ $600.00")).toBeLessThan(
    prompt.indexOf("SELL 5 shares @ $660.00")
  );
});
```

- [ ] **Step 3: 运行 analyzer 测试并确认 RED**

Run:

```bash
npm run build -w @trader/db
npm run test -w @trader/worker -- src/monitoring/__tests__/analyze.test.ts
```

Expected: 新用例 FAIL；旧逻辑会对平均成本 0 做除法，且没有清仓文案或交易历史区块。

- [ ] **Step 4: 实现有序交易历史和分支式持仓摘要**

在 `analyze.ts` 增加：

```ts
const POSITION_EPS = 1e-9;

function createdAtMillis(value: string | Date | null | undefined): number {
  if (value == null) return 0;
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function orderedLots(lots: readonly PositionLotInfo[]): PositionLotInfo[] {
  return [...lots].sort((left, right) => {
    if (left.lotDate !== right.lotDate) {
      return left.lotDate < right.lotDate ? -1 : 1;
    }
    const createdAtDelta =
      createdAtMillis(left.createdAt) - createdAtMillis(right.createdAt);
    if (createdAtDelta !== 0) return createdAtDelta;
    return left.id.localeCompare(right.id);
  });
}
```

把 `positionSummary` 替换为：

```ts
const positionSummary = positions
  .map((position) => {
    const latestPrice = prices[position.symbol]?.latest;
    const hasLatestPrice =
      typeof latestPrice === "number" && Number.isFinite(latestPrice);
    const latestLabel = hasLatestPrice ? `$${latestPrice}` : "N/A";
    const referenceLabel =
      position.referencePrice != null
        ? `$${position.referencePrice.toFixed(2)}`
        : "无参考价";

    if (position.isClosed) {
      return `- ${position.symbol}: 已清仓，当前 0 shares，成本基础 $0.00，已实现盈亏 $${position.realizedPnl.toFixed(2)}，ref ${referenceLabel}，latest ${latestLabel}，当前持仓收益率不适用`;
    }

    const pnl =
      hasLatestPrice && position.avgCost > POSITION_EPS
        ? `${(((latestPrice - position.avgCost) / position.avgCost) * 100).toFixed(2)}%`
        : "N/A";
    return `- ${position.symbol}: ${position.totalShares} shares @ avg $${position.avgCost.toFixed(2)}，成本基础 $${position.costBasis.toFixed(2)}，已实现盈亏 $${position.realizedPnl.toFixed(2)}，ref ${referenceLabel}，latest ${latestLabel}，P&L ${pnl}`;
  })
  .join("\n");
```

新增交易历史文本：

```ts
const transactionHistory = positions
  .map((position) => {
    const lines = orderedLots(position.lots).map(
      (item) =>
        `- ${item.type} ${item.shares} shares @ $${item.costPrice.toFixed(2)} (${item.lotDate})`
    );
    return `### ${position.symbol}\n${lines.length > 0 ? lines.join("\n") : "- 无交易明细"}`;
  })
  .join("\n\n");
```

在 prompt 的 `## 当前持仓` 与 `## 近期价格数据` 之间插入：

```text
## 交易历史
${transactionHistory}
```

- [ ] **Step 5: 运行 analyzer、job 测试及 Worker 构建**

Run:

```bash
npm run build -w @trader/db
npm run test -w @trader/worker -- src/monitoring/__tests__/analyze.test.ts src/monitoring/__tests__/job.test.ts
npm run build -w @trader/worker
```

Expected: 所有测试 PASS；构建不再出现旧 `PositionInfo` fixture 缺字段错误，清仓 prompt 不含 `Infinity`/`NaN`。

- [ ] **Step 6: 提交提示词安全修复**

```bash
git add apps/worker/src/monitoring/analyze.ts apps/worker/src/monitoring/__tests__/analyze.test.ts
git commit -m "fix(worker): render closed positions safely"
```

### Task 5: 锁定热点任务的规范标的来源

**Files:**

- Modify: `apps/worker/src/news/__tests__/job.test.ts`

- [ ] **Step 1: 增加 AIQ → AMKR 回归测试**

在 `describe("runNewsJob")` 中增加：

```ts
it("queries AMKR and never AIQ after the saved symbol replacement", async () => {
  mockTavilyFetch.mockResolvedValue([]);
  mockSummarize.mockResolvedValue("AMKR summary");
  const { db } = makeDbMock([
    {
      id: "strategy-amkr",
      name: "AI strategy",
      content: "AMKR uses T2",
      symbols: ["NVDA", "GOOGL", "MSFT", "META", "AMKR"],
    },
  ]);

  await runNewsJob(db, { interLlmDelayMs: 0 });

  expect(mockTavilyFetch).toHaveBeenCalledWith("AMKR stock news");
  expect(mockTavilyFetch).not.toHaveBeenCalledWith("AIQ stock news");
});
```

- [ ] **Step 2: 运行热点测试并确认规范行为**

Run:

```bash
npm run test -w @trader/worker -- src/news/__tests__/job.test.ts
```

Expected: PASS。当前实现本就读取 `strategies.symbols`，此用例是 characterization test，用于防止未来回退到正文解析或旧 AIQ 配置；不修改 `apps/worker/src/news/job.ts`。

- [ ] **Step 3: 勾选 OpenSpec 3.1 并提交**

```bash
git add apps/worker/src/news/__tests__/job.test.ts openspec/changes/fix-strategy-data-integrity/tasks.md
git commit -m "test(worker): lock hotspot symbol source"
```

### Task 6: 获取最新线上快照并准备生产修正载荷

**Files:**

- Create: `openspec/changes/fix-strategy-data-integrity/production-update-plan.md`
- Modify: `openspec/changes/fix-strategy-data-integrity/tasks.md`

- [ ] **Step 1: 只读获取最新策略，禁止复用设计阶段响应**

Run:

```bash
curl --silent --show-error 'http://47.93.78.7/api/strategies/bd181ef3-298c-487c-bc02-c0bb69664912' -H 'Accept: */*' --insecure
```

Expected: HTTP 成功并返回 JSON；`id` 精确为 `bd181ef3-298c-487c-bc02-c0bb69664912`。若 ID、响应结构或策略内容与预期不符，停止本任务并报告，不准备 PUT。

- [ ] **Step 2: 用 `apply_patch` 创建可审计的生产更新计划**

在 `production-update-plan.md` 中记录实际抓取时间、实际 `updatedAt`，并原样保存最新响应中的 `symbols`、`content`、`script` 三个字段。随后写入两个完整 JSON 对象：

1. 部分 PUT 载荷只含 `symbols/content/script`；`symbols` 精确为 `NVDA, GOOGL, MSFT, META, AMKR`，正文和脚本均无 AIQ，并明确 AMKR 使用 T2、总仓位 10k、首次建仓 20%、后续每次加仓 10%。其他四个标的的原有规则逐字保留。
2. 回滚载荷只含 GET 快照中的原始 `symbols/content/script`，不得包含名称、调度、分析窗口或其他字段。

文档还需写明以下结构化检查：五个目标 symbols 精确匹配；三个目标字段不含 AIQ；正文/脚本均含 AMKR、T2、20% 和 10%；PUT 后 `updatedAt` 发生变化。

- [ ] **Step 3: 检查载荷但不发送生产写请求**

人工逐字段比对最新 GET 与两个 JSON 对象，确认部分 PUT 不会覆盖任何无关字段。本步骤禁止运行 `curl -X PUT`，禁止部署，禁止触发热点或监控任务。

- [ ] **Step 4: 勾选 OpenSpec 3.2 并提交只读证据**

```bash
git add openspec/changes/fix-strategy-data-integrity/production-update-plan.md openspec/changes/fix-strategy-data-integrity/tasks.md
git commit -m "docs: prepare AMKR production correction"
```

- [ ] **Step 5: 在生产写入决策点暂停**

向用户展示 PUT 载荷摘要、快照 `updatedAt` 和回滚边界，明确询问是否允许：发送一次部分 PUT、立即回读；校验失败时是否同时授权使用快照回滚。

用户未明确确认时：保持 OpenSpec 3.3 未勾选，不发送任何写请求，停止在本决策点。

用户明确确认时，才可执行文档中记录的完整部分 PUT，并立即重新 GET。回读全部检查通过后勾选 3.3；失败时停止下游动作，并仅在确认包含回滚授权时发送回滚载荷和再次回读。

### Task 7: 全量验证、任务收口与交付检查

**Files:**

- Modify: `openspec/changes/fix-strategy-data-integrity/tasks.md`
- Modify: `openspec/changes/fix-strategy-data-integrity/production-update-plan.md`（只记录实际生产决策及结果）

- [ ] **Step 1: 按依赖顺序执行相关测试**

Run:

```bash
npm run test -w @trader/db
npm run build -w @trader/db
npm run test -w @trader/web -- lib/__tests__/pnl.test.ts
npm run test -w @trader/worker -- src/monitoring/__tests__/job.test.ts src/monitoring/__tests__/analyze.test.ts src/news/__tests__/job.test.ts
```

Expected: 全部 PASS。固定样例在共享模块和 Worker job 中均得到持股 5、成本 3000、均价 600、已实现盈亏 300。

- [ ] **Step 2: 执行应用构建**

Run:

```bash
npm run build -w @trader/db
npm run build -w @trader/worker
npm run build -w @trader/web
```

Expected: 三个 workspace build 全部成功。

- [ ] **Step 3: 执行工作区测试**

Run:

```bash
npm test
```

Expected: 所有 workspace 测试成功。若出现与本 change 无关的既有失败，保存完整输出并按 Comet 异常调试协议先归因，不得静默忽略。

- [ ] **Step 4: 校验 OpenSpec 和工作区边界**

Run:

```bash
openspec validate fix-strategy-data-integrity --strict
git status --short
git diff --check
```

Expected: OpenSpec strict validation 成功，`git diff --check` 无错误；已知用户文件仍保持原状态且未进入本 change 的提交。

- [ ] **Step 5: 完成 OpenSpec 4.1、4.2、4.3 的证据记录**

在 `production-update-plan.md` 记录测试/构建结果和生产决策：

- 若用户授权且线上回读成功，记录前后 `updatedAt`、校验结果和未使用回滚载荷，勾选 3.3 与 4.3。
- 若用户尚未授权，明确记录“生产 PUT 未执行、回滚载荷已准备、上线步骤待确认”；3.3 保持未勾选，因此不要运行 build → verify 阶段守卫。

固定样例测试通过后勾选 4.2；所有测试与构建通过后勾选 4.1。

- [ ] **Step 6: 提交验证记录**

只暂存本 change 的验证产物：

```bash
git add openspec/changes/fix-strategy-data-integrity/tasks.md openspec/changes/fix-strategy-data-integrity/production-update-plan.md
git commit -m "chore: record strategy integrity verification"
```

- [ ] **Step 7: 执行所选代码审查模式和 Comet build 守卫**

若 `review_mode=standard`，在所有可执行任务完成后使用 Superpowers `requesting-code-review` 对 `base-ref..HEAD` 做一次轻量审查，先修复 CRITICAL 发现，再运行：

```bash
node "$COMET_GUARD" fix-strategy-data-integrity build --apply
```

Expected: 只有 OpenSpec 12 项任务全部勾选、生产条件任务已经真实完成、构建测试通过时守卫才推进到 verify。若生产 PUT 仍待确认，守卫不得运行，流程保持在 build 阶段。
