import { describe, it, expect } from "vitest";
import { computeInsights, type LotInput, type SnapshotInput } from "../insights";

function buy(positionId: string, symbol: string, date: string, price: number, shares: number, refPrice?: number): LotInput {
  return { id: `b-${date}-${symbol}-${positionId}`, positionId, symbol, type: "BUY", lotDate: date, costPrice: price, shares, referencePrice: refPrice ?? null };
}
function sell(positionId: string, symbol: string, date: string, price: number, shares: number): LotInput {
  return { id: `s-${date}-${symbol}-${positionId}`, positionId, symbol, type: "SELL", lotDate: date, costPrice: price, shares, referencePrice: null };
}
function snap(symbol: string, date: string, close: number): SnapshotInput {
  return { symbol, date, close };
}

describe("computeInsights", () => {
  it("returns empty result when closedTrades < 5", () => {
    const lots: LotInput[] = [buy("p1", "AAA", "2026-01-01", 10, 100), sell("p1", "AAA", "2026-01-10", 12, 100)];
    const r = computeInsights(lots, []);
    expect(r).toEqual({ empty: true, reason: "insufficient_data" });
  });

  it("computes basic financials with 60% win rate, 2:1 PL ratio", () => {
    const lots: LotInput[] = [];
    for (let i = 0; i < 3; i++) {
      lots.push(buy(`p${i}`, "W", `2026-01-${String(i + 1).padStart(2, "0")}`, 100, 1));
      lots.push(sell(`p${i}`, "W", `2026-01-${String(i + 6).padStart(2, "0")}`, 110, 1));
    }
    for (let i = 0; i < 2; i++) {
      lots.push(buy(`pL${i}`, "L", `2026-02-${String(i + 1).padStart(2, "0")}`, 100, 1));
      lots.push(sell(`pL${i}`, "L", `2026-02-${String(i + 6).padStart(2, "0")}`, 95, 1));
    }
    const r = computeInsights(lots, []);
    if ("empty" in r) throw new Error("expected non-empty");
    expect(r.basic.closedTrades).toBe(5);
    expect(r.basic.winRate).toBeCloseTo(0.6, 2);
    expect(r.basic.profitLossRatio).toBeCloseTo(2.0, 2);
    expect(r.basic.totalRealizedPnl).toBe(20);
  });

  it("flags severe disposition effect when winners held 5d, losers held 60d", () => {
    const lots: LotInput[] = [];
    for (let i = 0; i < 3; i++) {
      lots.push(buy(`p${i}`, "W", "2026-01-01", 100, 1));
      lots.push(sell(`p${i}`, "W", "2026-01-06", 110, 1));
    }
    for (let i = 0; i < 3; i++) {
      lots.push(buy(`pL${i}`, "L", "2026-02-01", 100, 1));
      lots.push(sell(`pL${i}`, "L", "2026-04-02", 95, 1));
    }
    const r = computeInsights(lots, []);
    if ("empty" in r) throw new Error("expected non-empty");
    expect(r.disposition.flag).toBe("severe");
    expect(r.disposition.score).toBeGreaterThan(0.6);
  });

  it("flags severe anchoring when BUY price is 30% above 30d high", () => {
    const symbol = "X";
    const lots: LotInput[] = [];
    const snaps: SnapshotInput[] = [];
    for (let d = 1; d <= 31; d++) {
      snaps.push(snap(symbol, `2026-01-${String(d).padStart(2, "0")}`, 100));
    }
    for (let i = 0; i < 5; i++) {
      lots.push(buy(`p${i}`, symbol, "2026-02-01", 130, 1));
      lots.push(sell(`p${i}`, symbol, "2026-02-05", 131, 1));
    }
    snaps.push(snap(symbol, "2026-02-01", 130));
    const r = computeInsights(lots, snaps);
    if ("empty" in r) throw new Error("expected non-empty");
    expect(r.anchoring.flag).toBe("severe");
    expect(r.anchoring.avgChaseHighPct).toBeGreaterThan(15);
  });

  it("flags severe overtrading: > 10 trades/week + flips ≥ 3", () => {
    const lots: LotInput[] = [];
    for (let i = 0; i < 6; i++) {
      lots.push(buy(`p${i}`, "AAA", `2026-01-${String(i + 1).padStart(2, "0")}`, 100, 1));
      lots.push(sell(`p${i}`, "AAA", `2026-01-${String(i + 2).padStart(2, "0")}`, 101, 1));
    }
    const r = computeInsights(lots, []);
    if ("empty" in r) throw new Error("expected non-empty");
    expect(r.overtrading.flag).toBe("severe");
  });
});
