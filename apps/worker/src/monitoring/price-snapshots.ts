import { eq, min } from "drizzle-orm";
import { priceSnapshots } from "@trader/db";
import { fetchPrices } from "./alphavantage-fetch.js";
import type { FetchResult } from "./alphavantage-fetch.js";

export async function upsertSnapshots(db: any, result: FetchResult): Promise<void> {
  for (const [symbol, data] of Object.entries(result)) {
    for (const bar of data.bars) {
      const values = {
        symbol,
        date: bar.date,
        open: String(bar.open),
        high: String(bar.high),
        low: String(bar.low),
        close: String(bar.close),
        volume: bar.volume != null ? BigInt(bar.volume) : null,
      };
      await db
        .insert(priceSnapshots)
        .values(values)
        .onConflictDoUpdate({
          target: [priceSnapshots.symbol, priceSnapshots.date],
          set: {
            open: values.open,
            high: values.high,
            low: values.low,
            close: values.close,
            volume: values.volume,
            fetchedAt: new Date(),
          },
        });
    }
  }
}

export async function ensurePriceSnapshots(
  db: any,
  symbol: string,
  fromDate: string
): Promise<void> {
  const existing = await db
    .select({ minDate: min(priceSnapshots.date) })
    .from(priceSnapshots)
    .where(eq(priceSnapshots.symbol, symbol));
  const existingMin = existing[0]?.minDate ?? null;
  if (existingMin && existingMin <= fromDate) return;

  const daysBack =
    Math.ceil((Date.now() - new Date(fromDate).getTime()) / 86_400_000) + 1;
  const result = await fetchPrices([symbol], `${daysBack}d`);
  await upsertSnapshots(db, result);
}
