// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      positions: { findFirst: vi.fn() },
      positionLots: { findFirst: vi.fn() },
    },
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

import { db } from "@/lib/db";
import { upsertPositionAndCreateLot, deleteLotAndCheckPosition } from "../position-service";

function mockReturning(rows: any[]) {
  return { returning: vi.fn().mockResolvedValueOnce(rows) };
}
function mockValues(returningMock: any) {
  return { values: vi.fn().mockReturnValue(returningMock) };
}

describe("upsertPositionAndCreateLot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates new position when none exists, then creates lot", async () => {
    (db.query.positions.findFirst as any).mockResolvedValueOnce(undefined);

    // First insert: position
    const posInsertValues = mockValues(mockReturning([{ id: "pos-1" }]));
    // Second insert: lot
    const lotInsertValues = mockValues(mockReturning([{ id: "lot-1", positionId: "pos-1", shares: 100, costPrice: "150.00", lotDate: "2025-01-01" }]));

    let insertCallCount = 0;
    (db.insert as any).mockImplementation(() => {
      insertCallCount++;
      if (insertCallCount === 1) return posInsertValues;
      return lotInsertValues;
    });

    const result = await upsertPositionAndCreateLot(
      "strat-1", "QQQ", 100, "150.00", "2025-01-01"
    );

    expect(result.positionId).toBe("pos-1");
    expect(result.lot.id).toBe("lot-1");
    expect(insertCallCount).toBe(2);
  });

  it("uses existing position when one exists", async () => {
    (db.query.positions.findFirst as any).mockResolvedValueOnce({
      id: "pos-existing",
      strategyId: "strat-1",
      symbol: "QQQ",
    });

    (db.update as any).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValueOnce([{ id: "pos-existing" }]),
        }),
      }),
    });

    const lotInsertValues = mockValues(mockReturning([
      { id: "lot-2", positionId: "pos-existing", shares: 50, costPrice: "160.00", lotDate: "2025-02-01" },
    ]));

    (db.insert as any).mockReturnValue(lotInsertValues);

    const result = await upsertPositionAndCreateLot(
      "strat-1", "QQQ", 50, "160.00", "2025-02-01"
    );

    expect(result.positionId).toBe("pos-existing");
    expect(result.lot.id).toBe("lot-2");
  });
});

describe("deleteLotAndCheckPosition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when lot not found", async () => {
    (db.query.positionLots.findFirst as any).mockResolvedValueOnce(undefined);
    (db.delete as any).mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValueOnce([]),
      }),
    });

    const result = await deleteLotAndCheckPosition("nonexistent");
    expect(result).toBeNull();
  });

  it("deletes and returns the lot when found", async () => {
    const lot = { id: "lot-1", positionId: "pos-1", shares: 100, costPrice: "150.00", lotDate: "2025-01-01", notes: null };
    (db.query.positionLots.findFirst as any).mockResolvedValueOnce(lot);
    (db.delete as any).mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValueOnce([lot]),
      }),
    });

    const result = await deleteLotAndCheckPosition("lot-1");
    expect(result).toEqual(lot);
  });
});
