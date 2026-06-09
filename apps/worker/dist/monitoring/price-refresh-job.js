import { eq } from "drizzle-orm";
import { positions, positionLots } from "@trader/db";
import { fetchPrices } from "./alphavantage-fetch.js";
import { upsertSnapshots } from "./price-snapshots.js";
export async function runPriceRefreshJob(db) {
    const rows = await db
        .select({ symbol: positions.symbol })
        .from(positions)
        .innerJoin(positionLots, eq(positionLots.positionId, positions.id))
        .groupBy(positions.symbol);
    const symbols = rows.map((r) => r.symbol);
    if (symbols.length === 0) {
        console.log("[price-refresh] no symbols, skipping");
        return;
    }
    console.log(`[price-refresh] refreshing ${symbols.length} symbols`);
    try {
        const result = await fetchPrices(symbols, "5d");
        await upsertSnapshots(db, result);
        console.log(`[price-refresh] upserted ${Object.keys(result).length} symbols`);
    }
    catch (err) {
        console.error("[price-refresh] failed:", err instanceof Error ? err.message : String(err));
    }
}
