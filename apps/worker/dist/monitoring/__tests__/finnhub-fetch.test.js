import { describe, it, expect, vi, beforeEach } from "vitest";
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
import { fetchPrices } from "../finnhub-fetch.js";
function makeCandleResponse(overrides) {
    return {
        s: "ok",
        c: [185.42],
        h: [186.0],
        l: [179.0],
        o: [180.0],
        t: [Math.floor(new Date("2025-01-02").getTime() / 1000)],
        v: [50000000],
        ...overrides,
    };
}
function okResponse(body) {
    return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(body),
    });
}
describe("fetchPrices", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.FINNHUB_API_KEY = "test-token";
    });
    it("returns parsed price data on success", async () => {
        mockFetch.mockReturnValueOnce(okResponse(makeCandleResponse()));
        const result = await fetchPrices(["QQQ"]);
        expect(result.QQQ.latest).toBe(185.42);
        expect(result.QQQ.bars[0].date).toBe("2025-01-02");
        expect(result.QQQ.bars[0].close).toBe(185.42);
    });
    it("throws when API returns no_data status", async () => {
        mockFetch.mockReturnValueOnce(okResponse({ s: "no_data" }));
        await expect(fetchPrices(["BAD"])).rejects.toThrow("No data returned for BAD");
    });
    it("throws on non-ok HTTP response", async () => {
        mockFetch.mockReturnValueOnce(Promise.resolve({ ok: false, status: 403 }));
        await expect(fetchPrices(["QQQ"])).rejects.toThrow("Finnhub API error 403 for QQQ");
    });
    it("throws when FINNHUB_API_KEY is not set", async () => {
        delete process.env.FINNHUB_API_KEY;
        await expect(fetchPrices(["QQQ"])).rejects.toThrow("FINNHUB_API_KEY is not set");
    });
    it("returns multiple bars in order", async () => {
        const t1 = Math.floor(new Date("2025-01-02").getTime() / 1000);
        const t2 = Math.floor(new Date("2025-01-03").getTime() / 1000);
        mockFetch.mockReturnValueOnce(okResponse(makeCandleResponse({
            c: [185, 190],
            h: [186, 192],
            l: [183, 188],
            o: [184, 186],
            t: [t1, t2],
            v: [1000, 2000],
        })));
        const result = await fetchPrices(["SPY"]);
        expect(result.SPY.latest).toBe(190);
        expect(result.SPY.bars.length).toBe(2);
        expect(result.SPY.bars[1].date).toBe("2025-01-03");
    });
    it("includes token in request URL", async () => {
        mockFetch.mockReturnValueOnce(okResponse(makeCandleResponse()));
        await fetchPrices(["AAPL"], "30d");
        expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("token=test-token"));
    });
});
