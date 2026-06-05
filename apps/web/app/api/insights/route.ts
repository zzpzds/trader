export const dynamic = "force-dynamic";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { computeInsights, type LotInput, type SnapshotInput } from "@/lib/insights";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const strategyId = url.searchParams.get("strategyId") ?? null;

  // p.reference_price is the *current* value, not the value at lot time.
  // We don't snapshot historical ref prices; avgVsRefPct is therefore best-effort.
  const lotsRaw = strategyId
    ? await db.execute(sql`
        SELECT pl.id, pl.position_id AS "positionId", p.symbol, pl.type,
               pl.lot_date AS "lotDate", pl.cost_price AS "costPrice", pl.shares,
               p.reference_price AS "referencePrice"
        FROM position_lots pl
        JOIN positions p ON p.id = pl.position_id
        WHERE p.strategy_id = ${strategyId}
        ORDER BY pl.lot_date ASC
      `)
    : await db.execute(sql`
        SELECT pl.id, pl.position_id AS "positionId", p.symbol, pl.type,
               pl.lot_date AS "lotDate", pl.cost_price AS "costPrice", pl.shares,
               p.reference_price AS "referencePrice"
        FROM position_lots pl
        JOIN positions p ON p.id = pl.position_id
        ORDER BY pl.lot_date ASC
      `);

  const lots: LotInput[] = (lotsRaw as any[]).map((r) => ({
    id: r.id,
    positionId: r.positionId,
    symbol: r.symbol,
    type: r.type,
    lotDate: r.lotDate,
    costPrice: parseFloat(r.costPrice),
    shares: parseFloat(r.shares),
    referencePrice: r.referencePrice ? parseFloat(r.referencePrice) : null,
  }));

  const symbols = Array.from(new Set(lots.map((l) => l.symbol)));
  const snapsRaw = symbols.length === 0
    ? []
    : await db.execute(sql`
        SELECT symbol, date::text, close
        FROM price_snapshots
        WHERE symbol IN (${sql.join(symbols.map((s) => sql`${s}`), sql`, `)})
        ORDER BY date ASC
      `);

  const snaps: SnapshotInput[] = (snapsRaw as any[]).map((r) => ({
    symbol: r.symbol,
    date: r.date,
    close: parseFloat(r.close),
  }));

  const t0 = Date.now();
  const result = computeInsights(lots, snaps);
  const ms = Date.now() - t0;
  if (ms > 500) console.warn(`[insights] computation took ${ms}ms`);

  return Response.json(result);
}
