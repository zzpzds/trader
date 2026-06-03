export const dynamic = "force-dynamic";
import { and, asc, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { priceSnapshots } from "@trader/db";
import { buildPnlHistory, type DatedTxn, type TxnType, type Snapshot } from "@/lib/pnl";

function getCutoff(range: string): string | null {
  if (range === "all") return null;
  const d = new Date();
  d.setDate(d.getDate() - (range === "3m" ? 90 : 30));
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cutoff = getCutoff(searchParams.get("range") ?? "1m");

  const allPositions = await db.query.positions.findMany({
    with: { positionLots: true },
  });

  const txns: DatedTxn[] = [];
  for (const pos of allPositions as any[]) {
    for (const l of pos.positionLots) {
      txns.push({
        id: l.id,
        symbol: pos.symbol,
        type: (l.type as TxnType) ?? "BUY",
        shares: parseFloat(l.shares),
        price: parseFloat(l.costPrice),
        date: l.lotDate,
        createdAt: l.createdAt,
      });
    }
  }

  const symbols = [...new Set(txns.map((t) => t.symbol))];
  if (symbols.length === 0) return Response.json([]);

  const where = cutoff
    ? and(inArray(priceSnapshots.symbol, symbols), gte(priceSnapshots.date, cutoff))
    : inArray(priceSnapshots.symbol, symbols);

  const rows = await db
    .select({
      symbol: priceSnapshots.symbol,
      date: priceSnapshots.date,
      close: priceSnapshots.close,
    })
    .from(priceSnapshots)
    .where(where)
    .orderBy(asc(priceSnapshots.date));

  const snapshots: Snapshot[] = (rows as any[]).map((r) => ({
    symbol: r.symbol,
    date: r.date,
    close: parseFloat(r.close),
  }));

  return Response.json(buildPnlHistory(txns, snapshots));
}
