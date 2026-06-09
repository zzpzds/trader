import { describe, it, expect, vi, beforeEach } from "vitest";
import { runMonitoringJob } from "../job.js";
const { mockFetchPrices, mockAnalyze } = vi.hoisted(() => ({
    mockFetchPrices: vi.fn().mockResolvedValue({
        QQQ: { latest: 185.0, bars: [{ date: "2025-05-01", close: 185.0, open: 183, high: 186, low: 182, volume: 50000000 }] },
    }),
    mockAnalyze: vi.fn().mockResolvedValue({
        analysis: "## Report\nAll good",
        hasActionItems: false,
        referencePriceUpdates: [],
    }),
}));
vi.mock("../alphavantage-fetch.js", () => ({
    fetchPrices: mockFetchPrices,
}));
vi.mock("../analyze.js", () => ({
    createAnalyzer: () => mockAnalyze,
}));
vi.mock("@trader/db", () => ({
    strategies: {},
    positions: {},
    positionLots: {},
    monitoringRuns: {},
    notifications: {},
    priceSnapshots: { symbol: {}, date: {} },
    skills: { id: {}, name: {}, bodyMd: {} },
    strategySkills: { strategyId: {}, skillId: {} },
    eq: vi.fn(),
    and: vi.fn(),
}));
// Builds a `select(...).from(...).where(...).orderBy(...)` chain that resolves to `priceRows`,
// while also supporting `select(...).from(...).innerJoin(...).where(...)` (for skills query)
// resolving to `skillRows`.
function makeSelect(priceRows = [], skillRows = []) {
    const orderBy = vi.fn().mockResolvedValue(priceRows);
    // For the price-snapshot query: from -> where -> orderBy
    const priceWhere = vi.fn().mockReturnValue({ orderBy });
    // For the skills query: from -> innerJoin -> where (terminal, awaited)
    const skillWhere = vi.fn().mockResolvedValue(skillRows);
    const innerJoin = vi.fn().mockReturnValue({ where: skillWhere });
    const from = vi.fn().mockReturnValue({
        where: priceWhere,
        orderBy,
        innerJoin,
    });
    return vi.fn().mockReturnValue({ from });
}
describe("runMonitoringJob", () => {
    beforeEach(() => vi.clearAllMocks());
    it("skips when no strategies with lots found", async () => {
        const mockDb = {
            query: {
                strategies: { findMany: vi.fn().mockResolvedValue([]) },
            },
            insert: vi.fn(),
            update: vi.fn(),
            select: makeSelect(),
        };
        await runMonitoringJob(mockDb);
        expect(mockDb.insert).not.toHaveBeenCalled();
    });
    it("updates referencePrice in DB when LLM returns reference_price_updates", async () => {
        mockFetchPrices.mockResolvedValueOnce({
            ISRG: { latest: 348.5, bars: [{ date: "2025-05-01", close: 348.5, open: 345, high: 350, low: 344, volume: 1000000 }] },
        });
        mockAnalyze.mockResolvedValueOnce({
            analysis: "ISRG hit reset threshold.",
            hasActionItems: false,
            referencePriceUpdates: [{ symbol: "ISRG", newReferencePrice: 348.5 }],
        });
        const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({}) });
        const updateMock = vi.fn().mockReturnValue({ set: setMock });
        const insertReturning = vi.fn().mockResolvedValue([{ id: "run-1" }]);
        const insertMock = vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: insertReturning }) });
        const mockDb = {
            query: {
                strategies: {
                    findMany: vi.fn().mockResolvedValue([
                        {
                            id: "strat-1",
                            name: "T1",
                            content: "ref reset at +15%",
                            symbols: ["ISRG"],
                            analysisWindowDays: 60,
                        },
                    ]),
                },
                positions: {
                    findMany: vi.fn().mockResolvedValue([
                        {
                            id: "pos-1",
                            symbol: "ISRG",
                            referencePrice: "300.0000",
                            positionLots: [{ shares: "10", costPrice: "300.00", lotDate: "2025-01-01", notes: null }],
                        },
                    ]),
                },
            },
            insert: insertMock,
            update: updateMock,
            select: makeSelect([
                { symbol: "ISRG", date: "2025-05-01", open: "345", high: "350", low: "344", close: "348.5", volume: 1000000n },
            ]),
        };
        await runMonitoringJob(mockDb);
        const allSetCalls = setMock.mock.calls;
        const refPriceCall = allSetCalls.find((call) => call[0]?.referencePrice !== undefined);
        expect(refPriceCall).toBeDefined();
        expect(refPriceCall[0].referencePrice).toBe("348.5000");
        // monitoringRuns update should NOT include `prices` field anymore
        const completedCall = allSetCalls.find((call) => call[0]?.status === "completed");
        expect(completedCall).toBeDefined();
        expect(completedCall[0]).not.toHaveProperty("prices");
    });
    it("does not call fetchPrices when snapshots cover the window", async () => {
        mockFetchPrices.mockReset();
        const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
        const updateMock = vi.fn().mockReturnValue({ set: setMock });
        const insertReturning = vi.fn().mockResolvedValue([{ id: "run-2" }]);
        const insertMock = vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({ returning: insertReturning }),
        });
        const mockDb = {
            query: {
                strategies: {
                    findMany: vi.fn().mockResolvedValue([
                        { id: "s2", name: "T2", content: "c", symbols: ["AAPL"], analysisWindowDays: 30 },
                    ]),
                },
                positions: {
                    findMany: vi.fn().mockResolvedValue([
                        {
                            id: "p2",
                            symbol: "AAPL",
                            referencePrice: null,
                            positionLots: [{ shares: "5", costPrice: "150", lotDate: "2025-01-01", notes: null }],
                        },
                    ]),
                },
            },
            insert: insertMock,
            update: updateMock,
            select: makeSelect([
                { symbol: "AAPL", date: "2025-05-01", open: "150", high: "150", low: "150", close: "150", volume: 0n },
            ]),
        };
        await runMonitoringJob(mockDb);
        expect(mockFetchPrices).not.toHaveBeenCalled();
    });
    it("falls back to inline fetchPrices when snapshots are empty", async () => {
        mockFetchPrices.mockReset();
        mockFetchPrices.mockResolvedValueOnce({
            AAPL: {
                latest: 150,
                bars: [{ date: "2025-05-01", open: 150, high: 150, low: 150, close: 150, volume: 0 }],
            },
        });
        const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
        const updateMock = vi.fn().mockReturnValue({ set: setMock });
        const insertReturning = vi.fn().mockResolvedValue([{ id: "run-3" }]);
        const insertMock = vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({ returning: insertReturning }),
        });
        const mockDb = {
            query: {
                strategies: {
                    findMany: vi.fn().mockResolvedValue([
                        { id: "s3", name: "T3", content: "c", symbols: ["AAPL"], analysisWindowDays: 30 },
                    ]),
                },
                positions: {
                    findMany: vi.fn().mockResolvedValue([
                        {
                            id: "p3",
                            symbol: "AAPL",
                            referencePrice: null,
                            positionLots: [{ shares: "1", costPrice: "150", lotDate: "2025-01-01", notes: null }],
                        },
                    ]),
                },
            },
            insert: insertMock,
            update: updateMock,
            select: makeSelect([]), // empty snapshots
        };
        await runMonitoringJob(mockDb);
        expect(mockFetchPrices).toHaveBeenCalledWith(["AAPL"], "30d");
    });
    it("calls analyze with empty skills and writes empty skillSnapshot when strategy has no skills", async () => {
        mockAnalyze.mockReset();
        mockAnalyze.mockResolvedValueOnce({
            analysis: "no actions",
            hasActionItems: false,
            referencePriceUpdates: [],
        });
        const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
        const updateMock = vi.fn().mockReturnValue({ set: setMock });
        const insertReturning = vi.fn().mockResolvedValue([{ id: "run-skills-empty" }]);
        const insertMock = vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({ returning: insertReturning }),
        });
        const mockDb = {
            query: {
                strategies: {
                    findMany: vi.fn().mockResolvedValue([
                        { id: "s-no-skill", name: "T-no-skill", content: "c", symbols: ["AAPL"], analysisWindowDays: 30 },
                    ]),
                },
                positions: {
                    findMany: vi.fn().mockResolvedValue([
                        {
                            id: "p-no-skill",
                            symbol: "AAPL",
                            referencePrice: null,
                            positionLots: [{ shares: "1", costPrice: "150", lotDate: "2025-01-01", notes: null }],
                        },
                    ]),
                },
            },
            insert: insertMock,
            update: updateMock,
            select: makeSelect([{ symbol: "AAPL", date: "2025-05-01", open: "150", high: "150", low: "150", close: "150", volume: 0n }], [] // skill rows: empty
            ),
        };
        await runMonitoringJob(mockDb);
        // analyze called with skills (6th arg) === []
        expect(mockAnalyze).toHaveBeenCalled();
        const analyzeArgs = mockAnalyze.mock.calls[0];
        expect(analyzeArgs[5]).toEqual([]);
        // monitoringRuns.set payload includes skillSnapshot: []
        const completedCall = setMock.mock.calls.find((call) => call[0]?.status === "completed");
        expect(completedCall).toBeDefined();
        expect(completedCall[0].skillSnapshot).toEqual([]);
    });
    it("loads associated skills, passes them to analyze, and writes hash+preview snapshots", async () => {
        mockAnalyze.mockReset();
        mockAnalyze.mockResolvedValueOnce({
            analysis: "ok",
            hasActionItems: false,
            referencePriceUpdates: [],
        });
        const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
        const updateMock = vi.fn().mockReturnValue({ set: setMock });
        const insertReturning = vi.fn().mockResolvedValue([{ id: "run-with-skills" }]);
        const insertMock = vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({ returning: insertReturning }),
        });
        const skillRows = [
            { id: "skill-a", name: "candlestick", bodyMd: "# K线\n方法论..." },
            { id: "skill-b", name: "risk", bodyMd: "# 风险..." },
        ];
        const mockDb = {
            query: {
                strategies: {
                    findMany: vi.fn().mockResolvedValue([
                        { id: "s-with-skills", name: "T-skills", content: "c", symbols: ["AAPL"], analysisWindowDays: 30 },
                    ]),
                },
                positions: {
                    findMany: vi.fn().mockResolvedValue([
                        {
                            id: "p-with-skills",
                            symbol: "AAPL",
                            referencePrice: null,
                            positionLots: [{ shares: "1", costPrice: "150", lotDate: "2025-01-01", notes: null }],
                        },
                    ]),
                },
            },
            insert: insertMock,
            update: updateMock,
            select: makeSelect([{ symbol: "AAPL", date: "2025-05-01", open: "150", high: "150", low: "150", close: "150", volume: 0n }], skillRows),
        };
        await runMonitoringJob(mockDb);
        // analyze called with the loaded skills
        expect(mockAnalyze).toHaveBeenCalled();
        const analyzeArgs = mockAnalyze.mock.calls[0];
        expect(analyzeArgs[5]).toEqual(skillRows);
        // Compute expected sha256 hashes deterministically
        const { createHash } = await import("node:crypto");
        const expectedSnapshot = skillRows.map((s) => ({
            id: s.id,
            name: s.name,
            body_md_hash: createHash("sha256").update(s.bodyMd).digest("hex"),
            body_md_preview: s.bodyMd.slice(0, 500),
        }));
        const completedCall = setMock.mock.calls.find((call) => call[0]?.status === "completed");
        expect(completedCall).toBeDefined();
        expect(completedCall[0].skillSnapshot).toEqual(expectedSnapshot);
    });
});
