# 持仓买入/卖出机制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给持仓引入卖出机制(现有只有买入),买卖统一展示在每只股票的操作历史时间线,盈利按移动平均成本计算已实现+未实现合计。

**Architecture:** `position_lots` 加 `type` 列('BUY'/'SELL')区分买卖,卖出复用同表。盈利计算抽成纯函数 `apps/web/lib/pnl.ts`(按时间回放交易),被持仓列表 GET 和历史曲线两处复用。卖出走新 service 函数 `recordSell` + 两个对称端点(手动 / 策略)。历史曲线改为重放交易重建每日快照,价格源用 `price_snapshots`。

**Tech Stack:** Next.js (App Router, 见 apps/web/AGENTS.md 提示版本有破坏性变更), Drizzle ORM, PostgreSQL, Vitest, React 19 + Tailwind。迁移用手写 SQL 脚本(部署在阿里云 docker-compose,非 drizzle migrate)。

**口径定义(全程遵守):**
- 移动平均:`BUY` 累加股数/成本;`SELL` 时 `avg=costBasis/heldShares`,`realizedPnl+=(卖价-avg)*股数`,`costBasis-=avg*股数`,`heldShares-=股数`。
- 总盈利 = 已实现 + 未实现;未实现 = `最新价*剩余股数 - 剩余成本`。
- 总盈利% = `总盈利 / grossInvested * 100`,`grossInvested` = 历史所有 BUY 的 `股数*价` 之和。
- 百分比四舍五入:`Math.round(x * 10000) / 100`。
- 浮点比较用 `EPS = 1e-9`。
- 已清仓(heldShares≈0 且有交易):未实现=0,总盈利=已实现。

---

## Task 1: schema 加 `type` 列 + 迁移脚本

**Files:**
- Modify: `packages/db/src/schema.ts:52-64`
- Modify: `packages/db/src/schema.test.ts`
- Create: `scripts/migrate-2026-06-03.sql`

- [ ] **Step 1: 写失败测试**

在 `packages/db/src/schema.test.ts` 的 `positionLots table has required columns` 测试块之后(同一 describe 内)追加:

```ts
  it("positionLots has type column defaulting to BUY", () => {
    const columns = Object.keys(positionLots);
    expect(columns).toContain("type");
    const col = (positionLots as any).type;
    expect(col.notNull).toBe(true);
    expect(col.hasDefault).toBe(true);
    expect(col.default).toBe("BUY");
  });
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm --filter @trader/db test -- --run`
Expected: FAIL — `type` 列不存在。

- [ ] **Step 3: 改 schema**

在 `packages/db/src/schema.ts` 的 `positionLots` 定义里,`costPrice` 行下方加 `type` 列(注意:SELL 行的 `costPrice` 实际存卖出价):

```ts
export const positionLots = pgTable("position_lots", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  positionId: text("position_id")
    .notNull()
    .references(() => positions.id, { onDelete: "cascade" }),
  // 'BUY' | 'SELL'. SELL 行的 costPrice 存的是卖出价。
  type: text("type", { enum: ["BUY", "SELL"] }).notNull().default("BUY"),
  shares: numeric("shares", { precision: 15, scale: 4 }).notNull(),
  costPrice: numeric("cost_price", { precision: 15, scale: 4 }).notNull(),
  lotDate: text("lot_date").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm --filter @trader/db test -- --run`
Expected: PASS

- [ ] **Step 5: 写迁移脚本**

Create `scripts/migrate-2026-06-03.sql`:

```sql
-- 持仓买入/卖出机制:position_lots 增加 type 列
-- 现有数据全部视为 BUY(默认值),零风险
ALTER TABLE position_lots
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'BUY';
```

- [ ] **Step 6: 提交**

```bash
git add packages/db/src/schema.ts packages/db/src/schema.test.ts scripts/migrate-2026-06-03.sql
git commit -m "feat(db): add type column to position_lots for buy/sell"
```

---

## Task 2: pnl.ts 纯函数 — 单仓回放

**Files:**
- Create: `apps/web/lib/pnl.ts`
- Test: `apps/web/lib/__tests__/pnl.test.ts`

- [ ] **Step 1: 写失败测试**

Create `apps/web/lib/__tests__/pnl.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { replayPosition, computeTotalPnl, canDeleteBuy, type Txn } from "../pnl";

function buy(id: string, shares: number, price: number, date: string): Txn {
  return { id, type: "BUY", shares, price, date };
}
function sell(id: string, shares: number, price: number, date: string): Txn {
  return { id, type: "SELL", shares, price, date };
}

describe("replayPosition", () => {
  it("pure buys: held + avg + grossInvested", () => {
    const s = replayPosition([buy("a", 100, 10, "2026-01-01"), buy("b", 100, 12, "2026-01-02")]);
    expect(s.heldShares).toBe(200);
    expect(s.avgCost).toBeCloseTo(11, 9);
    expect(s.grossInvested).toBe(2200);
    expect(s.realizedPnl).toBe(0);
    expect(s.isClosed).toBe(false);
  });

  it("partial sell at moving average realizes gain, avg unchanged", () => {
    const s = replayPosition([
      buy("a", 100, 10, "2026-01-01"),
      buy("b", 100, 12, "2026-01-02"),
      sell("c", 100, 15, "2026-01-03"),
    ]);
    // avg at sell = 11; realized = (15-11)*100 = 400
    expect(s.realizedPnl).toBeCloseTo(400, 9);
    expect(s.heldShares).toBe(100);
    expect(s.avgCost).toBeCloseTo(11, 9);
    expect(s.costBasis).toBeCloseTo(1100, 9);
    expect(s.isClosed).toBe(false);
  });

  it("full liquidation marks closed and zeroes holdings", () => {
    const s = replayPosition([buy("a", 100, 10, "2026-01-01"), sell("b", 100, 15, "2026-01-02")]);
    expect(s.heldShares).toBe(0);
    expect(s.costBasis).toBe(0);
    expect(s.realizedPnl).toBeCloseTo(500, 9);
    expect(s.isClosed).toBe(true);
  });

  it("orders by date then createdAt regardless of input order", () => {
    const s = replayPosition([
      { id: "c", type: "SELL", shares: 50, price: 20, date: "2026-01-03" },
      { id: "a", type: "BUY", shares: 100, price: 10, date: "2026-01-01" },
    ]);
    expect(s.heldShares).toBe(50);
    expect(s.realizedPnl).toBeCloseTo(500, 9);
  });
});

describe("computeTotalPnl", () => {
  it("open position with price: unrealized + realized", () => {
    const state = replayPosition([
      buy("a", 100, 10, "2026-01-01"),
      buy("b", 100, 12, "2026-01-02"),
      sell("c", 100, 15, "2026-01-03"),
    ]);
    const r = computeTotalPnl(state, 13);
    // unrealized = 13*100 - 1100 = 200; total = 200 + 400 = 600; gross = 2200
    expect(r.unrealizedPnl).toBeCloseTo(200, 9);
    expect(r.totalPnl).toBeCloseTo(600, 9);
    expect(r.totalPnlPercent).toBeCloseTo(27.27, 2);
  });

  it("open position without price returns nulls", () => {
    const state = replayPosition([buy("a", 100, 10, "2026-01-01")]);
    expect(computeTotalPnl(state, null)).toEqual({
      unrealizedPnl: null,
      totalPnl: null,
      totalPnlPercent: null,
    });
  });

  it("closed position: total equals realized regardless of price", () => {
    const state = replayPosition([buy("a", 100, 10, "2026-01-01"), sell("b", 100, 15, "2026-01-02")]);
    const r = computeTotalPnl(state, null);
    expect(r.unrealizedPnl).toBe(0);
    expect(r.totalPnl).toBeCloseTo(500, 9);
    expect(r.totalPnlPercent).toBeCloseTo(50, 9);
  });
});

describe("canDeleteBuy", () => {
  const txns: Txn[] = [
    buy("a", 100, 10, "2026-01-01"),
    sell("b", 80, 15, "2026-01-02"),
  ];
  it("allows deleting a sell", () => {
    expect(canDeleteBuy(txns, "b")).toBe(true);
  });
  it("rejects deleting a buy that makes holdings go negative", () => {
    expect(canDeleteBuy(txns, "a")).toBe(false);
  });
  it("allows deleting a buy when holdings stay non-negative", () => {
    const ok: Txn[] = [buy("a", 100, 10, "2026-01-01"), buy("b", 100, 10, "2026-01-02"), sell("c", 50, 15, "2026-01-03")];
    expect(canDeleteBuy(ok, "a")).toBe(true);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm --filter @trader/web test -- --run pnl`
Expected: FAIL — `../pnl` 模块不存在。

- [ ] **Step 3: 实现 pnl.ts**

Create `apps/web/lib/pnl.ts`:

