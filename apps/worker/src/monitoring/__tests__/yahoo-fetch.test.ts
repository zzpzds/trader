import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockChart } = vi.hoisted(() => ({
  mockChart: vi.fn(),
}));

vi.mock("yahoo-finance2", () => ({
  default: class {
    chart = mockChart;
  },
}));

import { fetchPrices } from "../yahoo-fetch.js";

function createMockChartResult(
  symbol: string,
  quotes: Array<{
    date: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
  }>
) {
  return {
    meta: {
      currency: "USD",
      symbol,
      exchangeName: "NMS",
      instrumentType: "EQUITY",
      firstTradeDate: null,
      regularMarketTime: new Date(),
      gmtoffset: -14400,
      timezone: "America/New_York",
      exchangeTimezoneName: "America/New_York",
      regularMarketPrice: quotes[quotes.length - 1]?.close ?? 0,
      priceHint: 2,
      currentTradingPeriod: { pre: {}, regular: {}, post: {} },
      dataGranularity: "1d",
      range: "60d",
      validRanges: ["1d", "5d", "60d"],
    },
    quotes: quotes.map((q) => ({
      date: new Date(q.date),
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume,
    })),
  };
}

describe("fetchPrices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed price data on success", async () => {
    mockChart.mockResolvedValue(
      createMockChartResult("QQQ", [
        { date: "2025-01-02", open: 180, high: 186, low: 179, close: 185.42, volume: 50000000 },
      ])
    );

    const result = await fetchPrices(["QQQ"]);

    expect(result.QQQ.latest).toBe(185.42);
    expect(result.QQQ.bars[0].date).toBe("2025-01-02");
    expect(result.QQQ.bars[0].close).toBe(185.42);
  });

  it("throws when no data returned for symbol", async () => {
    mockChart.mockResolvedValue(createMockChartResult("BAD", []));

    await expect(fetchPrices(["BAD"])).rejects.toThrow("No data returned for BAD");
  });

  it("throws on yahoo-finance2 error", async () => {
    mockChart.mockRejectedValue(new Error("yahoo-finance2 error"));

    await expect(fetchPrices(["QQQ"])).rejects.toThrow("yahoo-finance2 error");
  });

  it("filters out quotes with null close prices", async () => {
    mockChart.mockResolvedValue({
      meta: {
        currency: "USD",
        symbol: "QQQ",
        exchangeName: "NMS",
        instrumentType: "EQUITY",
        firstTradeDate: null,
        regularMarketTime: new Date(),
        gmtoffset: -14400,
        timezone: "America/New_York",
        exchangeTimezoneName: "America/New_York",
        regularMarketPrice: 185,
        priceHint: 2,
        currentTradingPeriod: { pre: {}, regular: {}, post: {} },
        dataGranularity: "1d",
        range: "60d",
        validRanges: ["1d"],
      },
      quotes: [
        { date: new Date("2025-01-01"), open: null, high: null, low: null, close: null, volume: null },
        { date: new Date("2025-01-02"), open: 180, high: 186, low: 179, close: 185, volume: 50000000 },
      ],
    });

    const result = await fetchPrices(["QQQ"]);

    expect(result.QQQ.bars.length).toBe(1);
    expect(result.QQQ.bars[0].close).toBe(185);
    expect(result.QQQ.latest).toBe(185);
  });

  it("passes period1 to chart based on period string", async () => {
    mockChart.mockResolvedValue(
      createMockChartResult("SPY", [
        { date: "2025-05-01", open: 500, high: 510, low: 498, close: 505, volume: 80000000 },
      ])
    );

    await fetchPrices(["SPY"], "30d");

    expect(mockChart).toHaveBeenCalledWith("SPY", expect.objectContaining({ period1: expect.any(Date) }));
  });
});
