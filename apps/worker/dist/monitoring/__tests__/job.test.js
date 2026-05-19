import { describe, it, expect, vi } from "vitest";
import { runMonitoringJob } from "../job.js";
vi.mock("../yahoo-fetch.js", () => ({
    fetchPrices: vi.fn().mockResolvedValue({
        QQQ: { latest: 185.0, bars: [{ date: "2025-05-01", close: 185.0, open: 183, high: 186, low: 182, volume: 50000000 }] },
    }),
}));
vi.mock("../analyze.js", () => ({
    createAnalyzer: () => vi.fn().mockResolvedValue({
        analysis: "## Report\nAll good",
        hasActionItems: false,
    }),
}));
vi.mock("@trader/db", () => ({
    strategies: {},
    positions: {},
    positionLots: {},
    monitoringRuns: {},
    notifications: {},
    eq: vi.fn(),
}));
describe("runMonitoringJob", () => {
    it("skips when no strategies with lots found", async () => {
        const mockDb = {
            query: {
                strategies: { findMany: vi.fn().mockResolvedValue([]) },
            },
            insert: vi.fn(),
            update: vi.fn(),
        };
        await runMonitoringJob(mockDb);
        expect(mockDb.insert).not.toHaveBeenCalled();
    });
});
