// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPositionsFindMany, mockSelect } = vi.hoisted(() => ({
  mockPositionsFindMany: vi.fn(),
  mockSelect: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: { positions: { findMany: mockPositionsFindMany } },
    select: mockSelect,
  },
}));

import { GET } from "../route";

function makeSnapshotChain(closeValue: string | null) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(closeValue == null ? [] : [{ close: closeValue }]),
  };
}

const posQQQ = {
  id: "pos-1",
  strategyId: "strat-1",
  symbol: "QQQ",
  positionLots: [{ shares: "10", costPrice: "100.0000" }],
};

const posManualAAPL = {
  id: "pos-2",
  strategyId: null,
  symbol: "AAPL",
  positionLots: [{ shares: "5", costPrice: "150.0000" }],
};

describe("GET /api/positions/summary", () => {
  beforeEach(() => {
    mockPositionsFindMany.mockReset();
    mockSelect.mockReset();
  });

  it("returns zeros when no positions exist", async () => {
    mockPositionsFindMany.mockResolvedValueOnce([]);

    const res = await GET();
    const data = await res.json();

    expect(data).toEqual({
      totalCost: 0,
      totalValue: 0,
      absolutePnl: 0,
      percentPnl: 0,
      realizedPnl: 0,
      coveredPositions: 0,
      totalPositions: 0,
    });
  });

  it("aggregates strategy + manual positions; reads latest price from price_snapshots", async () => {
    mockPositionsFindMany.mockResolvedValueOnce([posQQQ, posManualAAPL]);
    mockSelect
      .mockReturnValueOnce(makeSnapshotChain("120"))     // QQQ
      .mockReturnValueOnce(makeSnapshotChain("160"));    // AAPL

    const res = await GET();
    const data = await res.json();

    expect(data.totalCost).toBe(1750);    // 10*100 + 5*150
    expect(data.totalValue).toBe(2000);   // 10*120 + 5*160
    expect(data.absolutePnl).toBe(250);
    expect(data.coveredPositions).toBe(2);
    expect(data.totalPositions).toBe(2);
  });

  it("includes cost of unpriced positions in totalCost but not in pnl", async () => {
    mockPositionsFindMany.mockResolvedValueOnce([posQQQ, posManualAAPL]);
    mockSelect
      .mockReturnValueOnce(makeSnapshotChain("120"))     // QQQ priced
      .mockReturnValueOnce(makeSnapshotChain(null));     // AAPL unpriced

    const res = await GET();
    const data = await res.json();

    expect(data.totalCost).toBe(1750);   // 1000 + 750
    expect(data.totalValue).toBe(1200);  // only QQQ
    expect(data.coveredPositions).toBe(1);
    expect(data.totalPositions).toBe(2);
  });

  it("skips positions with no lots", async () => {
    const emptyPos = {
      id: "pos-empty",
      strategyId: "strat-1",
      symbol: "TQQQ",
      positionLots: [],
    };
    mockPositionsFindMany.mockResolvedValueOnce([emptyPos]);
    mockSelect.mockReturnValueOnce(makeSnapshotChain(null));

    const res = await GET();
    const data = await res.json();

    expect(data.totalCost).toBe(0);
    expect(data.totalPositions).toBe(1);
  });

  it("nets out sells: cost/value/收益 use held shares only, realized shown separately", async () => {
    const posWithSell = {
      id: "pos-sell",
      strategyId: null,
      symbol: "UNH",
      positionLots: [
        { id: "l1", type: "BUY", shares: "10", costPrice: "100.0000", lotDate: "2026-01-01", createdAt: new Date("2026-01-01") },
        { id: "l2", type: "SELL", shares: "4", costPrice: "130.0000", lotDate: "2026-02-01", createdAt: new Date("2026-02-01") },
      ],
    };
    mockPositionsFindMany.mockResolvedValueOnce([posWithSell]);
    mockSelect.mockReturnValueOnce(makeSnapshotChain("150"));

    const res = await GET();
    const data = await res.json();

    // held 6 @ avg 100; sold 4 @ 130 → realized (130-100)*4 = 120
    expect(data.totalCost).toBe(600);     // 6 * 100 held cost (not 10*100 + 4*130)
    expect(data.totalValue).toBe(900);    // 6 * 150
    expect(data.absolutePnl).toBe(300);   // unrealized only: 900 - 600
    expect(data.realizedPnl).toBe(120);
    expect(data.coveredPositions).toBe(1);
  });

  it("does not query monitoringRuns anymore", async () => {
    mockPositionsFindMany.mockResolvedValueOnce([posQQQ]);
    mockSelect.mockReturnValueOnce(makeSnapshotChain("120"));

    await GET();
    // mockSelect should be called once (for QQQ snapshot lookup)
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });
});
