/**
 * One-time backfill of `price_snapshots` from existing positions and strategies.
 *
 * Usage (from repo root):
 *   DATABASE_URL=... npx tsx scripts/backfill-price-snapshots.ts
 * Or: npm run backfill:prices
 *
 * For each existing position symbol, computes the earliest needed date as
 *   MIN( MIN(lot.lot_date for that symbol),
 *        today − MAX(strategies.analysis_window_days for strategies holding this symbol) )
 * and calls ensurePriceSnapshots() to fill the gap. Per-symbol failures are
 * logged but do not abort the script.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "@trader/db";
import { ensurePriceSnapshots } from "../apps/worker/src/monitoring/price-snapshots.js";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const sqlClient = postgres(url, { max: 5 });
  const db = drizzle(sqlClient, { schema });

  // For each symbol, compute the from_date: the earlier of
  //  (a) min lot_date for that symbol across all positions
  //  (b) today minus max analysis_window_days across strategies holding it
  const rows = await db.execute<{ symbol: string; from_date: string }>(sql`
    WITH symbol_lots AS (
      SELECT
        p.symbol,
        MIN(l.lot_date::date) AS earliest_lot,
        MAX(COALESCE(s.analysis_window_days, 60)) AS max_window
      FROM positions p
      LEFT JOIN position_lots l ON l.position_id = p.id
      LEFT JOIN strategies s ON s.id = p.strategy_id
      GROUP BY p.symbol
    )
    SELECT
      symbol,
      LEAST(
        COALESCE(earliest_lot, CURRENT_DATE - (max_window || ' days')::interval),
        (CURRENT_DATE - (max_window || ' days')::interval)::date
      )::text AS from_date
    FROM symbol_lots
  `);

  let ok = 0;
  let failed = 0;

  for (const r of rows as Array<{ symbol: string; from_date: string }>) {
    const symbol = r.symbol;
    const fromDate = String(r.from_date).slice(0, 10);
    process.stdout.write(`[backfill] ${symbol} from ${fromDate} … `);
    try {
      await ensurePriceSnapshots(db, symbol, fromDate);
      console.log("OK");
      ok++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`FAILED: ${msg}`);
      failed++;
    }
  }

  console.log(`\n[backfill] done: ${ok} ok, ${failed} failed`);
  await sqlClient.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
