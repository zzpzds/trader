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

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _type: "and", args }),
  eq: (col: unknown, val: unknown) => ({ _type: "eq", col, val }),
  gte: (col: unknown, val: unknown) => ({ _type: "gte", col, val }),
}));

vi.mock("@trader/db", () => ({
  monitoringRuns: { status: "status", runDate: "runDate" },
  positions: {},
}));

import { GET } from "../route";

const posQQQ = {
  id: "pos-1",
  strategyId: "strat-1",
  symbol: "QQQ",
  positionLots: [{ shares: 10, costPrice: "100.0000" }],
};

const run1 = {
  id: "run-1",
  strategyId: "strat-1",
  runDate: "2026-05-01",
  status: "completed",
  prices: { QQQ: 110 },
  createdAt: new Date("2026-05-01T10:00:00Z"),
};

const run2 = {
  id: "run-2",
  strategyId: "strat-1",
  runDate: "2026-05-02",
  status: "completed",
  prices: { QQQ: 120 },
  createdAt: new Date("2026-05-02T10:00:00Z"),
};

function makeRequest(range = "1m") {
  return new Request(`http://localhost/api/positions/history?range=${range}`);
}

describe("GET /api/positions/history", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty array when no positions", async () => {
    mockPositionsFindMany.mockResolvedValueOnce([]);
    mockRunsFindMany.mockResolvedValueOnce([]);

    const res = await GET(makeRequest());
    expect(await res.json()).toEqual([]);
  });

  it("calculates percentPnl for each date", async () => {
    mockPositionsFindMany.mockResolvedValueOnce([posQQQ]);
    mockRunsFindMany.mockResolvedValueOnce([run1, run2]);

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(data).toEqual([
      { date: "2026-05-01", percentPnl: 10 },   // (110-100)/100 * 100
      { date: "2026-05-02", percentPnl: 20 },   // (120-100)/100 * 100
    ]);
  });

  it("skips dates where no symbol has a price", async () => {
    const runNoPrices = {
      ...run1,
      runDate: "2026-05-01",
      prices: { SPY: 500 }, // symbol not in positions
    };

    mockPositionsFindMany.mockResolvedValueOnce([posQQQ]);
    mockRunsFindMany.mockResolvedValueOnce([runNoPrices]);

    const res = await GET(makeRequest());
    expect(await res.json()).toEqual([]);
  });

  it("uses the latest run when multiple runs exist for the same date", async () => {
    const olderRun = {
      ...run1,
      id: "run-old",
      prices: { QQQ: 50 }, // stale price
      createdAt: new Date("2026-05-01T08:00:00Z"),
    };
    const newerRun = {
      ...run1,
      id: "run-new",
      prices: { QQQ: 110 },
      createdAt: new Date("2026-05-01T10:00:00Z"),
    };

    mockPositionsFindMany.mockResolvedValueOnce([posQQQ]);
    // Route orders by runDate ASC, createdAt ASC — newer comes last
    mockRunsFindMany.mockResolvedValueOnce([olderRun, newerRun]);

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(data).toEqual([{ date: "2026-05-01", percentPnl: 10 }]); // uses 110, not 50
  });

  it("aggregates across multiple strategies on the same date", async () => {
    const posSPY = {
      id: "pos-2",
      strategyId: "strat-2",
      symbol: "SPY",
      positionLots: [{ shares: 2, costPrice: "500.0000" }],
    };
    const runSPY = {
      id: "run-spy",
      strategyId: "strat-2",
      runDate: "2026-05-01",
      status: "completed",
      prices: { SPY: 550 },
      createdAt: new Date("2026-05-01T10:00:00Z"),
    };

    mockPositionsFindMany.mockResolvedValueOnce([posQQQ, posSPY]);
    mockRunsFindMany.mockResolvedValueOnce([run1, runSPY]);

    const res = await GET(makeRequest());
    const data = await res.json();

    // QQQ: 10*110=1100, cost 1000. SPY: 2*550=1100, cost 1000.
    // total value=2200, total cost=2000, pnl=10%
    expect(data).toEqual([{ date: "2026-05-01", percentPnl: 10 }]);
  });
});
