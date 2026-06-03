export const dynamic = "force-dynamic";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { priceSnapshots } from "@trader/db";
import { replayPosition, type Txn, type TxnType } from "@/lib/pnl";

export async function GET() {
  const allPositions = await db.query.positions.findMany({
    with: { positionLots: true },
  });

  const symbols = [...new Set(allPositions.map((p: any) => p.symbol))];

  const priceBySymbol: Record<string, number> = {};
  await Promise.all(
    symbols.map(async (symbol) => {
      const rows = await db
        .select({ close: priceSnapshots.close })
        .from(priceSnapshots)
        .where(eq(priceSnapshots.symbol, symbol))
        .orderBy(desc(priceSnapshots.date))
        .limit(1);
      if (rows[0]?.close != null) priceBySymbol[symbol] = parseFloat(rows[0].close);
    })
  );

  let totalCost = 0;
  let coveredCost = 0;
  let totalValue = 0;
  let realizedPnl = 0;
  let coveredPositions = 0;
  const totalPositions = allPositions.length;

  for (const pos of allPositions as any[]) {
    if (pos.positionLots.length === 0) continue;

    const txns: Txn[] = pos.positionLots.map((l: any) => ({
      id: l.id,
      type: (l.type as TxnType) ?? "BUY",
      shares: parseFloat(l.shares),
      price: parseFloat(l.costPrice),
      date: l.lotDate,
      createdAt: l.createdAt,
    }));
    const state = replayPosition(txns);

    realizedPnl += state.realizedPnl;

    // Cost / value / 收益 reflect only currently-held shares (sells netted out).
    if (state.heldShares <= 0) continue;

    const cost = state.costBasis;
    totalCost += cost;

    const price = priceBySymbol[pos.symbol];
    if (price !== undefined) {
      coveredCost += cost;
      totalValue += state.heldShares * price;
      coveredPositions++;
    }
  }

  const absolutePnl = totalValue - coveredCost;
  const percentPnl = coveredCost > 0 ? (absolutePnl / coveredCost) * 100 : 0;

  return Response.json({
    totalCost: Math.round(totalCost * 100) / 100,
    totalValue: Math.round(totalValue * 100) / 100,
    absolutePnl: Math.round(absolutePnl * 100) / 100,
    percentPnl: Math.round(percentPnl * 10000) / 10000,
    realizedPnl: Math.round(realizedPnl * 100) / 100,
    coveredPositions,
    totalPositions,
  });
}