```ts
const EPS = 1e-9;

export type TxnType = "BUY" | "SELL";

export interface Txn {
  id: string;
  type: TxnType;
  shares: number;
  price: number;
  date: string; // YYYY-MM-DD
  createdAt?: string | Date | null;
}

export interface PositionPnl {
  heldShares: number;
  costBasis: number;
  avgCost: number;
  grossInvested: number;
  realizedPnl: number;
  isClosed: boolean;
}

function sortTxns(txns: Txn[]): Txn[] {
  return [...txns].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ca - cb;
  });
}

export function replayPosition(txns: Txn[]): PositionPnl {
  let heldShares = 0;
  let costBasis = 0;
  let grossInvested = 0;
  let realizedPnl = 0;

  for (const t of sortTxns(txns)) {
    if (t.type === "BUY") {
      heldShares += t.shares;
      costBasis += t.shares * t.price;
      grossInvested += t.shares * t.price;
    } else {
      const avg = heldShares > EPS ? costBasis / heldShares : 0;
      realizedPnl += (t.price - avg) * t.shares;
      costBasis -= avg * t.shares;
      heldShares -= t.shares;
    }
  }

  if (heldShares < EPS) {
    heldShares = 0;
    costBasis = 0;
  }
  const avgCost = heldShares > EPS ? costBasis / heldShares : 0;

  return {
    heldShares,
    costBasis,
    avgCost,
    grossInvested,
    realizedPnl,
    isClosed: txns.length > 0 && heldShares < EPS,
  };
}

export interface TotalPnl {
  unrealizedPnl: number | null;
  totalPnl: number | null;
  totalPnlPercent: number | null;
}

export function computeTotalPnl(
  state: PositionPnl,
  latestPrice: number | null
): TotalPnl {
  if (state.heldShares < EPS) {
    const pct =
      state.grossInvested > EPS
        ? Math.round((state.realizedPnl / state.grossInvested) * 10000) / 100
        : null;
    return { unrealizedPnl: 0, totalPnl: state.realizedPnl, totalPnlPercent: pct };
  }
  if (latestPrice == null) {
    return { unrealizedPnl: null, totalPnl: null, totalPnlPercent: null };
  }
  const unrealizedPnl = latestPrice * state.heldShares - state.costBasis;
  const totalPnl = state.realizedPnl + unrealizedPnl;
  const pct =
    state.grossInvested > EPS
      ? Math.round((totalPnl / state.grossInvested) * 10000) / 100
      : null;
  return { unrealizedPnl, totalPnl, totalPnlPercent: pct };
}

export function canDeleteBuy(txns: Txn[], lotId: string): boolean {
  const target = txns.find((t) => t.id === lotId);
  if (!target) return true;
  if (target.type === "SELL") return true;
  const remaining = txns.filter((t) => t.id !== lotId);
  let held = 0;
  for (const t of sortTxns(remaining)) {
    held += t.type === "BUY" ? t.shares : -t.shares;
    if (held < -EPS) return false;
  }
  return true;
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm --filter @trader/web test -- --run pnl`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/lib/pnl.ts apps/web/lib/__tests__/pnl.test.ts
git commit -m "feat(web): add pnl replay pure functions (moving average)"
```

---

## Task 3: position-service 加 `recordSell` + 买入带 type

**Files:**
- Modify: `apps/web/lib/position-service.ts`
- Modify: `apps/web/lib/__tests__/position-service.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/web/lib/__tests__/position-service.test.ts` 顶部 mock 里把 `positions` 的 query 加上 `findFirst` 已有;追加 `recordSell` import 与 describe。先把 import 行改为:

```ts
import { upsertPositionAndCreateLot, deleteLotAndCheckPosition, recordSell } from "../position-service";
```

然后在文件末尾追加:

```ts
describe("recordSell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when no position exists", async () => {
    (db.query.positions.findFirst as any).mockResolvedValueOnce(undefined);
    const r = await recordSell(null, "AAPL", 10, "150", "2026-05-01");
    expect(r.status).toBe(404);
    expect(r.error).toBeTruthy();
  });

  it("rejects selling more than held", async () => {
    (db.query.positions.findFirst as any).mockResolvedValueOnce({
      id: "p1",
      strategyId: null,
      symbol: "AAPL",
      positionLots: [
        { id: "l1", type: "BUY", shares: "10", costPrice: "100", lotDate: "2026-05-01", createdAt: new Date() },
      ],
    });
    const r = await recordSell(null, "AAPL", 20, "150", "2026-05-02");
    expect(r.status).toBe(400);
  });

  it("rejects sellDate before first buy", async () => {
    (db.query.positions.findFirst as any).mockResolvedValueOnce({
      id: "p1",
      strategyId: null,
      symbol: "AAPL",
      positionLots: [
        { id: "l1", type: "BUY", shares: "10", costPrice: "100", lotDate: "2026-05-10", createdAt: new Date() },
      ],
    });
    const r = await recordSell(null, "AAPL", 5, "150", "2026-05-01");
    expect(r.status).toBe(400);
  });

  it("inserts a SELL lot when valid", async () => {
    (db.query.positions.findFirst as any).mockResolvedValueOnce({
      id: "p1",
      strategyId: null,
      symbol: "AAPL",
      positionLots: [
        { id: "l1", type: "BUY", shares: "10", costPrice: "100", lotDate: "2026-05-01", createdAt: new Date() },
      ],
    });
    const lotInsert = mockValues(mockReturning([{ id: "sell-1" }]));
    (db.insert as any).mockReturnValue(lotInsert);

    const r = await recordSell(null, "AAPL", 5, "150", "2026-05-02", "trim");
    expect(r.status).toBe(201);
    expect(r.positionId).toBe("p1");
    expect(r.lot.id).toBe("sell-1");
    expect(lotInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({ positionId: "p1", type: "SELL", costPrice: "150", lotDate: "2026-05-02" })
    );
  });
});
```

并把顶部 `vi.mock("@/lib/db")` 中 `positions` 行确认含 `findFirst`(已有)。无需改其它 mock。

- [ ] **Step 2: 运行验证失败**

Run: `pnpm --filter @trader/web test -- --run position-service`
Expected: FAIL — `recordSell` 未导出。

- [ ] **Step 3: 实现**

修改 `apps/web/lib/position-service.ts`。顶部 import 改为:

```ts
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions, positionLots, type PositionLotRow } from "@trader/db";
import { replayPosition, type Txn, type TxnType } from "@/lib/pnl";
```

在 `upsertPositionAndCreateLot` 内插入 lot 处带上 `type: "BUY"`:

```ts
  const [lot] = await db
    .insert(positionLots)
    .values({ positionId, type: "BUY", shares, costPrice, lotDate, notes: notes ?? null })
    .returning();
