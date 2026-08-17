// @vitest-environment node
import { describe, it, expect } from "vitest";
import { replayPosition as sharedReplayPosition } from "@trader/db/position-replay";
import { replayPosition, computeTotalPnl, canDeleteBuy, buildPnlHistory, type Txn, type DatedTxn, type Snapshot } from "../pnl";

function buy(id: string, shares: number, price: number, date: string): Txn {
  return { id, type: "BUY", shares, price, date };
}
function sell(id: string, shares: number, price: number, date: string): Txn {
  return { id, type: "SELL", shares, price, date };
}

describe("replayPosition", () => {
  it("delegates replay to the shared db module", () => {
    expect(replayPosition).toBe(sharedReplayPosition);
  });

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
