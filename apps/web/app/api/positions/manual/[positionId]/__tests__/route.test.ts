// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  deleteWhere: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: { positions: { findFirst: h.findFirst } },
    delete: vi.fn(() => ({ where: h.deleteWhere })),
  },
}));

import { DELETE } from "../route";

function mkReq(positionId: string) {
  return {
    request: new Request("http://localhost/x", { method: "DELETE" }),
    ctx: { params: Promise.resolve({ positionId }) },
  };
}

describe("DELETE /api/positions/manual/:positionId", () => {
  beforeEach(() => {
    h.findFirst.mockReset();
    h.deleteWhere.mockReset().mockResolvedValue(undefined);
  });

  it("returns 404 when position not found", async () => {
    h.findFirst.mockResolvedValueOnce(null);
    const { request, ctx } = mkReq("nope");
    const res = await DELETE(request, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 404 when position has a strategy", async () => {
    h.findFirst.mockResolvedValueOnce({ id: "p1", strategyId: "s1" });
    const { request, ctx } = mkReq("p1");
    const res = await DELETE(request, ctx);
    expect(res.status).toBe(404);
    expect(h.deleteWhere).not.toHaveBeenCalled();
  });

  it("deletes manual position when strategyId is null", async () => {
    h.findFirst.mockResolvedValueOnce({ id: "p1", strategyId: null });
    const { request, ctx } = mkReq("p1");
    const res = await DELETE(request, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.deleteWhere).toHaveBeenCalledTimes(1);
  });
});