```

在文件末尾(`deleteLotAndCheckPosition` 之后)新增:

```ts
export async function recordSell(
  strategyId: string | null,
  symbol: string,
  shares: number,
  price: string,
  sellDate: string,
  notes?: string
): Promise<{ positionId?: string; lot?: PositionLotRow; error?: string; status: number }> {
  const position = await db.query.positions.findFirst({
    where:
      strategyId === null
        ? and(isNull(positions.strategyId), eq(positions.symbol, symbol))
        : and(eq(positions.strategyId, strategyId), eq(positions.symbol, symbol)),
    with: { positionLots: true },
  });

  if (!position) {
    return { error: "no position to sell", status: 404 };
  }

  const lots = (position as any).positionLots as Array<{
    id: string;
    type: string | null;
    shares: string;
    costPrice: string;
    lotDate: string;
    createdAt: Date;
  }>;

  const buyDates = lots
    .filter((l) => (l.type ?? "BUY") === "BUY")
    .map((l) => l.lotDate)
    .sort();
  if (buyDates.length === 0 || sellDate < buyDates[0]) {
    return { error: "sellDate is before first buy", status: 400 };
  }

  const txns: Txn[] = lots.map((l) => ({
    id: l.id,
    type: (l.type as TxnType) ?? "BUY",
    shares: parseFloat(l.shares),
    price: parseFloat(l.costPrice),
    date: l.lotDate,
    createdAt: l.createdAt,
  }));
  const state = replayPosition(txns);

  if (shares > state.heldShares + 1e-9) {
    return { error: "cannot sell more shares than held", status: 400 };
  }

  const [lot] = await db
    .insert(positionLots)
    .values({
      positionId: position.id,
      type: "SELL",
      shares,
      costPrice: price,
      lotDate: sellDate,
      notes: notes ?? null,
    })
    .returning();

  return { positionId: position.id, lot, status: 201 };
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm --filter @trader/web test -- --run position-service`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/lib/position-service.ts apps/web/lib/__tests__/position-service.test.ts
git commit -m "feat(web): add recordSell service with oversell + date guards"
```

---

## Task 4: 卖出端点(手动 + 策略)

**Files:**
- Create: `apps/web/app/api/positions/manual/sell/route.ts`
- Test: `apps/web/app/api/positions/manual/sell/__tests__/route.test.ts`
- Create: `apps/web/app/api/strategies/[id]/lots/sell/route.ts`
- Test: `apps/web/app/api/strategies/[id]/lots/sell/__tests__/route.test.ts`

- [ ] **Step 1: 写失败测试(手动卖出)**

Create `apps/web/app/api/positions/manual/sell/__tests__/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRecordSell } = vi.hoisted(() => ({ mockRecordSell: vi.fn() }));
vi.mock("@/lib/position-service", () => ({ recordSell: mockRecordSell }));

import { POST } from "../route";

function postReq(body: any) {
  return new Request("http://localhost/api/positions/manual/sell", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/positions/manual/sell", () => {
  beforeEach(() => mockRecordSell.mockReset());

  it("records a sell and returns 201", async () => {
    mockRecordSell.mockResolvedValueOnce({ positionId: "p1", lot: { id: "s1" }, status: 201 });
    const res = await POST(postReq({ symbol: "aapl", shares: 5, price: "150", sellDate: "2026-06-01" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ positionId: "p1", lotId: "s1" });
    expect(mockRecordSell).toHaveBeenCalledWith(null, "AAPL", 5, "150", "2026-06-01", undefined);
  });

  it("returns 400 when shares <= 0", async () => {
    const res = await POST(postReq({ symbol: "AAPL", shares: 0, price: "150", sellDate: "2026-06-01" }));
    expect(res.status).toBe(400);
    expect(mockRecordSell).not.toHaveBeenCalled();
  });

  it("returns 400 when sellDate is in the future", async () => {
    const future = new Date(Date.now() + 86_400_000 * 2).toISOString().slice(0, 10);
    const res = await POST(postReq({ symbol: "AAPL", shares: 1, price: "150", sellDate: future }));
    expect(res.status).toBe(400);
    expect(mockRecordSell).not.toHaveBeenCalled();
  });

  it("propagates service error status (oversell -> 400)", async () => {
    mockRecordSell.mockResolvedValueOnce({ error: "cannot sell more shares than held", status: 400 });
    const res = await POST(postReq({ symbol: "AAPL", shares: 999, price: "150", sellDate: "2026-06-01" }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm --filter @trader/web test -- --run manual/sell`
Expected: FAIL — route 不存在。

- [ ] **Step 3: 实现手动卖出 route**

Create `apps/web/app/api/positions/manual/sell/route.ts`:

```ts
export const dynamic = "force-dynamic";
import { recordSell } from "@/lib/position-service";

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { symbol, shares, price, sellDate, notes } = body ?? {};

  if (typeof symbol !== "string" || symbol.trim() === "") {
    return Response.json({ error: "symbol required" }, { status: 400 });
  }
  if (typeof shares !== "number" || !(shares > 0)) {
    return Response.json({ error: "shares must be > 0" }, { status: 400 });
  }
  if (typeof price !== "string" || !(parseFloat(price) > 0)) {
    return Response.json({ error: "price must be > 0" }, { status: 400 });
  }
  const today = new Date().toISOString().slice(0, 10);
  if (typeof sellDate !== "string" || sellDate > today) {
    return Response.json({ error: "sellDate must be on or before today" }, { status: 400 });
  }

  const trimmedSymbol = symbol.trim().toUpperCase();
  const result = await recordSell(
    null,
    trimmedSymbol,
    shares,
    price,
    sellDate,
    typeof notes === "string" && notes.trim() !== "" ? notes.trim() : undefined
  );

  if (result.error) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ positionId: result.positionId, lotId: result.lot!.id }, { status: 201 });
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm --filter @trader/web test -- --run manual/sell`
Expected: PASS

- [ ] **Step 5: 写失败测试(策略卖出)**

Create `apps/web/app/api/strategies/[id]/lots/sell/__tests__/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRecordSell } = vi.hoisted(() => ({ mockRecordSell: vi.fn() }));
vi.mock("@/lib/position-service", () => ({ recordSell: mockRecordSell }));

import { POST } from "../route";

function postReq(body: any) {
  return new Request("http://localhost/api/strategies/s1/lots/sell", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ id: "strat-1" }) };

describe("POST /api/strategies/[id]/lots/sell", () => {
  beforeEach(() => mockRecordSell.mockReset());

  it("records a sell scoped to strategy and returns 201", async () => {
    mockRecordSell.mockResolvedValueOnce({ positionId: "p1", lot: { id: "s1" }, status: 201 });
    const res = await POST(postReq({ symbol: "qqq", shares: 5, price: "400", sellDate: "2026-06-01" }), ctx);
    expect(res.status).toBe(201);
    expect(mockRecordSell).toHaveBeenCalledWith("strat-1", "QQQ", 5, "400", "2026-06-01", undefined);
  });

  it("returns 400 when price <= 0", async () => {
    const res = await POST(postReq({ symbol: "QQQ", shares: 5, price: "0", sellDate: "2026-06-01" }), ctx);
    expect(res.status).toBe(400);
    expect(mockRecordSell).not.toHaveBeenCalled();
  });

  it("propagates service 404", async () => {
    mockRecordSell.mockResolvedValueOnce({ error: "no position to sell", status: 404 });
    const res = await POST(postReq({ symbol: "QQQ", shares: 5, price: "400", sellDate: "2026-06-01" }), ctx);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 6: 运行验证失败**

Run: `pnpm --filter @trader/web test -- --run lots/sell`
Expected: FAIL — route 不存在。

- [ ] **Step 7: 实现策略卖出 route**

Create `apps/web/app/api/strategies/[id]/lots/sell/route.ts`:

```ts
export const dynamic = "force-dynamic";
import { recordSell } from "@/lib/position-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: strategyId } = await params;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { symbol, shares, price, sellDate, notes } = body ?? {};

  if (typeof symbol !== "string" || symbol.trim() === "") {
    return Response.json({ error: "symbol required" }, { status: 400 });
  }
  if (typeof shares !== "number" || !(shares > 0)) {
    return Response.json({ error: "shares must be > 0" }, { status: 400 });
  }
  if (typeof price !== "string" || !(parseFloat(price) > 0)) {
    return Response.json({ error: "price must be > 0" }, { status: 400 });
  }
  const today = new Date().toISOString().slice(0, 10);
  if (typeof sellDate !== "string" || sellDate > today) {
    return Response.json({ error: "sellDate must be on or before today" }, { status: 400 });
  }

  const result = await recordSell(
    strategyId,
    symbol.trim().toUpperCase(),
    shares,
    price,
    sellDate,
    typeof notes === "string" && notes.trim() !== "" ? notes.trim() : undefined
  );

  if (result.error) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ positionId: result.positionId, lotId: result.lot!.id }, { status: 201 });
}
```

- [ ] **Step 8: 运行验证通过**

Run: `pnpm --filter @trader/web test -- --run lots/sell`
Expected: PASS

- [ ] **Step 9: 提交**

```bash
git add apps/web/app/api/positions/manual/sell apps/web/app/api/strategies/[id]/lots/sell
git commit -m "feat(web): add sell endpoints for manual and strategy positions"
```

---

## Task 5: GET 端点返回盈利字段 + 操作历史

**Files:**
- Modify: `apps/web/app/api/positions/manual/route.ts:8-52`
- Modify: `apps/web/app/api/positions/manual/__tests__/route.test.ts`
- Modify: `apps/web/app/api/strategies/[id]/positions/route.ts`
- Test: `apps/web/app/api/strategies/[id]/positions/__tests__/route.test.ts`(可能不存在,若无则创建)

- [ ] **Step 1: 改手动 GET 测试**

替换 `apps/web/app/api/positions/manual/__tests__/route.test.ts` 中第一个测试("returns NULL-strategy positions...")的断言,加入盈利字段与 transactions(含 SELL)。把该 it 整体替换为:

```ts
  it("returns positions with computed pnl and transactions timeline", async () => {
    findMany.mockResolvedValueOnce([
      {
        id: "p1",
        symbol: "AAPL",
        strategyId: null,
        positionLots: [
          { id: "l1", type: "BUY", shares: "10.0000", costPrice: "100.0000", lotDate: "2026-05-01", notes: null, createdAt: new Date("2026-05-01") },
          { id: "l2", type: "SELL", shares: "4.0000", costPrice: "150.0000", lotDate: "2026-05-10", notes: null, createdAt: new Date("2026-05-10") },
        ],
      },
    ]);
    snapshotSelect.mockReturnValueOnce(makeSelectChain([{ close: "175.0000" }]));

    const res = await GET(req());
    const data = await res.json();

    expect(data[0]).toMatchObject({ id: "p1", symbol: "AAPL", latestPrice: 175, isClosed: false });
    // realized = (150-100)*4 = 200; held = 6; cost = 600; unrealized = 175*6-600 = 450; total = 650
    expect(data[0].realizedPnl).toBeCloseTo(200, 6);
    expect(data[0].unrealizedPnl).toBeCloseTo(450, 6);
    expect(data[0].totalPnl).toBeCloseTo(650, 6);
    expect(data[0].transactions).toHaveLength(2);
    expect(data[0].transactions[0]).toMatchObject({ type: "BUY" });
  });
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm --filter @trader/web test -- --run "positions/manual/__tests__"`
Expected: FAIL — 缺 realizedPnl/transactions。

- [ ] **Step 3: 改手动 GET 实现**

替换 `apps/web/app/api/positions/manual/route.ts` 顶部 import 与 GET 函数体(POST 不动):

```ts
export const dynamic = "force-dynamic";
import { eq, isNull, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions, priceSnapshots } from "@trader/db";
import { upsertPositionAndCreateLot } from "@/lib/position-service";
import { getBoss } from "@/lib/queue";
import { replayPosition, computeTotalPnl, type Txn, type TxnType } from "@/lib/pnl";

