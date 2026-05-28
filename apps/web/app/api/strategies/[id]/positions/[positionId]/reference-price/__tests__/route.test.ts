// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPositionsFindFirst, mockPositionsUpdate } = vi.hoisted(() => ({
  mockPositionsFindFirst: vi.fn(),
  mockPositionsUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      positions: { findFirst: mockPositionsFindFirst },
    },
    update: mockPositionsUpdate,
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _type: "and", args }),
  eq: (col: unknown, val: unknown) => ({ _type: "eq", col, val }),
}));

vi.mock("@trader/db", () => ({
  positions: { id: "id", strategyId: "strategyId" },
}));

import { PATCH } from "../route";

function makeRequest(body: object, strategyId = "strat-1", positionId = "pos-1") {
  return {
    request: new Request(
      `http://localhost/api/strategies/${strategyId}/positions/${positionId}/reference-price`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    ),
    params: Promise.resolve({ id: strategyId, positionId }),
  };
}

describe("PATCH /api/strategies/[id]/positions/[positionId]/reference-price", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when referencePrice is missing", async () => {
    const { request, params } = makeRequest({});
    const res = await PATCH(request, { params });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("referencePrice") });
  });

  it("returns 404 when position not found", async () => {
    mockPositionsFindFirst.mockResolvedValueOnce(undefined);
    const { request, params } = makeRequest({ referencePrice: "350.00" });
    const res = await PATCH(request, { params });
    expect(res.status).toBe(404);
  });

  it("updates referencePrice and returns updated position", async () => {
    const existingPos = { id: "pos-1", strategyId: "strat-1", symbol: "ISRG", referencePrice: "300.00" };
    const updatedPos = { ...existingPos, referencePrice: "350.00" };

    mockPositionsFindFirst.mockResolvedValueOnce(existingPos);
    mockPositionsUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValueOnce([updatedPos]),
        }),
      }),
    });

    const { request, params } = makeRequest({ referencePrice: "350.00" });
    const res = await PATCH(request, { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ referencePrice: "350.00" });
  });
});
