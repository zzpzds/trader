export const dynamic = "force-dynamic";
import { eq, isNull, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions, priceSnapshots } from "@trader/db";

export async function GET(_request: Request) {
  const rows = await db.query.positions.findMany({
    where: isNull(positions.strategyId),
    with: { positionLots: true },
  });

  const result = await Promise.all(
    rows.map(async (p: any) => {
      const snap = await db
        .select({ close: priceSnapshots.close })
        .from(priceSnapshots)
        .where(eq(priceSnapshots.symbol, p.symbol))
        .orderBy(desc(priceSnapshots.date))
        .limit(1);

      const totalShares = p.positionLots.reduce(
        (s: number, l: any) => s + parseFloat(l.shares),
        0
      );
      const totalCost = p.positionLots.reduce(
        (s: number, l: any) => s + parseFloat(l.shares) * parseFloat(l.costPrice),
        0
      );
      const avgCost = totalShares > 0 ? totalCost / totalShares : 0;
      const latestPrice = snap[0]?.close != null ? parseFloat(snap[0].close) : null;

      return {
        id: p.id,
        symbol: p.symbol,
        totalShares: totalShares.toString(),
        avgCost: avgCost.toFixed(4),
        latestPrice,
        lots: p.positionLots.map((l: any) => ({
          id: l.id,
          shares: l.shares,
          costPrice: l.costPrice,
          lotDate: l.lotDate,
          notes: l.notes,
        })),
      };
    })
  );

  return Response.json(result);
}
