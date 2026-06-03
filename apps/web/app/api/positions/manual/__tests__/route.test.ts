// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { findMany, snapshotSelect, mockUpsert, mockSend } = vi.hoisted(() => ({
  findMany: vi.fn(),
  snapshotSelect: vi.fn(),
  mockUpsert: vi.fn(),
  mockSend: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: { positions: { findMany } },
    select: snapshotSelect,
  },
}));

vi.mock("@/lib/position-service", () => ({ upsertPositionAndCreateLot: mockUpsert }));
vi.mock("@/lib/queue", () => ({
  getBoss: async () => ({ send: mockSend }),
}));

import { GET, POST } from "../route";

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

function postReq(body: any) {
  return new Request("http://localhost/api/positions/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/positions/manual", () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockSend.mockReset();
  });

  it("creates manual position with null strategyId, inserts lot, enqueues backfill", async () => {
    mockUpsert.mockResolvedValueOnce({ positionId: "p1", lot: { id: "l1" } });
    mockSend.mockResolvedValueOnce(undefined);

    const res = await POST(
      postReq({ symbol: "aapl", shares: 5, costPrice: "170.50", lotDate: "2026-06-01" })
    );

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toEqual({ positionId: "p1", lotId: "l1" });
    expect(mockUpsert).toHaveBeenCalledWith(null, "AAPL", 5, "170.50", "2026-06-01", undefined);
    expect(mockSend).toHaveBeenCalledWith("manual-backfill", {
      symbol: "AAPL",
      fromDate: "2026-06-01",
    });
  });

  it("returns 400 when lotDate is in the future", async () => {
    const future = new Date(Date.now() + 86_400_000 * 2).toISOString().slice(0, 10);
    const res = await POST(
      postReq({ symbol: "AAPL", shares: 1, costPrice: "1", lotDate: future })
    );
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns 400 when shares <= 0", async () => {
    const res = await POST(
      postReq({ symbol: "AAPL", shares: 0, costPrice: "1", lotDate: "2026-05-01" })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when costPrice <= 0", async () => {
    const res = await POST(
      postReq({ symbol: "AAPL", shares: 1, costPrice: "0", lotDate: "2026-05-01" })
    );
    expect(res.status).toBe(400);
  });

  it("still returns 201 even if boss.send fails (logs error, does not throw)", async () => {
    mockUpsert.mockResolvedValueOnce({ positionId: "p2", lot: { id: "l2" } });
    mockSend.mockRejectedValueOnce(new Error("queue down"));

    const res = await POST(
      postReq({ symbol: "TSLA", shares: 1, costPrice: "200", lotDate: "2026-05-01" })
    );
    expect(res.status).toBe(201);
  });
});
