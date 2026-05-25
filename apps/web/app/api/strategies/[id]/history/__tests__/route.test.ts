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
  monitoringRuns: { strategyId: "strategyId", status: "status", runDate: "runDate" },
  positions: { strategyId: "strategyId" },
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

function makeRequest(strategyId = "strat-1", range = "1m") {
  return {
    request: new Request(`http://localhost/api/strategies/${strategyId}/history?range=${range}`),
    params: Promise.resolve({ id: strategyId }),
  };
}

describe("GET /api/strategies/[id]/history", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty array when no positions", async () => {
    mockPositionsFindMany.mockResolvedValueOnce([]);
    mockRunsFindMany.mockResolvedValueOnce([]);

    const { request, params } = makeRequest();
    const res = await GET(request, { params });
    expect(await res.json()).toEqual([]);
  });

  it("calculates percentPnl for each date", async () => {
    const run2 = {
      ...run1,
      id: "run-2",
      runDate: "2026-05-02",
      prices: { QQQ: 120 },
      createdAt: new Date("2026-05-02T10:00:00Z"),
    };

    mockPositionsFindMany.mockResolvedValueOnce([posQQQ]);
    mockRunsFindMany.mockResolvedValueOnce([run1, run2]);

    const { request, params } = makeRequest();
    const res = await GET(request, { params });
    const data = await res.json();

    expect(data).toEqual([
      { date: "2026-05-01", percentPnl: 10 },
      { date: "2026-05-02", percentPnl: 20 },
    ]);
  });

  it("skips dates where no symbol has a price", async () => {
    const runWrongSymbol = { ...run1, prices: { SPY: 500 } };

    mockPositionsFindMany.mockResolvedValueOnce([posQQQ]);
    mockRunsFindMany.mockResolvedValueOnce([runWrongSymbol]);

    const { request, params } = makeRequest();
    const res = await GET(request, { params });
    expect(await res.json()).toEqual([]);
  });

  it("uses latest run when multiple runs exist for same date", async () => {
    const olderRun = { ...run1, prices: { QQQ: 50 }, createdAt: new Date("2026-05-01T08:00:00Z") };
    const newerRun = { ...run1, prices: { QQQ: 110 }, createdAt: new Date("2026-05-01T10:00:00Z") };

    mockPositionsFindMany.mockResolvedValueOnce([posQQQ]);
    mockRunsFindMany.mockResolvedValueOnce([olderRun, newerRun]);

    const { request, params } = makeRequest();
    const res = await GET(request, { params });
    const data = await res.json();

    expect(data).toEqual([{ date: "2026-05-01", percentPnl: 10 }]);
  });
});
