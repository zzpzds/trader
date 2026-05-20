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

interface FinnhubCandleResponse {
  s: string;
  c: number[];
  h: number[];
  l: number[];
  o: number[];
  t: number[];
  v: number[];
}

function periodToStartDate(period: string): Date {
  const match = period.match(/^(\d+)(d|wk|mo|y)$/);
  if (!match) return new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

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

export async function fetchPrices(
  symbols: string[],
  period: string = "60d"
): Promise<FetchResult> {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) throw new Error("FINNHUB_API_KEY is not set");

  const result: FetchResult = {};
  const from = Math.floor(periodToStartDate(period).getTime() / 1000);
  const to = Math.floor(Date.now() / 1000);

  for (const symbol of symbols) {
    const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${to}&token=${token}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Finnhub API error ${res.status} for ${symbol}`);

    const data = (await res.json()) as FinnhubCandleResponse;

    if (data.s !== "ok" || !data.c?.length) {
      throw new Error(`No data returned for ${symbol}`);
    }

    result[symbol] = {
      latest: data.c[data.c.length - 1],
      bars: data.t.map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        open: data.o[i],
        high: data.h[i],
        low: data.l[i],
        close: data.c[i],
        volume: data.v[i],
      })),
    };
  }

  return result;
}
