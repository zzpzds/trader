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
  eq: vi.fn(),
  and: vi.fn(),
}));

function makeSelect(rows: any[] = []) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where, orderBy });
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
    } as any;

    await runMonitoringJob(mockDb);

    const allSetCalls = setMock.mock.calls;
    const refPriceCall = allSetCalls.find((call: any[]) => call[0]?.referencePrice !== undefined);
    expect(refPriceCall).toBeDefined();
    expect(refPriceCall![0].referencePrice).toBe("348.5000");

    // monitoringRuns update should NOT include `prices` field anymore
    const completedCall = allSetCalls.find(
      (call: any[]) => call[0]?.status === "completed"
    );
    expect(completedCall).toBeDefined();
    expect(completedCall![0]).not.toHaveProperty("prices");
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
    } as any;

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
      select: makeSelect([]),  // empty snapshots
    } as any;

    await runMonitoringJob(mockDb);

    expect(mockFetchPrices).toHaveBeenCalledWith(["AAPL"], "30d");
  });
});
