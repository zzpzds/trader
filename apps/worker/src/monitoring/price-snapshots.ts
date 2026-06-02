import { priceSnapshots } from "@trader/db";
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
