// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRecordSell } = vi.hoisted(() => ({ mockRecordSell: vi.fn() }));
vi.mock("@/lib/position-service", () => ({ recordSell: mockRecordSell }));

import { POST } from "../route";

function postReq(body: any) {
  return new Request("http://localhost/api/positions/manual/sell", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/positions/manual/sell", () => {
  beforeEach(() => mockRecordSell.mockReset());

  it("records a sell and returns 201", async () => {
    mockRecordSell.mockResolvedValueOnce({ positionId: "p1", lot: { id: "s1" }, status: 201 });
    const res = await POST(postReq({ symbol: "aapl", shares: 5, price: "150", sellDate: "2026-06-01" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ positionId: "p1", lotId: "s1" });
    expect(mockRecordSell).toHaveBeenCalledWith(null, "AAPL", 5, "150", "2026-06-01", undefined);
  });

  it("returns 400 when shares <= 0", async () => {
    const res = await POST(postReq({ symbol: "AAPL", shares: 0, price: "150", sellDate: "2026-06-01" }));
    expect(res.status).toBe(400);
    expect(mockRecordSell).not.toHaveBeenCalled();
  });

  it("returns 400 when sellDate is in the future", async () => {
    const future = new Date(Date.now() + 86_400_000 * 2).toISOString().slice(0, 10);
    const res = await POST(postReq({ symbol: "AAPL", shares: 1, price: "150", sellDate: future }));
    expect(res.status).toBe(400);
    expect(mockRecordSell).not.toHaveBeenCalled();
  });

  it("propagates service error status (oversell -> 400)", async () => {
    mockRecordSell.mockResolvedValueOnce({ error: "cannot sell more shares than held", status: 400 });
    const res = await POST(postReq({ symbol: "AAPL", shares: 999, price: "150", sellDate: "2026-06-01" }));
    expect(res.status).toBe(400);
  });
});