export async function GET(_request: Request) {
  const rows = await db.query.positions.findMany({
    where: isNull(positions.strategyId),
    with: { positionLots: true },
  });

  const result = await Promise.all(
    rows.map(async (p: any) => {
      const snap = await db
        .select({ close: priceSnapshots.close })
        .from(priceSnapshots)
        .where(eq(priceSnapshots.symbol, p.symbol))
        .orderBy(desc(priceSnapshots.date))
        .limit(1);

      const latestPrice = snap[0]?.close != null ? parseFloat(snap[0].close) : null;

      const txns: Txn[] = p.positionLots.map((l: any) => ({
        id: l.id,
        type: (l.type as TxnType) ?? "BUY",
        shares: parseFloat(l.shares),
        price: parseFloat(l.costPrice),
        date: l.lotDate,
        createdAt: l.createdAt,
      }));
      const state = replayPosition(txns);
      const { unrealizedPnl, totalPnl, totalPnlPercent } = computeTotalPnl(state, latestPrice);

      const transactions = [...p.positionLots]
        .sort((a: any, b: any) =>
          a.lotDate === b.lotDate
            ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            : a.lotDate < b.lotDate ? -1 : 1
        )
        .map((l: any) => ({
          id: l.id,
          type: (l.type as TxnType) ?? "BUY",
          shares: l.shares,
          costPrice: l.costPrice,
          lotDate: l.lotDate,
          notes: l.notes,
        }));

      return {
        id: p.id,
        symbol: p.symbol,
        totalShares: state.heldShares.toString(),
        avgCost: state.avgCost.toFixed(4),
        latestPrice,
        realizedPnl: state.realizedPnl,
        unrealizedPnl,
        totalPnl,
        totalPnlPercent,
        isClosed: state.isClosed,
        transactions,
      };
    })
  );

  return Response.json(result);
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm --filter @trader/web test -- --run "positions/manual/__tests__"`
Expected: PASS

- [ ] **Step 5: 写策略 GET 测试**

Create(或在已有文件追加)`apps/web/app/api/strategies/[id]/positions/__tests__/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { findFirstStrategy, findManyPositions, findFirstRun } = vi.hoisted(() => ({
  findFirstStrategy: vi.fn(),
  findManyPositions: vi.fn(),
  findFirstRun: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      strategies: { findFirst: findFirstStrategy },
      positions: { findMany: findManyPositions },
      monitoringRuns: { findFirst: findFirstRun },
    },
  },
}));

import { GET } from "../route";
const ctx = { params: Promise.resolve({ id: "strat-1" }) };

describe("GET /api/strategies/[id]/positions", () => {
  beforeEach(() => {
    findFirstStrategy.mockReset();
    findManyPositions.mockReset();
    findFirstRun.mockReset();
  });

  it("404 when strategy missing", async () => {
    findFirstStrategy.mockResolvedValueOnce(undefined);
    const res = await GET(new Request("http://localhost"), ctx);
    expect(res.status).toBe(404);
  });

  it("returns positions with computed total pnl and latest price", async () => {
    findFirstStrategy.mockResolvedValueOnce({ id: "strat-1" });
    findManyPositions.mockResolvedValueOnce([
      {
        id: "p1",
        symbol: "QQQ",
        referencePrice: "100",
        positionLots: [
          { id: "l1", type: "BUY", shares: "10", costPrice: "100", lotDate: "2026-05-01", notes: null, createdAt: new Date("2026-05-01") },
        ],
      },
    ]);
    findFirstRun.mockResolvedValueOnce({ prices: { QQQ: 120 } });

    const res = await GET(new Request("http://localhost"), ctx);
    const data = await res.json();
    expect(data[0]).toMatchObject({ id: "p1", symbol: "QQQ", latestPrice: 120, isClosed: false });
    expect(data[0].totalPnl).toBeCloseTo(200, 6); // (120-100)*10
    expect(data[0].transactions).toHaveLength(1);
  });
});
```

- [ ] **Step 6: 运行验证失败**

Run: `pnpm --filter @trader/web test -- --run "strategies/\[id\]/positions/__tests__"`
Expected: FAIL — 缺 totalPnl/transactions(或 import 形态不符)。

- [ ] **Step 7: 改策略 GET 实现**

替换 `apps/web/app/api/strategies/[id]/positions/route.ts` 整体:

```ts
export const dynamic = "force-dynamic";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions, strategies, monitoringRuns } from "@trader/db";
import { replayPosition, computeTotalPnl, type Txn, type TxnType } from "@/lib/pnl";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: strategyId } = await params;

  const strategy = await db.query.strategies.findFirst({
    where: eq(strategies.id, strategyId),
  });
  if (!strategy) return Response.json({ error: "Not found" }, { status: 404 });

  const positionsList = await db.query.positions.findMany({
    where: eq(positions.strategyId, strategyId),
    with: { positionLots: { orderBy: (l, { asc }) => [asc(l.lotDate)] } },
  });

  const latestRun = await db.query.monitoringRuns.findFirst({
    where: eq(monitoringRuns.strategyId, strategyId),
    orderBy: (r, { desc }) => [desc(r.createdAt)],
  });

  const prices = (latestRun?.prices as Record<string, number>) ?? {};

  return Response.json(
    positionsList.map((p: any) => {
      const latestPrice = prices[p.symbol] ?? null;
      const txns: Txn[] = p.positionLots.map((l: any) => ({
        id: l.id,
        type: (l.type as TxnType) ?? "BUY",
        shares: parseFloat(l.shares),
        price: parseFloat(l.costPrice),
        date: l.lotDate,
        createdAt: l.createdAt,
      }));
      const state = replayPosition(txns);
      const { unrealizedPnl, totalPnl, totalPnlPercent } = computeTotalPnl(state, latestPrice);

      const transactions = [...p.positionLots]
        .sort((a: any, b: any) =>
          a.lotDate === b.lotDate
            ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            : a.lotDate < b.lotDate ? -1 : 1
        )
        .map((l: any) => ({
          id: l.id,
          type: (l.type as TxnType) ?? "BUY",
          shares: l.shares,
          costPrice: l.costPrice,
          lotDate: l.lotDate,
          notes: l.notes,
        }));

      return {
        id: p.id,
        symbol: p.symbol,
        referencePrice: p.referencePrice,
        latestPrice,
        totalShares: state.heldShares.toString(),
        avgCost: state.avgCost.toFixed(4),
        realizedPnl: state.realizedPnl,
        unrealizedPnl,
        totalPnl,
        totalPnlPercent,
        isClosed: state.isClosed,
        transactions,
      };
    })
  );
}
```

- [ ] **Step 8: 运行验证通过**

Run: `pnpm --filter @trader/web test -- --run "strategies/\[id\]/positions/__tests__"`
Expected: PASS

- [ ] **Step 9: 提交**

```bash
git add apps/web/app/api/positions/manual/route.ts apps/web/app/api/positions/manual/__tests__/route.test.ts "apps/web/app/api/strategies/[id]/positions"
git commit -m "feat(web): enrich position GET endpoints with realized/total pnl + transactions"
```

---

## Task 6: pnl.ts 加 buildPnlHistory(每日重放)

**Files:**
- Modify: `apps/web/lib/pnl.ts`
- Modify: `apps/web/lib/__tests__/pnl.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/web/lib/__tests__/pnl.test.ts` 末尾追加(并把顶部 import 加上 `buildPnlHistory`, `type DatedTxn`, `type Snapshot`):

```ts
import { buildPnlHistory, type DatedTxn, type Snapshot } from "../pnl";

