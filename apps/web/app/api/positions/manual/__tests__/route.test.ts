// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { findMany, snapshotSelect } = vi.hoisted(() => ({
  findMany: vi.fn(),
  snapshotSelect: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: { positions: { findMany } },
    select: snapshotSelect,
  },
}));

import { GET } from "../route";

function req() {
  return new Request("http://localhost/api/positions/manual");
}

function makeSelectChain(rows: any[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

describe("GET /api/positions/manual", () => {
  beforeEach(() => {
    findMany.mockReset();
    snapshotSelect.mockReset();
  });

  it("returns NULL-strategy positions with latest price from price_snapshots", async () => {
    findMany.mockResolvedValueOnce([
      {
        id: "p1",
        symbol: "AAPL",
        strategyId: null,
        positionLots: [
          { id: "l1", shares: "10.0000", costPrice: "150.0000", lotDate: "2026-05-01", notes: null },
        ],
      },
    ]);
    snapshotSelect.mockReturnValueOnce(makeSelectChain([{ close: "175.0000" }]));

    const res = await GET(req());
    const data = await res.json();

    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      id: "p1",
      symbol: "AAPL",
      latestPrice: 175,
    });
    expect(data[0].lots).toHaveLength(1);
  });

  it("returns latestPrice null when no snapshot exists", async () => {
    findMany.mockResolvedValueOnce([
      {
        id: "p2",
        symbol: "TSLA",
        strategyId: null,
        positionLots: [
          { id: "l2", shares: "1.0000", costPrice: "200.0000", lotDate: "2026-05-01", notes: null },
        ],
      },
    ]);
    snapshotSelect.mockReturnValueOnce(makeSelectChain([]));

    const res = await GET(req());
    const data = await res.json();
    expect(data[0].latestPrice).toBeNull();
  });

  it("returns empty array when no manual positions exist", async () => {
    findMany.mockResolvedValueOnce([]);

    const res = await GET(req());
    const data = await res.json();
    expect(data).toEqual([]);
  });
});
