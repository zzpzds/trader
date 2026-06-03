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
import { upsertPositionAndCreateLot, deleteLotAndCheckPosition, recordSell } from "../position-service";

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

  it("sets referencePrice from costPrice when creating new position", async () => {
    (db.query.positions.findFirst as any).mockResolvedValueOnce(undefined);

    const posInsertReturning = mockReturning([{ id: "pos-ref" }]);
    const posInsertValues = mockValues(posInsertReturning);
    const lotInsertValues = mockValues(mockReturning([
      { id: "lot-ref", positionId: "pos-ref", shares: 10, costPrice: "250.00", lotDate: "2025-03-01" },
    ]));

    let insertCallCount = 0;
    (db.insert as any).mockImplementation(() => {
      insertCallCount++;
      if (insertCallCount === 1) return posInsertValues;
      return lotInsertValues;
    });

    await upsertPositionAndCreateLot("strat-1", "ISRG", 10, "250.00", "2025-03-01");

    expect(posInsertValues.values).toHaveBeenCalledWith(
      expect.objectContaining({ referencePrice: "250.00" })
    );
  });

  it("does not overwrite referencePrice when position already exists", async () => {
    (db.query.positions.findFirst as any).mockResolvedValueOnce({
      id: "pos-existing",
      strategyId: "strat-1",
      symbol: "ISRG",
      referencePrice: "200.00",
    });

    const updateSetMock = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValueOnce([{ id: "pos-existing" }]),
      }),
    });
    (db.update as any).mockReturnValue({ set: updateSetMock });

    const lotInsertValues = mockValues(mockReturning([
      { id: "lot-3", positionId: "pos-existing", shares: 5, costPrice: "260.00", lotDate: "2025-04-01" },
    ]));
    (db.insert as any).mockReturnValue(lotInsertValues);

    await upsertPositionAndCreateLot("strat-1", "ISRG", 5, "260.00", "2025-04-01");

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ referencePrice: expect.anything() })
    );
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

describe("recordSell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when no position exists", async () => {
    (db.query.positions.findFirst as any).mockResolvedValueOnce(undefined);
    const r = await recordSell(null, "AAPL", 10, "150", "2026-05-01");
    expect(r.status).toBe(404);
    expect(r.error).toBeTruthy();
  });

  it("rejects selling more than held", async () => {
    (db.query.positions.findFirst as any).mockResolvedValueOnce({
      id: "p1",
      strategyId: null,
      symbol: "AAPL",
      positionLots: [
        { id: "l1", type: "BUY", shares: "10", costPrice: "100", lotDate: "2026-05-01", createdAt: new Date() },
      ],
    });
    const r = await recordSell(null, "AAPL", 20, "150", "2026-05-02");
    expect(r.status).toBe(400);
  });

  it("rejects sellDate before first buy", async () => {
    (db.query.positions.findFirst as any).mockResolvedValueOnce({
      id: "p1",
      strategyId: null,
      symbol: "AAPL",
      positionLots: [
        { id: "l1", type: "BUY", shares: "10", costPrice: "100", lotDate: "2026-05-10", createdAt: new Date() },
      ],
    });
    const r = await recordSell(null, "AAPL", 5, "150", "2026-05-01");
    expect(r.status).toBe(400);
  });

  it("inserts a SELL lot when valid", async () => {
    (db.query.positions.findFirst as any).mockResolvedValueOnce({
      id: "p1",
      strategyId: null,
      symbol: "AAPL",
      positionLots: [
        { id: "l1", type: "BUY", shares: "10", costPrice: "100", lotDate: "2026-05-01", createdAt: new Date() },
      ],
    });
    const lotInsert = mockValues(mockReturning([{ id: "sell-1" }]));
    (db.insert as any).mockReturnValue(lotInsert);

    const r = await recordSell(null, "AAPL", 5, "150", "2026-05-02", "trim");
    expect(r.status).toBe(201);
    expect(r.positionId).toBe("p1");
    expect(r.lot.id).toBe("sell-1");
    expect(lotInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({ positionId: "p1", type: "SELL", costPrice: "150", lotDate: "2026-05-02" })
    );
  });
});