describe("buildPnlHistory", () => {
  it("includes realized gains after a sell and carries prices forward", () => {
    const txns: DatedTxn[] = [
      { id: "b", symbol: "AAA", type: "BUY", shares: 100, price: 10, date: "2026-01-01" },
      { id: "s", symbol: "AAA", type: "SELL", shares: 100, price: 15, date: "2026-01-03" },
    ];
    const snaps: Snapshot[] = [
      { symbol: "AAA", date: "2026-01-01", close: 10 },
      { symbol: "AAA", date: "2026-01-02", close: 12 },
      { symbol: "AAA", date: "2026-01-03", close: 15 },
    ];
    const out = buildPnlHistory(txns, snaps);
    // d1: held 100 @10, price 10 -> 0%
    // d2: held 100 @10, price 12 -> (1200-1000)/1000 = 20%
    // d3: sold all, realized=(15-10)*100=500, held 0 -> total=500 / gross 1000 = 50%
    expect(out).toEqual([
      { date: "2026-01-01", percentPnl: 0 },
      { date: "2026-01-02", percentPnl: 20 },
      { date: "2026-01-03", percentPnl: 50 },
    ]);
  });

  it("skips symbols with no price yet and days with zero gross", () => {
    const txns: DatedTxn[] = [
      { id: "b", symbol: "BBB", type: "BUY", shares: 10, price: 100, date: "2026-02-02" },
    ];
    const snaps: Snapshot[] = [
      { symbol: "BBB", date: "2026-02-01", close: 90 }, // before any buy: gross 0 -> skipped
      { symbol: "BBB", date: "2026-02-02", close: 110 },
    ];
    const out = buildPnlHistory(txns, snaps);
    expect(out).toEqual([{ date: "2026-02-02", percentPnl: 10 }]);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm --filter @trader/web test -- --run pnl`
Expected: FAIL — `buildPnlHistory` 未导出。

- [ ] **Step 3: 实现(追加到 pnl.ts 末尾)**

```ts
export interface DatedTxn extends Txn {
  symbol: string;
}

export interface Snapshot {
  symbol: string;
  date: string;
  close: number;
}

export function buildPnlHistory(
  txns: DatedTxn[],
  snapshots: Snapshot[]
): Array<{ date: string; percentPnl: number }> {
  const bySymbol = new Map<string, DatedTxn[]>();
  for (const t of txns) {
    if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, []);
    bySymbol.get(t.symbol)!.push(t);
  }

  const priceByDate = new Map<string, Map<string, number>>();
  for (const s of snapshots) {
    if (!priceByDate.has(s.date)) priceByDate.set(s.date, new Map());
    priceByDate.get(s.date)!.set(s.symbol, s.close);
  }

  const dates = [...priceByDate.keys()].sort();
  const carry = new Map<string, number>();
  const result: Array<{ date: string; percentPnl: number }> = [];

  for (const date of dates) {
    const todays = priceByDate.get(date);
    if (todays) for (const [sym, px] of todays) carry.set(sym, px);

    let marketValue = 0;
    let remainingCost = 0;
    let realizedCum = 0;
    let grossInvested = 0;

    for (const [sym, list] of bySymbol) {
      const price = carry.get(sym);
      if (price === undefined) continue;
      const upTo = list.filter((t) => t.date <= date);
      if (upTo.length === 0) continue;
      const st = replayPosition(upTo);
      marketValue += st.heldShares * price;
      remainingCost += st.costBasis;
      realizedCum += st.realizedPnl;
      grossInvested += st.grossInvested;
    }

    if (grossInvested <= EPS) continue;
    const totalPnl = marketValue - remainingCost + realizedCum;
    result.push({
      date,
      percentPnl: Math.round((totalPnl / grossInvested) * 10000) / 100,
    });
  }

  return result;
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm --filter @trader/web test -- --run pnl`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/lib/pnl.ts apps/web/lib/__tests__/pnl.test.ts
git commit -m "feat(web): add buildPnlHistory daily replay including realized pnl"
```

---

## Task 7: 历史曲线路由改用 buildPnlHistory

**Files:**
- Modify: `apps/web/app/api/positions/history/route.ts`
- Modify: `apps/web/app/api/positions/history/__tests__/route.test.ts`
- Modify: `apps/web/app/api/strategies/[id]/history/route.ts`
- Modify: `apps/web/app/api/strategies/[id]/history/__tests__/route.test.ts`

> 注意:策略历史从读 `monitoringRuns.prices` 改为读 `price_snapshots`(与账户历史统一,manual-positions 变更已让监控任务写入 price_snapshots)。

- [ ] **Step 1: 改账户历史测试**

把 `apps/web/app/api/positions/history/__tests__/route.test.ts` 中验证 percentPnl 的核心用例替换/新增一个含卖出的断言。先确认它 mock 了 `db.query.positions.findMany` 与 `db.select`(snapshot 链)。新增用例(放进主 describe 内):

```ts
  it("reflects realized pnl after a sell across days", async () => {
    findMany.mockResolvedValueOnce([
      {
        symbol: "AAA",
        positionLots: [
          { id: "b", type: "BUY", shares: "100", costPrice: "10", lotDate: "2026-01-01", createdAt: new Date("2026-01-01") },
          { id: "s", type: "SELL", shares: "100", costPrice: "15", lotDate: "2026-01-03", createdAt: new Date("2026-01-03") },
        ],
      },
    ]);
    selectMock.mockReturnValueOnce(
      makeSelectChain([
        { symbol: "AAA", date: "2026-01-01", close: "10" },
        { symbol: "AAA", date: "2026-01-02", close: "12" },
        { symbol: "AAA", date: "2026-01-03", close: "15" },
      ])
    );

    const res = await GET(new Request("http://localhost/api/positions/history?range=all"));
    const data = await res.json();
    expect(data).toEqual([
      { date: "2026-01-01", percentPnl: 0 },
      { date: "2026-01-02", percentPnl: 20 },
      { date: "2026-01-03", percentPnl: 50 },
    ]);
  });
```

> 若现有测试的 mock 变量名不同(如 `snapshotSelect`/`makeSelectChain`),按文件中既有名字对齐;`makeSelectChain` 需让链式 `.orderBy(...)` 直接 resolve 到 rows(history 路由不调用 `.limit`)。若现有 helper 只 resolve 在 `.limit`,新增一个:
> ```ts
> function makeOrderByChain(rows: any[]) {
>   return { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockResolvedValue(rows) };
> }
> ```
> 并在该用例用 `makeOrderByChain`。

- [ ] **Step 2: 运行验证失败**

Run: `pnpm --filter @trader/web test -- --run "positions/history"`
Expected: FAIL — 旧逻辑未计入 realized,d3 不会是 50%。

- [ ] **Step 3: 改账户历史实现**

替换 `apps/web/app/api/positions/history/route.ts` 整体:

```ts
export const dynamic = "force-dynamic";
import { and, asc, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { priceSnapshots } from "@trader/db";
import { buildPnlHistory, type DatedTxn, type TxnType, type Snapshot } from "@/lib/pnl";

function getCutoff(range: string): string | null {
  if (range === "all") return null;
  const d = new Date();
  d.setDate(d.getDate() - (range === "3m" ? 90 : 30));
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cutoff = getCutoff(searchParams.get("range") ?? "1m");

  const allPositions = await db.query.positions.findMany({
    with: { positionLots: true },
  });

  const txns: DatedTxn[] = [];
  for (const pos of allPositions as any[]) {
    for (const l of pos.positionLots) {
      txns.push({
        id: l.id,
        symbol: pos.symbol,
        type: (l.type as TxnType) ?? "BUY",
        shares: parseFloat(l.shares),
        price: parseFloat(l.costPrice),
        date: l.lotDate,
        createdAt: l.createdAt,
      });
    }
  }

  const symbols = [...new Set(txns.map((t) => t.symbol))];
  if (symbols.length === 0) return Response.json([]);

  const where = cutoff
    ? and(inArray(priceSnapshots.symbol, symbols), gte(priceSnapshots.date, cutoff))
    : inArray(priceSnapshots.symbol, symbols);

  const rows = await db
    .select({
      symbol: priceSnapshots.symbol,
      date: priceSnapshots.date,
      close: priceSnapshots.close,
    })
    .from(priceSnapshots)
    .where(where)
    .orderBy(asc(priceSnapshots.date));

  const snapshots: Snapshot[] = (rows as any[]).map((r) => ({
    symbol: r.symbol,
    date: r.date,
    close: parseFloat(r.close),
  }));

  return Response.json(buildPnlHistory(txns, snapshots));
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm --filter @trader/web test -- --run "positions/history"`
Expected: PASS

- [ ] **Step 5: 改策略历史测试**

替换 `apps/web/app/api/strategies/[id]/history/__tests__/route.test.ts` 的 db mock,使其 mock `db.query.positions.findMany`(带 positionLots)与 `db.select`(snapshot 链),而非 monitoringRuns。核心断言一个含卖出序列(与 Step 1 同形,symbol 用策略持仓的 symbol)。完整文件:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { findMany, selectMock } = vi.hoisted(() => ({ findMany: vi.fn(), selectMock: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { query: { positions: { findMany } }, select: selectMock },
}));

import { GET } from "../route";
const ctx = { params: Promise.resolve({ id: "strat-1" }) };

function chain(rows: any[]) {
  return { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockResolvedValue(rows) };
}

describe("GET /api/strategies/[id]/history", () => {
  beforeEach(() => { findMany.mockReset(); selectMock.mockReset(); });

  it("returns empty when no positions", async () => {
    findMany.mockResolvedValueOnce([]);
    const res = await GET(new Request("http://localhost?range=all"), ctx);
    expect(await res.json()).toEqual([]);
  });

  it("reflects realized pnl after a sell", async () => {
    findMany.mockResolvedValueOnce([
      {
        symbol: "QQQ",
        positionLots: [
          { id: "b", type: "BUY", shares: "100", costPrice: "10", lotDate: "2026-01-01", createdAt: new Date("2026-01-01") },
          { id: "s", type: "SELL", shares: "100", costPrice: "15", lotDate: "2026-01-03", createdAt: new Date("2026-01-03") },
        ],
      },
    ]);
    selectMock.mockReturnValueOnce(chain([
      { symbol: "QQQ", date: "2026-01-01", close: "10" },
      { symbol: "QQQ", date: "2026-01-02", close: "12" },
      { symbol: "QQQ", date: "2026-01-03", close: "15" },
    ]));

    const res = await GET(new Request("http://localhost?range=all"), ctx);
    expect(await res.json()).toEqual([
      { date: "2026-01-01", percentPnl: 0 },
      { date: "2026-01-02", percentPnl: 20 },
      { date: "2026-01-03", percentPnl: 50 },
    ]);
  });
});
```

- [ ] **Step 6: 运行验证失败**

Run: `pnpm --filter @trader/web test -- --run "strategies/\[id\]/history"`
Expected: FAIL — 旧实现读 monitoringRuns。

- [ ] **Step 7: 改策略历史实现**

替换 `apps/web/app/api/strategies/[id]/history/route.ts` 整体:

```ts
export const dynamic = "force-dynamic";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions, priceSnapshots } from "@trader/db";
import { buildPnlHistory, type DatedTxn, type TxnType, type Snapshot } from "@/lib/pnl";

function getCutoff(range: string): string | null {
  if (range === "all") return null;
  const d = new Date();
  d.setDate(d.getDate() - (range === "3m" ? 90 : 30));
  return d.toISOString().slice(0, 10);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: strategyId } = await params;
  const { searchParams } = new URL(request.url);
  const cutoff = getCutoff(searchParams.get("range") ?? "1m");

  const strategyPositions = await db.query.positions.findMany({
    where: eq(positions.strategyId, strategyId),
    with: { positionLots: true },
  });

  const txns: DatedTxn[] = [];
  for (const pos of strategyPositions as any[]) {
    for (const l of pos.positionLots) {
      txns.push({
        id: l.id,
        symbol: pos.symbol,
        type: (l.type as TxnType) ?? "BUY",
        shares: parseFloat(l.shares),
        price: parseFloat(l.costPrice),
        date: l.lotDate,
        createdAt: l.createdAt,
      });
    }
  }

  const symbols = [...new Set(txns.map((t) => t.symbol))];
  if (symbols.length === 0) return Response.json([]);

  const where = cutoff
    ? and(inArray(priceSnapshots.symbol, symbols), gte(priceSnapshots.date, cutoff))
    : inArray(priceSnapshots.symbol, symbols);

  const rows = await db
    .select({
      symbol: priceSnapshots.symbol,
      date: priceSnapshots.date,
      close: priceSnapshots.close,
    })
    .from(priceSnapshots)
    .where(where)
    .orderBy(asc(priceSnapshots.date));

  const snapshots: Snapshot[] = (rows as any[]).map((r) => ({
    symbol: r.symbol,
    date: r.date,
    close: parseFloat(r.close),
  }));

  return Response.json(buildPnlHistory(txns, snapshots));
}
```

- [ ] **Step 8: 运行验证通过**

Run: `pnpm --filter @trader/web test -- --run "strategies/\[id\]/history"`
Expected: PASS

- [ ] **Step 9: 提交**

```bash
git add apps/web/app/api/positions/history "apps/web/app/api/strategies/[id]/history"
git commit -m "feat(web): rebuild pnl history via transaction replay incl. realized"
```

---

## Task 8: 删除买入的"持股不能为负"守卫

**Files:**
- Modify: `apps/web/app/api/positions/manual/lots/[lotId]/route.ts`
- Modify: `apps/web/app/api/positions/manual/lots/[lotId]/__tests__/route.test.ts`
- Modify: `apps/web/app/api/lots/[lotId]/route.ts`
- Test: `apps/web/app/api/lots/[lotId]/__tests__/route.test.ts`(若无则创建)

- [ ] **Step 1: 写失败测试(手动删除守卫)**

在 `apps/web/app/api/positions/manual/lots/[lotId]/__tests__/route.test.ts` 追加(沿用文件既有 db mock 形态;若它只 mock 了部分 query,需补 `db.query.positionLots.findFirst` 返回带 position+其 lots)。新增用例:

```ts
  it("returns 409 when deleting a buy would make holdings negative", async () => {
    (db.query.positionLots.findFirst as any).mockResolvedValueOnce({
      id: "buy1",
      positionId: "p1",
      type: "BUY",
      position: {
        strategyId: null,
        positionLots: [
          { id: "buy1", type: "BUY", shares: "100", costPrice: "10", lotDate: "2026-01-01", createdAt: new Date("2026-01-01") },
          { id: "sell1", type: "SELL", shares: "80", costPrice: "15", lotDate: "2026-01-02", createdAt: new Date("2026-01-02") },
        ],
      },
    });

    const res = await DELETE(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ lotId: "buy1" }),
    });
    expect(res.status).toBe(409);
  });
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm --filter @trader/web test -- --run "manual/lots"`
Expected: FAIL — 当前实现直接删除,无 409。

- [ ] **Step 3: 改手动删除实现**

替换 `apps/web/app/api/positions/manual/lots/[lotId]/route.ts` 整体:

```ts
export const dynamic = "force-dynamic";
import { eq, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { positionLots, positions } from "@trader/db";
import { canDeleteBuy, type Txn, type TxnType } from "@/lib/pnl";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ lotId: string }> }
) {
  const { lotId } = await params;

  const lot = await db.query.positionLots.findFirst({
    where: eq(positionLots.id, lotId),
    with: { position: { with: { positionLots: true } } },
  });

  if (!lot || (lot as any).position?.strategyId !== null) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const siblings = (lot as any).position.positionLots as any[];
  const txns: Txn[] = siblings.map((l) => ({
    id: l.id,
    type: (l.type as TxnType) ?? "BUY",
    shares: parseFloat(l.shares),
    price: parseFloat(l.costPrice),
    date: l.lotDate,
    createdAt: l.createdAt,
  }));
  if (!canDeleteBuy(txns, lotId)) {
    return Response.json(
      { error: "deleting this buy would make holdings negative; delete the sell first" },
      { status: 409 }
    );
  }

  const positionId = (lot as any).positionId;
  await db.delete(positionLots).where(eq(positionLots.id, lotId));

  const remaining = await db
    .select({ count: count() })
    .from(positionLots)
    .where(eq(positionLots.positionId, positionId));

  if (Number(remaining[0]?.count ?? 0) === 0) {
    await db.delete(positions).where(eq(positions.id, positionId));
    return Response.json({ deletedPosition: true });
  }
  return Response.json({ deletedPosition: false });
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm --filter @trader/web test -- --run "manual/lots"`
Expected: PASS

- [ ] **Step 5: 写失败测试(策略删除守卫)**

Create/追加 `apps/web/app/api/lots/[lotId]/__tests__/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { findFirst, deleteMock } = vi.hoisted(() => ({ findFirst: vi.fn(), deleteMock: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { query: { positionLots: { findFirst } }, delete: deleteMock },
}));

import { DELETE } from "../route";

describe("DELETE /api/lots/[lotId] guard", () => {
  beforeEach(() => { findFirst.mockReset(); deleteMock.mockReset(); });

  it("returns 409 when deleting a buy would make holdings negative", async () => {
    findFirst.mockResolvedValueOnce({
      id: "buy1",
      positionId: "p1",
      type: "BUY",
      position: {
        positionLots: [
          { id: "buy1", type: "BUY", shares: "100", costPrice: "10", lotDate: "2026-01-01", createdAt: new Date("2026-01-01") },
          { id: "sell1", type: "SELL", shares: "80", costPrice: "15", lotDate: "2026-01-02", createdAt: new Date("2026-01-02") },
        ],
      },
    });
    const res = await DELETE(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ lotId: "buy1" }),
    });
    expect(res.status).toBe(409);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("deletes a safe lot (204)", async () => {
    findFirst.mockResolvedValueOnce({
      id: "sell1",
      positionId: "p1",
      type: "SELL",
      position: {
        positionLots: [
          { id: "buy1", type: "BUY", shares: "100", costPrice: "10", lotDate: "2026-01-01", createdAt: new Date("2026-01-01") },
          { id: "sell1", type: "SELL", shares: "80", costPrice: "15", lotDate: "2026-01-02", createdAt: new Date("2026-01-02") },
        ],
      },
    });
    deleteMock.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const res = await DELETE(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ lotId: "sell1" }),
    });
    expect(res.status).toBe(204);
  });
});
```

> 注:此测试覆盖新增的 DELETE 守卫;PUT 行为不变,无需新测试。

- [ ] **Step 6: 运行验证失败**

Run: `pnpm --filter @trader/web test -- --run "api/lots/\[lotId\]"`
Expected: FAIL — 现有 DELETE 不查 position、无守卫。

- [ ] **Step 7: 改策略删除实现**

替换 `apps/web/app/api/lots/[lotId]/route.ts` 的 DELETE(PUT 保持不变),并补 import:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { positionLots } from "@trader/db";
import { canDeleteBuy, type Txn, type TxnType } from "@/lib/pnl";
```

