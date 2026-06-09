// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
vi.mock("../alphavantage-fetch.js", () => ({ fetchPrices: vi.fn() }));
vi.mock("../price-snapshots.js", () => ({ upsertSnapshots: vi.fn() }));
import { runPriceRefreshJob } from "../price-refresh-job.js";
import { fetchPrices } from "../alphavantage-fetch.js";
import { upsertSnapshots } from "../price-snapshots.js";
function makeDb(symbolsRows) {
    const groupBy = vi.fn().mockResolvedValue(symbolsRows);
    const innerJoin = vi.fn(() => ({ groupBy }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));
    return { select };
}
describe("runPriceRefreshJob", () => {
    it("collects DISTINCT symbols across positions and upserts results", async () => {
        fetchPrices.mockClear();
        upsertSnapshots.mockClear();
        const db = makeDb([{ symbol: "AAPL" }, { symbol: "QQQ" }]);
        fetchPrices.mockResolvedValueOnce({
            AAPL: { latest: 1, bars: [] },
            QQQ: { latest: 1, bars: [] },
        });
        await runPriceRefreshJob(db);
        expect(fetchPrices).toHaveBeenCalledWith(["AAPL", "QQQ"], "5d");
        expect(upsertSnapshots).toHaveBeenCalled();
    });
    it("skips fetcher when no symbols", async () => {
        fetchPrices.mockClear();
        upsertSnapshots.mockClear();
        const db = makeDb([]);
        await runPriceRefreshJob(db);
        expect(fetchPrices).not.toHaveBeenCalled();
        expect(upsertSnapshots).not.toHaveBeenCalled();
    });
});
