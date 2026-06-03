import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { fetchPrices, isRateLimitError } from "../alphavantage-fetch.js";

function makeTimeSeriesResponse(entries: Record<string, {
  open: number; high: number; low: number; close: number; volume: number;
}>) {
  const series: Record<string, Record<string, string>> = {};
  for (const [date, v] of Object.entries(entries)) {
    series[date] = {
      "1. open": String(v.open),
      "2. high": String(v.high),
      "3. low": String(v.low),
      "4. close": String(v.close),
      "5. volume": String(v.volume),
    };
  }
  return { "Time Series (Daily)": series };
}

function okResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(body),
  } as Response);
}

describe("fetchPrices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ALPHAVANTAGE_API_KEY = "test-key";
  });

  it("returns parsed price data on success", async () => {
    mockFetch.mockReturnValueOnce(
      okResponse(makeTimeSeriesResponse({
        "2026-05-10": { open: 180, high: 186, low: 179, close: 185.42, volume: 50000000 },
      }))
    );

    const result = await fetchPrices(["QQQ"]);

    expect(result.QQQ.latest).toBe(185.42);
    expect(result.QQQ.bars[0].date).toBe("2026-05-10");
    expect(result.QQQ.bars[0].close).toBe(185.42);
  });

  it("returns bars sorted ascending by date", async () => {
    mockFetch.mockReturnValueOnce(
      okResponse(makeTimeSeriesResponse({
        "2026-05-12": { open: 190, high: 192, low: 188, close: 191, volume: 2000 },
        "2026-05-10": { open: 180, high: 186, low: 179, close: 185, volume: 1000 },
      }))
    );

    const result = await fetchPrices(["SPY"]);

    expect(result.SPY.bars[0].date).toBe("2026-05-10");
    expect(result.SPY.bars[1].date).toBe("2026-05-12");
    expect(result.SPY.latest).toBe(191);
  });

  it("throws when API returns Error Message", async () => {
    mockFetch.mockReturnValueOnce(
      okResponse({ "Error Message": "Invalid API call." })
    );

    await expect(fetchPrices(["BAD"])).rejects.toThrow("Invalid API call.");
  });

  it("throws when rate limit Note is returned", async () => {
    mockFetch.mockReturnValueOnce(
      okResponse({ "Note": "Thank you for using Alpha Vantage! Our standard API call frequency is 25 requests per day." })
    );

    await expect(fetchPrices(["QQQ"])).rejects.toThrow("rate limit");
  });

  it("throws on non-ok HTTP response", async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({ ok: false, status: 500 } as Response)
    );

    await expect(fetchPrices(["QQQ"])).rejects.toThrow("Alpha Vantage API error 500 for QQQ");
  });

  it("throws when ALPHAVANTAGE_API_KEY is not set", async () => {
    delete process.env.ALPHAVANTAGE_API_KEY;

    await expect(fetchPrices(["QQQ"])).rejects.toThrow("ALPHAVANTAGE_API_KEY is not set");
  });

  it("includes apikey in request URL", async () => {
    mockFetch.mockReturnValueOnce(
      okResponse(makeTimeSeriesResponse({
        "2026-05-10": { open: 180, high: 186, low: 179, close: 185, volume: 1000 },
      }))
    );

    await fetchPrices(["AAPL"]);

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("apikey=test-key"));
  });

  it("returns successful symbols and skips failed ones", async () => {
    vi.useFakeTimers();
    mockFetch
      .mockReturnValueOnce(
        okResponse(makeTimeSeriesResponse({
          "2026-05-10": { open: 180, high: 186, low: 179, close: 185, volume: 1000 },
        }))
      )
      .mockReturnValueOnce(
        okResponse({ "Error Message": "Invalid API call." })
      );

    const promise = fetchPrices(["AAPL", "BAD"]);
    await vi.advanceTimersByTimeAsync(12_000);
    const result = await promise;

    expect(result.AAPL).toBeDefined();
    expect(result.BAD).toBeUndefined();
    vi.useRealTimers();
  });

  it("throws when all symbols fail", async () => {
    vi.useFakeTimers();
    mockFetch
      .mockReturnValueOnce(
        okResponse({ "Error Message": "Invalid API call." })
      )
      .mockReturnValueOnce(
        Promise.resolve({ ok: false, status: 500 } as Response)
      );

    const promise = fetchPrices(["BAD1", "BAD2"]);
    // Prevent unhandled rejection while timers advance
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(12_000);
    await expect(promise).rejects.toThrow("All symbols failed");
    vi.useRealTimers();
  });

  it("uses outputsize=compact for periods <= 100 days", async () => {
    mockFetch.mockReturnValueOnce(
      okResponse(makeTimeSeriesResponse({
        "2026-05-10": { open: 1, high: 1, low: 1, close: 1, volume: 1 },
      }))
    );
    await fetchPrices(["AAPL"], "60d");
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("outputsize=compact");
  });

  it("uses outputsize=full for periods > 100 days", async () => {
    mockFetch.mockReturnValueOnce(
      okResponse(makeTimeSeriesResponse({
        "2026-05-10": { open: 1, high: 1, low: 1, close: 1, volume: 1 },
      }))
    );
    await fetchPrices(["AAPL"], "120d");
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("outputsize=full");
  });
});

describe("isRateLimitError", () => {
  it("returns true for per-symbol and aggregated rate limit errors", () => {
    expect(isRateLimitError(new Error("Alpha Vantage rate limit reached"))).toBe(true);
    expect(
      isRateLimitError(new Error("All symbols failed: OCRL: Alpha Vantage rate limit reached"))
    ).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isRateLimitError(new Error("Invalid API call."))).toBe(false);
    expect(isRateLimitError(new Error("No data returned for OCRL"))).toBe(false);
    expect(isRateLimitError("some string")).toBe(false);
  });
});