```ts
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ lotId: string }> }
) {
  const { lotId } = await params;

  const lot = await db.query.positionLots.findFirst({
    where: eq(positionLots.id, lotId),
    with: { position: { with: { positionLots: true } } },
  });
  if (!lot) return new Response(null, { status: 204 });

  const siblings = (lot as any).position?.positionLots as any[] | undefined;
  if (siblings) {
    const txns: Txn[] = siblings.map((l) => ({
      id: l.id,
      type: (l.type as TxnType) ?? "BUY",
      shares: parseFloat(l.shares),
      price: parseFloat(l.costPrice),
      date: l.lotDate,
      createdAt: l.createdAt,
    }));
    if (!canDeleteBuy(txns, lotId)) {
      return Response.json(
        { error: "deleting this buy would make holdings negative; delete the sell first" },
        { status: 409 }
      );
    }
  }

  await db.delete(positionLots).where(eq(positionLots.id, lotId));
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 8: 运行验证通过**

Run: `pnpm --filter @trader/web test -- --run "api/lots/\[lotId\]"`
Expected: PASS

- [ ] **Step 9: 提交**

```bash
git add "apps/web/app/api/positions/manual/lots/[lotId]" "apps/web/app/api/lots/[lotId]"
git commit -m "feat(web): guard against deleting a buy that makes holdings negative"
```

---

## Task 9: SellForm 组件

**Files:**
- Create: `apps/web/components/sell-form.tsx`

> 类比 `apps/web/components/lot-form.tsx`。symbol 锁定,字段:股数、卖出价、日期、备注。纯受控组件,不含网络请求。

- [ ] **Step 1: 实现组件**

Create `apps/web/components/sell-form.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface SellFormValues {
  shares: string;
  price: string;
  sellDate: string;
  notes: string;
}

