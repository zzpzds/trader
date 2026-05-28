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
  eq: vi.fn(),
  and: vi.fn(),
}));

describe("runMonitoringJob", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips when no strategies with lots found", async () => {
    const mockDb = {
      query: {
        strategies: { findMany: vi.fn().mockResolvedValue([]) },
      },
      insert: vi.fn(),
      update: vi.fn(),
    } as any;

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
            { id: "strat-1", name: "T1", content: "ref reset at +15%", symbols: ["ISRG"] },
          ]),
        },
        positions: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "pos-1",
              symbol: "ISRG",
              referencePrice: "300.0000",
              positionLots: [{ shares: 10, costPrice: "300.00", lotDate: "2025-01-01", notes: null }],
            },
          ]),
        },
      },
      insert: insertMock,
      update: updateMock,
    } as any;

    await runMonitoringJob(mockDb);

    const allSetCalls = setMock.mock.calls;
    const refPriceCall = allSetCalls.find((call: any[]) => call[0]?.referencePrice !== undefined);
    expect(refPriceCall).toBeDefined();
    expect(refPriceCall![0].referencePrice).toBe("348.5000");
  });
});
