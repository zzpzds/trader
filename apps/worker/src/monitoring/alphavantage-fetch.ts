export interface PriceData {
  latest: number;
  bars: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

export interface FetchResult {
  [symbol: string]: PriceData;
}

interface DailyTimeSeries {
  "1. open": string;
  "2. high": string;
  "3. low": string;
  "4. close": string;
  "5. volume": string;
}

interface AlphaVantageResponse {
  "Error Message"?: string;
  "Note"?: string;
  "Information"?: string;
  "Time Series (Daily)"?: Record<string, DailyTimeSeries>;
}

function periodToDays(period: string): number {
  const match = period.match(/^(\d+)(d|wk|mo|y)$/);
  if (!match) return 60;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "d": return value;
    case "wk": return value * 7;
    case "mo": return value * 30;
    case "y": return value * 365;
    default: return 60;
  }
}

const RATE_LIMIT_DELAY_MS = 12_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchPrices(
  symbols: string[],
  period: string = "60d"
): Promise<FetchResult> {
  const apiKey = process.env.ALPHAVANTAGE_API_KEY;
  if (!apiKey) throw new Error("ALPHAVANTAGE_API_KEY is not set");

  const days = periodToDays(period);
  const outputsize = days <= 100 ? "compact" : "full";
  const result: FetchResult = {};
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const errors: string[] = [];

  for (let i = 0; i < symbols.length; i++) {
    if (i > 0) await sleep(RATE_LIMIT_DELAY_MS);

    const symbol = symbols[i];
    try {
      const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=${outputsize}&apikey=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Alpha Vantage API error ${res.status} for ${symbol}`);

      const data = (await res.json()) as AlphaVantageResponse;

      if (data["Error Message"]) throw new Error(`Alpha Vantage: ${data["Error Message"]}`);
      if (data["Note"] || data["Information"]) throw new Error(`Alpha Vantage rate limit reached`);

      const timeSeries = data["Time Series (Daily)"];
      if (!timeSeries) throw new Error(`No data returned for ${symbol}`);

      const bars = Object.entries(timeSeries)
        .filter(([date]) => date >= cutoff)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({
          date,
          open: parseFloat(v["1. open"]),
          high: parseFloat(v["2. high"]),
          low: parseFloat(v["3. low"]),
          close: parseFloat(v["4. close"]),
          volume: parseInt(v["5. volume"], 10),
        }));

      if (bars.length === 0) throw new Error(`No data returned for ${symbol}`);

      result[symbol] = { latest: bars[bars.length - 1].close, bars };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${symbol}: ${message}`);
      console.warn(`[alphavantage] Failed to fetch ${symbol}: ${message}`);
    }
  }

  if (Object.keys(result).length === 0) {
    throw new Error(`All symbols failed: ${errors.join("; ")}`);
  }

  if (errors.length > 0) {
    console.warn(`[alphavantage] Partial failures: ${errors.join("; ")}`);
  }

  return result;
}