interface Props {
  symbol: string;
  maxShares: number;
  submitLabel?: string;
  onSubmit: (values: SellFormValues) => Promise<void> | void;
  onCancel?: () => void;
}

export function SellForm({ symbol, maxShares, submitLabel = "卖出", onSubmit, onCancel }: Props) {
  const [shares, setShares] = useState("");
  const [price, setPrice] = useState("");
  const [sellDate, setSellDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit() {
    const s = parseFloat(shares);
    if (!shares || !price || !sellDate) return;
    if (!(s > 0)) { setErr("股数必须大于 0"); return; }
    if (s > maxShares + 1e-9) { setErr(`最多可卖 ${maxShares} 股`); return; }
    setErr(null);
    setBusy(true);
    try {
      await onSubmit({ shares, price, sellDate, notes });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm font-medium mb-3">卖出 {symbol}（持有 {maxShares} 股）</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">卖出股数</label>
            <Input type="number" step="0.0001" value={shares} onChange={(e) => setShares(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">卖出价</label>
            <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">卖出日期</label>
            <Input type="date" value={sellDate} onChange={(e) => setSellDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">备注</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        {err && <p className="text-sm text-destructive mt-2">{err}</p>}
        <div className="flex gap-2 mt-3">
          <Button size="sm" onClick={handleSubmit} disabled={busy}>{submitLabel}</Button>
          {onCancel && (
            <Button size="sm" variant="outline" onClick={onCancel}>取消</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter @trader/web exec tsc --noEmit`
Expected: 无新增错误。

- [ ] **Step 3: 提交**

```bash
git add apps/web/components/sell-form.tsx
git commit -m "feat(web): add SellForm component"
```

---

## Task 10: 手动持仓 tab 接入卖出 + 操作历史 + 总盈利

**Files:**
- Modify: `apps/web/components/manual-positions-tab.tsx`

> 现状见 `apps/web/components/manual-positions-tab.tsx`。改动:接口加盈利字段与 transactions;卡片头显示总盈利;加「卖出」按钮 + SellForm;lot 列表改为 transactions 时间线(买入/卖出标签);已清仓徽章。颜色遵循红涨绿跌(盈利红、亏损绿)。

- [ ] **Step 1: 替换接口定义与 import**

把文件顶部 import 段加上 SellForm,并替换 `ManualLot`/`ManualPosition` 接口:

```tsx
import { LotForm, type LotFormValues } from "@/components/lot-form";
import { SellForm, type SellFormValues } from "@/components/sell-form";

interface Transaction {
  id: string;
  type: "BUY" | "SELL";
  shares: string;
  costPrice: string;
  lotDate: string;
  notes: string | null;
}

interface ManualPosition {
  id: string;
  symbol: string;
  totalShares: string;
  avgCost: string;
  latestPrice: number | null;
  realizedPnl: number;
  unrealizedPnl: number | null;
  totalPnl: number | null;
  totalPnlPercent: number | null;
  isClosed: boolean;
  transactions: Transaction[];
}
```

- [ ] **Step 2: 加卖出状态与 handler**

在组件内 `const [showAdd, setShowAdd] = useState(false);` 下方新增:

```tsx
  const [sellingId, setSellingId] = useState<string | null>(null);
```

在 `handleAdd` 之后新增 handler:

```tsx
  async function handleSell(symbol: string, values: SellFormValues) {
    const res = await fetch("/api/positions/manual/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol,
        shares: parseFloat(values.shares),
        price: values.price,
        sellDate: values.sellDate,
        notes: values.notes || undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "卖出失败");
      return;
    }
    setSellingId(null);
    await load();
  }
```

并把 `handleDeleteLot` 的 URL 保持不变(仍 `/api/positions/manual/lots/${lotId}`);若返回 409,提示错误:

```tsx
  async function handleDeleteLot(lotId: string) {
    const res = await fetch(`/api/positions/manual/lots/${lotId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "删除失败");
      return;
    }
    setError(null);
    await load();
  }
```

- [ ] **Step 3: 替换持仓卡片渲染**

把 `data.map((p) => { ... })` 整段(当前 145-216 行附近,从 `const totalShares = parseFloat(p.totalShares);` 到该 map 结束)替换为:

```tsx
      {data.map((p) => {
        const totalShares = parseFloat(p.totalShares);
        const avg = parseFloat(p.avgCost);
        const pnl = p.totalPnl;
        const pct = p.totalPnlPercent;
        const gain = pnl != null && pnl >= 0;

        return (
          <Card key={p.id}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-medium">{p.symbol}</span>
                  {p.isClosed ? (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">已清仓</span>
                  ) : (
                    <>
                      <span className="text-sm">{totalShares} 股</span>
                      <span className="text-sm text-muted-foreground">均价 ${avg.toFixed(2)}</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!p.isClosed && (p.latestPrice == null ? (
                    <span className="text-xs text-muted-foreground">价格加载中…</span>
                  ) : (
                    <span className="text-sm tabular-nums">${p.latestPrice.toFixed(2)}</span>
                  ))}
                  {pnl != null && pct != null && (
                    <span className={`text-sm font-medium tabular-nums ${gain ? "text-red-600" : "text-green-600"}`}>
                      {gain ? "+" : ""}${pnl.toFixed(2)} ({pct.toFixed(2)}%)
                    </span>
                  )}
                  {!p.isClosed && (
                    <Button variant="outline" size="sm" className="h-7" onClick={() => setSellingId(sellingId === p.id ? null : p.id)}>
                      卖出
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDeletePosition(p.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {sellingId === p.id && (
                <div className="mt-3">
                  <SellForm
                    symbol={p.symbol}
                    maxShares={totalShares}
                    onSubmit={(v) => handleSell(p.symbol, v)}
                    onCancel={() => setSellingId(null)}
                  />
                </div>
              )}

              {p.transactions.length > 0 && (
                <div className="mt-2 space-y-1 text-xs">
                  {p.transactions.map((t) => (
                    <div key={t.id} className="flex justify-between text-muted-foreground">
                      <span>
                        <span className={t.type === "SELL" ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                          {t.type === "SELL" ? "卖出" : "买入"}
                        </span>{" "}
                        {t.lotDate} · {parseFloat(t.shares)} 股 · ${parseFloat(t.costPrice).toFixed(2)}
                        {t.notes ? ` · ${t.notes}` : ""}
                      </span>
                      <button onClick={() => handleDeleteLot(t.id)} className="hover:text-destructive">
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
```

- [ ] **Step 4: 调整轮询判断(已清仓不算 pending)**

把轮询 effect 里的 `const hasPending = data.some((p) => p.latestPrice === null);` 改为:

```tsx
    const hasPending = data.some((p) => !p.isClosed && p.latestPrice === null);
```

- [ ] **Step 5: 类型检查**

Run: `pnpm --filter @trader/web exec tsc --noEmit`
Expected: 无新增错误。

- [ ] **Step 6: 提交**

```bash
git add apps/web/components/manual-positions-tab.tsx
git commit -m "feat(web): manual positions tab — sell + transactions timeline + total pnl"
```

---

## Task 11: 策略详情页持仓 tab 接入卖出 + 操作历史 + 总盈利

**Files:**
- Modify: `apps/web/app/strategies/[id]/page.tsx`

> 改动点:`Position`/`Lot` 接口加盈利字段与 transactions;positions tab 用服务端 totalPnl/totalPnlPercent 替代本地 `calcAggregated` 的 pnl 计算;加「卖出」按钮 + SellForm;lot 列表渲染 transactions(买/卖标签);已清仓徽章。

- [ ] **Step 1: 改接口与 import**

顶部 import 加 SellForm:

```tsx
import { LotForm } from "@/components/lot-form";
import { SellForm, type SellFormValues } from "@/components/sell-form";
```

把 `Position` 与 `Lot` 接口替换为:

```tsx
interface Transaction {
  id: string;
  type: "BUY" | "SELL";
  shares: string;
  costPrice: string;
  lotDate: string;
  notes: string | null;
}

interface Position {
  id: string;
  symbol: string;
  referencePrice: string | null;
  latestPrice: number | null;
  totalShares: string;
  avgCost: string;
  totalPnl: number | null;
  totalPnlPercent: number | null;
  isClosed: boolean;
  transactions: Transaction[];
}
```

- [ ] **Step 2: 加卖出状态与 handler**

在 `const [showAddLot, setShowAddLot] = useState(false);` 下加:

```tsx
  const [sellingId, setSellingId] = useState<string | null>(null);
```

在 `handleAddLot` 之后加:

```tsx
  async function handleSell(symbol: string, values: SellFormValues) {
    const res = await fetch(`/api/strategies/${id}/lots/sell`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol,
        shares: parseFloat(values.shares),
        price: values.price,
        sellDate: values.sellDate,
        notes: values.notes || undefined,
      }),
    });
    if (res.ok) {
      setSellingId(null);
      fetchPositions();
    } else {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? "卖出失败");
    }
  }
```

把 `handleDeleteLot` 改为处理 409:

```tsx
  async function handleDeleteLot(lotId: string) {
    const res = await fetch(`/api/lots/${lotId}`, { method: "DELETE" });
    if (!res.ok && res.status !== 204) {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? "删除失败");
      return;
    }
    fetchPositions();
  }
```

- [ ] **Step 3: 删除本地 calcAggregated 用法,改用服务端字段**

删除 `function calcAggregated(...)`(299-304 行)。把 positions tab 内 `positions.map((pos) => { ... })` 块(609-702 行)替换为:

```tsx
    {positions.map((pos) => {
      const totalShares = parseFloat(pos.totalShares);
      const avgCost = parseFloat(pos.avgCost);
      const pnl = pos.totalPnl;
      const pct = pos.totalPnlPercent;
      const gain = pnl != null && pnl >= 0;
      return (
        <div key={pos.id} className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between flex-wrap gap-1 mb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">{pos.symbol}</span>
              {pos.isClosed ? (
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">已清仓</span>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {formatShares(totalShares)} 股 @ ${avgCost.toFixed(2)}
                </span>
              )}
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                参考价：
                {editingRefPriceId === pos.id ? (
                  <>
                    <input
                      className="w-24 text-xs border-b border-primary bg-transparent outline-none tabular-nums"
                      value={refPriceInput}
                      autoFocus
                      onChange={(e) => setRefPriceInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveRefPrice(pos.id);
                        if (e.key === "Escape") setEditingRefPriceId(null);
                      }}
                    />
                    <button className="text-primary hover:text-primary/80 text-xs" onClick={() => handleSaveRefPrice(pos.id)}>确认</button>
                    <button className="text-muted-foreground hover:text-foreground text-xs" onClick={() => setEditingRefPriceId(null)}>取消</button>
                  </>
                ) : (
                  <>
                    <span className="tabular-nums">
                      {pos.referencePrice ? `$${parseFloat(pos.referencePrice).toFixed(2)}` : "未设定"}
                    </span>
                    <button
                      aria-label="edit reference price"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => {
                        setRefPriceInput(pos.referencePrice ?? "");
                        setEditingRefPriceId(pos.id);
                      }}
                    >
                      <Edit2 size={11} />
                    </button>
                  </>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {!pos.isClosed && pos.latestPrice !== null && (
                <span className="text-sm tabular-nums">${pos.latestPrice}</span>
              )}
              {pnl != null && pct != null && (
                <span className={`text-xs px-1.5 py-0.5 rounded ${gain ? "bg-red-50 text-red-700" : "bg-green-50 text-green-600"}`}>
                  {gain ? "+" : ""}${pnl.toFixed(2)} ({pct.toFixed(2)}%)
                </span>
              )}
              {!pos.isClosed && (
                <Button variant="outline" size="sm" className="h-7" onClick={() => setSellingId(sellingId === pos.id ? null : pos.id)}>
                  卖出
                </Button>
              )}
            </div>
          </div>

          {sellingId === pos.id && (
            <div className="mb-3">
              <SellForm
                symbol={pos.symbol}
                maxShares={totalShares}
                onSubmit={(v) => handleSell(pos.symbol, v)}
                onCancel={() => setSellingId(null)}
              />
            </div>
          )}

          <div className="divide-y">
            {pos.transactions.map((t) => (
              <div key={t.id} className="flex items-center justify-between py-2 first:pt-0 last:pb-0 hover:bg-muted/40 transition-colors">
                <div className="flex items-center gap-3 text-sm">
                  <span className={t.type === "SELL" ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                    {t.type === "SELL" ? "卖出" : "买入"}
                  </span>
                  <span className="tabular-nums">{t.lotDate}</span>
                  <span className="tabular-nums">{formatShares(t.shares)}股</span>
                  <span className="tabular-nums">${parseFloat(t.costPrice).toFixed(2)}</span>
                  {t.notes && <span className="text-muted-foreground text-xs">{t.notes}</span>}
                </div>
                <button
                  className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
                  onClick={() => handleDeleteLot(t.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      );
    })}
```

- [ ] **Step 4: 类型检查**

Run: `pnpm --filter @trader/web exec tsc --noEmit`
Expected: 无新增错误(确认无残留 `calcAggregated`/`positionLots` 引用)。

- [ ] **Step 5: 提交**

```bash
git add "apps/web/app/strategies/[id]/page.tsx"
git commit -m "feat(web): strategy positions tab — sell + transactions timeline + total pnl"
```

---

## Task 12: 全量测试 + 浏览器手动验证

**Files:** 无(验证)

- [ ] **Step 1: 跑全部单测**

Run: `pnpm --filter @trader/web test -- --run && pnpm --filter @trader/db test -- --run`
Expected: 全部 PASS。

- [ ] **Step 2: 应用迁移到本地 dev DB**

Run: 用本地 dev DB 连接执行 `scripts/migrate-2026-06-03.sql`(psql 或现有迁移流程)。
Expected: `position_lots.type` 列存在,旧数据为 'BUY'。

- [ ] **Step 3: 启动 dev server 手动验证**

Run: `pnpm --filter @trader/web dev`,浏览器打开 `/positions`(手动 tab)和某策略详情页持仓 tab。

验证清单:
- 添加一笔买入 → 操作历史出现"买入"行,总盈利随最新价显示。
- 点「卖出」→ 填部分股数 → 提交:操作历史新增"卖出"行,剩余股数/均价更新,总盈利含已实现。
- 超卖(股数 > 持有)→ SellForm 前端拦截 + 后端 400。
- 全部卖出 → 卡片显示"已清仓"徽章,价格列不再轮询,总盈利=已实现。
- 删除某买入(已有卖出导致会变负)→ 提示 409 错误,删除被拒。
- 顶部 P&L 曲线:清仓后曲线不塌回 0,体现已实现收益。

> 注:UI/前端正确性必须实际在浏览器验证;若环境无法连 DB/行情,明确说明哪些项未能验证,而非默认通过。

- [ ] **Step 4: 最终提交(若验证中有小修)**

```bash
git add -A && git commit -m "chore(web): buy/sell mechanism verification fixes"
```

---

## 自审记录(spec 覆盖)

- 数据模型(type 列):Task 1 ✓
- 移动平均盈利/总盈利口径:Task 2(replayPosition/computeTotalPnl)✓
- 卖出 service + 校验(超卖/日期):Task 3 ✓
- 卖出端点(手动+策略):Task 4 ✓
- GET 返回 realized/unrealized/total/isClosed + transactions:Task 5 ✓
- 历史曲线按时间精确重算(含已实现):Task 6 + Task 7 ✓
- 删除买入致持股为负的守卫:Task 8 ✓
- 卖出入口 UI + 操作历史时间线 + 已清仓 + 总盈利展示(手动+策略):Task 9/10/11 ✓
- 测试(纯函数/端点/历史)+ 浏览器验证:贯穿各 Task + Task 12 ✓
