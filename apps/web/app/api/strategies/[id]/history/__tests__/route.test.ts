// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { findMany, selectMock } = vi.hoisted(() => ({ findMany: vi.fn(), selectMock: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { query: { positions: { findMany } }, select: selectMock },
}));

import { GET } from "../route";
const ctx = { params: Promise.resolve({ id: "strat-1" }) };

function chain(rows: any[]) {
  return { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockResolvedValue(rows) };
}

describe("GET /api/strategies/[id]/history", () => {
  beforeEach(() => { findMany.mockReset(); selectMock.mockReset(); });

  it("returns empty when no positions", async () => {
    findMany.mockResolvedValueOnce([]);
    const res = await GET(new Request("http://localhost?range=all"), ctx);
    expect(await res.json()).toEqual([]);
  });

  it("reflects realized pnl after a sell", async () => {
    findMany.mockResolvedValueOnce([
      {
        symbol: "QQQ",
        positionLots: [
          { id: "b", type: "BUY", shares: "100", costPrice: "10", lotDate: "2026-01-01", createdAt: new Date("2026-01-01") },
          { id: "s", type: "SELL", shares: "100", costPrice: "15", lotDate: "2026-01-03", createdAt: new Date("2026-01-03") },
        ],
      },
    ]);
    selectMock.mockReturnValueOnce(chain([
      { symbol: "QQQ", date: "2026-01-01", close: "10" },
      { symbol: "QQQ", date: "2026-01-02", close: "12" },
      { symbol: "QQQ", date: "2026-01-03", close: "15" },
    ]));

    const res = await GET(new Request("http://localhost?range=all"), ctx);
    expect(await res.json()).toEqual([
      { date: "2026-01-01", percentPnl: 0 },
      { date: "2026-01-02", percentPnl: 20 },
      { date: "2026-01-03", percentPnl: 50 },
    ]);
  });
});
