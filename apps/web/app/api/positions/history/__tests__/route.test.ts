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

function makeSelectChain(rows: any[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(rows),
  };
}

const posQQQ = {
  id: "pos-1",
  strategyId: "strat-1",
  symbol: "QQQ",
  positionLots: [{ id: "lq", type: "BUY", shares: "10", costPrice: "100.0000", lotDate: "2026-01-01", createdAt: new Date("2026-01-01") }],
};

const posManualAAPL = {
  id: "pos-2",
  strategyId: null,
  symbol: "AAPL",
  positionLots: [{ id: "la", type: "BUY", shares: "5", costPrice: "150.0000", lotDate: "2026-01-01", createdAt: new Date("2026-01-01") }],
};

function makeRequest(range = "1m") {
  return new Request(`http://localhost/api/positions/history?range=${range}`);
}

describe("GET /api/positions/history", () => {
  beforeEach(() => {
    mockPositionsFindMany.mockReset();
    mockSelect.mockReset();
  });

  it("returns empty when no positions", async () => {
    mockPositionsFindMany.mockResolvedValueOnce([]);
    const res = await GET(makeRequest());
    expect(await res.json()).toEqual([]);
  });

  it("calculates percentPnl for each date from price_snapshots", async () => {
    mockPositionsFindMany.mockResolvedValueOnce([posQQQ]);
    mockSelect.mockReturnValueOnce(
      makeSelectChain([
        { symbol: "QQQ", date: "2026-05-01", close: "110" },
        { symbol: "QQQ", date: "2026-05-02", close: "120" },
      ])
    );

    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data).toEqual([
      { date: "2026-05-01", percentPnl: 10 },
      { date: "2026-05-02", percentPnl: 20 },
    ]);
  });

  it("includes manual positions in the curve", async () => {
    mockPositionsFindMany.mockResolvedValueOnce([posQQQ, posManualAAPL]);
    mockSelect.mockReturnValueOnce(
      makeSelectChain([
        { symbol: "QQQ", date: "2026-05-01", close: "110" },
        { symbol: "AAPL", date: "2026-05-01", close: "165" },
      ])
    );

    const res = await GET(makeRequest());
    const data = await res.json();
    // QQQ: cost 1000, value 1100. AAPL: cost 750, value 825.
    // total value=1925, total cost=1750, pnl = (1925-1750)/1750 * 100 = 10
    expect(data).toEqual([{ date: "2026-05-01", percentPnl: 10 }]);
  });

  it("skips dates where no covered symbol has a price", async () => {
    mockPositionsFindMany.mockResolvedValueOnce([posQQQ]);
    mockSelect.mockReturnValueOnce(makeSelectChain([])); // no snapshots
    const res = await GET(makeRequest());
    expect(await res.json()).toEqual([]);
  });

  it("reflects realized pnl after a sell across days", async () => {
    mockPositionsFindMany.mockResolvedValueOnce([
      {
        symbol: "AAA",
        positionLots: [
          { id: "b", type: "BUY", shares: "100", costPrice: "10", lotDate: "2026-01-01", createdAt: new Date("2026-01-01") },
          { id: "s", type: "SELL", shares: "100", costPrice: "15", lotDate: "2026-01-03", createdAt: new Date("2026-01-03") },
        ],
      },
    ]);
    mockSelect.mockReturnValueOnce(
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

  it("does not query monitoringRuns anymore", async () => {
    mockPositionsFindMany.mockResolvedValueOnce([posQQQ]);
    mockSelect.mockReturnValueOnce(makeSelectChain([]));

    await GET(makeRequest());
    // mockSelect should be the only DB call after positions findMany
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });
});
