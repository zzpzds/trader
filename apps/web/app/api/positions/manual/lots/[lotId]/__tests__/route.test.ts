// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  countWhere: vi.fn(),
  deleteWhere: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      positionLots: { findFirst: h.findFirst },
    },
    delete: vi.fn(() => ({ where: h.deleteWhere })),
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: h.countWhere,
    })),
  },
}));

import { DELETE } from "../route";

function mkReq(lotId: string) {
  return {
    request: new Request("http://localhost/x", { method: "DELETE" }),
    ctx: { params: Promise.resolve({ lotId }) },
  };
}

describe("DELETE /api/positions/manual/lots/:lotId", () => {
  beforeEach(() => {
    h.findFirst.mockReset();
    h.countWhere.mockReset();
    h.deleteWhere.mockReset().mockResolvedValue(undefined);
  });

  it("returns 404 when lot not found", async () => {
    h.findFirst.mockResolvedValueOnce(null);
    const { request, ctx } = mkReq("nope");
    const res = await DELETE(request, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 404 when lot belongs to a strategy-bound position", async () => {
    h.findFirst.mockResolvedValueOnce({
      id: "l1",
      positionId: "p1",
      position: { strategyId: "strat-1" },
    });
    const { request, ctx } = mkReq("l1");
    const res = await DELETE(request, ctx);
    expect(res.status).toBe(404);
  });

  it("deletes lot only when other lots remain", async () => {
    h.findFirst.mockResolvedValueOnce({
      id: "l1",
      positionId: "p1",
      position: { strategyId: null },
    });
    h.countWhere.mockResolvedValueOnce([{ count: 2 }]);

    const { request, ctx } = mkReq("l1");
    const res = await DELETE(request, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedPosition: false });
    // delete called once for the lot
    expect(h.deleteWhere).toHaveBeenCalledTimes(1);
  });

  it("deletes lot AND position when no lots remain", async () => {
    h.findFirst.mockResolvedValueOnce({
      id: "l1",
      positionId: "p1",
      position: { strategyId: null },
    });
    h.countWhere.mockResolvedValueOnce([{ count: 0 }]);

    const { request, ctx } = mkReq("l1");
    const res = await DELETE(request, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedPosition: true });
    // delete called twice: once for lot, once for position
    expect(h.deleteWhere).toHaveBeenCalledTimes(2);
  });
});
