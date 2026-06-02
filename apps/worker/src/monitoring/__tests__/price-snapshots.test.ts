// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { upsertSnapshots } from "../price-snapshots.js";

describe("upsertSnapshots", () => {
  it("calls insert + onConflictDoUpdate per (symbol, date)", async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const db: any = { insert };

    await upsertSnapshots(db, {
      AAPL: {
        latest: 101,
        bars: [
          { date: "2026-06-01", open: 99, high: 101, low: 98, close: 100, volume: 1000 },
          { date: "2026-06-02", open: 100, high: 102, low: 99, close: 101, volume: 1100 },
        ],
      },
    });

    expect(insert).toHaveBeenCalledTimes(2);
    expect(values).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ symbol: "AAPL", date: "2026-06-01", close: "100" })
    );
    expect(values).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ symbol: "AAPL", date: "2026-06-02", close: "101" })
    );
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(2);
  });

  it("handles null volume", async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const db: any = { insert };

    await upsertSnapshots(db, {
      QQQ: {
        latest: 50,
        bars: [
          {
            date: "2026-06-01",
            open: 50,
            high: 50,
            low: 50,
            close: 50,
            volume: undefined as unknown as number,
          },
        ],
      },
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: "QQQ", volume: null })
    );
  });
});
