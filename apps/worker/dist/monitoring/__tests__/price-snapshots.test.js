// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
vi.mock("../alphavantage-fetch.js", () => ({ fetchPrices: vi.fn() }));
import { upsertSnapshots, ensurePriceSnapshots } from "../price-snapshots.js";
import { fetchPrices } from "../alphavantage-fetch.js";
describe("upsertSnapshots", () => {
    it("calls insert + onConflictDoUpdate per (symbol, date)", async () => {
        const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
        const values = vi.fn(() => ({ onConflictDoUpdate }));
        const insert = vi.fn(() => ({ values }));
        const db = { insert };
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
        expect(values).toHaveBeenNthCalledWith(1, expect.objectContaining({ symbol: "AAPL", date: "2026-06-01", close: "100" }));
        expect(values).toHaveBeenNthCalledWith(2, expect.objectContaining({ symbol: "AAPL", date: "2026-06-02", close: "101" }));
        expect(onConflictDoUpdate).toHaveBeenCalledTimes(2);
    });
    it("handles null volume", async () => {
        const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
        const values = vi.fn(() => ({ onConflictDoUpdate }));
        const insert = vi.fn(() => ({ values }));
        const db = { insert };
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
                        volume: undefined,
                    },
                ],
            },
        });
        expect(values).toHaveBeenCalledWith(expect.objectContaining({ symbol: "QQQ", volume: null }));
    });
});
describe("ensurePriceSnapshots", () => {
    it("does nothing when existing data already covers fromDate", async () => {
        const where = vi.fn().mockResolvedValue([{ minDate: "2026-04-01" }]);
        const from = vi.fn().mockReturnValue({ where });
        const select = vi.fn().mockReturnValue({ from });
        const db = { select };
        fetchPrices.mockClear();
        await ensurePriceSnapshots(db, "AAPL", "2026-05-01");
        expect(fetchPrices).not.toHaveBeenCalled();
    });
    it("fetches and upserts when fromDate precedes existing min", async () => {
        const where = vi.fn().mockResolvedValue([{ minDate: "2026-05-01" }]);
        const from = vi.fn().mockReturnValue({ where });
        const select = vi.fn().mockReturnValue({ from });
        const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
        const values = vi.fn(() => ({ onConflictDoUpdate }));
        const insert = vi.fn(() => ({ values }));
        const db = { select, insert };
        fetchPrices.mockClear();
        fetchPrices.mockResolvedValueOnce({
            AAPL: {
                latest: 100,
                bars: [{ date: "2026-04-15", open: 1, high: 1, low: 1, close: 1, volume: 1 }],
            },
        });
        await ensurePriceSnapshots(db, "AAPL", "2026-04-15");
        expect(fetchPrices).toHaveBeenCalledTimes(1);
        expect(insert).toHaveBeenCalled();
    });
    it("fetches when no existing data", async () => {
        const where = vi.fn().mockResolvedValue([{ minDate: null }]);
        const from = vi.fn().mockReturnValue({ where });
        const select = vi.fn().mockReturnValue({ from });
        const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
        const values = vi.fn(() => ({ onConflictDoUpdate }));
        const insert = vi.fn(() => ({ values }));
        const db = { select, insert };
        fetchPrices.mockClear();
        fetchPrices.mockResolvedValueOnce({
            AAPL: { latest: 100, bars: [] },
        });
        await ensurePriceSnapshots(db, "AAPL", "2026-04-15");
        expect(fetchPrices).toHaveBeenCalledTimes(1);
    });
});
