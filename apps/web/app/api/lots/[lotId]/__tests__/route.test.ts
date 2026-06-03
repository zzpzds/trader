// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { findFirst, deleteMock } = vi.hoisted(() => ({ findFirst: vi.fn(), deleteMock: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { query: { positionLots: { findFirst } }, delete: deleteMock },
}));

import { DELETE } from "../route";

describe("DELETE /api/lots/[lotId] guard", () => {
  beforeEach(() => { findFirst.mockReset(); deleteMock.mockReset(); });

  it("returns 409 when deleting a buy would make holdings negative", async () => {
    findFirst.mockResolvedValueOnce({
      id: "buy1",
      positionId: "p1",
      type: "BUY",
      position: {
        positionLots: [
          { id: "buy1", type: "BUY", shares: "100", costPrice: "10", lotDate: "2026-01-01", createdAt: new Date("2026-01-01") },
          { id: "sell1", type: "SELL", shares: "80", costPrice: "15", lotDate: "2026-01-02", createdAt: new Date("2026-01-02") },
        ],
      },
    });
    const res = await DELETE(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ lotId: "buy1" }),
    });
    expect(res.status).toBe(409);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("deletes a safe lot (204)", async () => {
    findFirst.mockResolvedValueOnce({
      id: "sell1",
      positionId: "p1",
      type: "SELL",
      position: {
        positionLots: [
          { id: "buy1", type: "BUY", shares: "100", costPrice: "10", lotDate: "2026-01-01", createdAt: new Date("2026-01-01") },
          { id: "sell1", type: "SELL", shares: "80", costPrice: "15", lotDate: "2026-01-02", createdAt: new Date("2026-01-02") },
        ],
      },
    });
    deleteMock.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const res = await DELETE(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ lotId: "sell1" }),
    });
    expect(res.status).toBe(204);
  });
});
