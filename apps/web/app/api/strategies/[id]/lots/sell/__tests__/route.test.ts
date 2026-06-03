// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRecordSell } = vi.hoisted(() => ({ mockRecordSell: vi.fn() }));
vi.mock("@/lib/position-service", () => ({ recordSell: mockRecordSell }));

import { POST } from "../route";

function postReq(body: any) {
  return new Request("http://localhost/api/strategies/s1/lots/sell", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ id: "strat-1" }) };

describe("POST /api/strategies/[id]/lots/sell", () => {
  beforeEach(() => mockRecordSell.mockReset());

  it("records a sell scoped to strategy and returns 201", async () => {
    mockRecordSell.mockResolvedValueOnce({ positionId: "p1", lot: { id: "s1" }, status: 201 });
    const res = await POST(postReq({ symbol: "qqq", shares: 5, price: "400", sellDate: "2026-06-01" }), ctx);
    expect(res.status).toBe(201);
    expect(mockRecordSell).toHaveBeenCalledWith("strat-1", "QQQ", 5, "400", "2026-06-01", undefined);
  });

  it("returns 400 when price <= 0", async () => {
    const res = await POST(postReq({ symbol: "QQQ", shares: 5, price: "0", sellDate: "2026-06-01" }), ctx);
    expect(res.status).toBe(400);
    expect(mockRecordSell).not.toHaveBeenCalled();
  });

  it("propagates service 404", async () => {
    mockRecordSell.mockResolvedValueOnce({ error: "no position to sell", status: 404 });
    const res = await POST(postReq({ symbol: "QQQ", shares: 5, price: "400", sellDate: "2026-06-01" }), ctx);
    expect(res.status).toBe(404);
  });
});
