// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPositionsFindMany, mockRunsFindMany } = vi.hoisted(() => ({
  mockPositionsFindMany: vi.fn(),
  mockRunsFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      positions: { findMany: mockPositionsFindMany },
      monitoringRuns: { findMany: mockRunsFindMany },
    },
  },
}));

import { GET } from "../route";

const posQQQ = {
  id: "pos-1",
  strategyId: "strat-1",
  symbol: "QQQ",
  positionLots: [{ shares: 10, costPrice: "100.0000" }],
};

const runWithPrices = {
  id: "run-1",
  strategyId: "strat-1",
  prices: { QQQ: 120 },
  createdAt: new Date("2026-05-25T10:00:00Z"),
};

describe("GET /api/positions/summary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns zeros when no positions exist", async () => {
    mockPositionsFindMany.mockResolvedValueOnce([]);
    mockRunsFindMany.mockResolvedValueOnce([]);

    const res = await GET();
    const data = await res.json();

    expect(data).toEqual({
      totalCost: 0,
      totalValue: 0,
      absolutePnl: 0,
      percentPnl: 0,
      coveredPositions: 0,
      totalPositions: 0,
    });
  });

  it("calculates pnl for a position with a price", async () => {
    mockPositionsFindMany.mockResolvedValueOnce([posQQQ]);
    mockRunsFindMany.mockResolvedValueOnce([runWithPrices]);

    const res = await GET();
    const data = await res.json();

    expect(data.totalCost).toBe(1000);    // 10 * 100
    expect(data.totalValue).toBe(1200);   // 10 * 120
    expect(data.absolutePnl).toBe(200);   // 1200 - 1000
    expect(data.percentPnl).toBe(20);     // 200/1000 * 100
    expect(data.coveredPositions).toBe(1);
    expect(data.totalPositions).toBe(1);
  });

  it("includes cost of unpriced positions in totalCost but not in pnl", async () => {
    const posSPY = {
      id: "pos-2",
      strategyId: "strat-2",
      symbol: "SPY",
      positionLots: [{ shares: 5, costPrice: "200.0000" }],
    };

    mockPositionsFindMany.mockResolvedValueOnce([posQQQ, posSPY]);
    mockRunsFindMany.mockResolvedValueOnce([runWithPrices]); // strat-2 has no run

    const res = await GET();
    const data = await res.json();

    expect(data.totalCost).toBe(2000);  // 1000 + 1000
    expect(data.totalValue).toBe(1200); // only QQQ
    expect(data.coveredPositions).toBe(1);
    expect(data.totalPositions).toBe(2);
  });

  it("uses the latest monitoring run when multiple exist for a strategy", async () => {
    const olderRun = {
      id: "run-old",
      strategyId: "strat-1",
      prices: { QQQ: 90 },
      createdAt: new Date("2026-05-24T10:00:00Z"),
    };

    mockPositionsFindMany.mockResolvedValueOnce([posQQQ]);
    // newest first (route queries desc by createdAt)
    mockRunsFindMany.mockResolvedValueOnce([runWithPrices, olderRun]);

    const res = await GET();
    const data = await res.json();

    expect(data.totalValue).toBe(1200); // uses price 120 from latest run, not 90
  });

  it("skips positions with no lots", async () => {
    const emptyPos = { id: "pos-empty", strategyId: "strat-1", symbol: "TQQQ", positionLots: [] };

    mockPositionsFindMany.mockResolvedValueOnce([emptyPos]);
    mockRunsFindMany.mockResolvedValueOnce([runWithPrices]);

    const res = await GET();
    const data = await res.json();

    expect(data.totalCost).toBe(0);
    expect(data.totalPositions).toBe(1);
  });
});
