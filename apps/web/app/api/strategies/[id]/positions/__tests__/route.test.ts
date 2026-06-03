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
