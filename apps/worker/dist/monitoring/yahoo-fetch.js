import YahooFinance from "yahoo-finance2";
const yahooFinance = new YahooFinance();
function periodToStartDate(period) {
    const match = period.match(/^(\d+)(d|wk|mo|y)$/);
    if (!match)
        return new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const now = Date.now();
    switch (unit) {
        case "d":
            return new Date(now - value * 24 * 60 * 60 * 1000);
        case "wk":
            return new Date(now - value * 7 * 24 * 60 * 60 * 1000);
        case "mo":
            return new Date(now - value * 30 * 24 * 60 * 60 * 1000);
        case "y":
            return new Date(now - value * 365 * 24 * 60 * 60 * 1000);
        default:
            return new Date(now - 60 * 24 * 60 * 60 * 1000);
    }
}
export async function fetchPrices(symbols, period = "60d") {
    const result = {};
    const startDate = periodToStartDate(period);
    for (const symbol of symbols) {
        const chart = await yahooFinance.chart(symbol, {
            period1: startDate,
            period2: new Date(),
        });
        const quotes = chart.quotes.filter((q) => q.close != null);
        if (quotes.length === 0) {
            throw new Error(`No data returned for ${symbol}`);
        }
        const lastQuote = quotes[quotes.length - 1];
        result[symbol] = {
            latest: lastQuote.close,
            bars: quotes.map((q) => ({
                date: q.date.toISOString().slice(0, 10),
                open: q.open ?? 0,
                high: q.high ?? 0,
                low: q.low ?? 0,
                close: q.close ?? 0,
                volume: q.volume ?? 0,
            })),
        };
    }
    return result;
}
