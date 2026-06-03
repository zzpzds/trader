export const dynamic = "force-dynamic";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions, strategies, priceSnapshots } from "@trader/db";
import { replayPosition, computeTotalPnl, type Txn, type TxnType } from "@/lib/pnl";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: strategyId } = await params;

  const strategy = await db.query.strategies.findFirst({
    where: eq(strategies.id, strategyId),
  });
  if (!strategy) return Response.json({ error: "Not found" }, { status: 404 });

  const positionsList = await db.query.positions.findMany({
    where: eq(positions.strategyId, strategyId),
    with: { positionLots: { orderBy: (l, { asc }) => [asc(l.lotDate)] } },
  });

  return Response.json(
    await Promise.all(
      positionsList.map(async (p: any) => {
        const snap = await db
          .select({ close: priceSnapshots.close })
          .from(priceSnapshots)
          .where(eq(priceSnapshots.symbol, p.symbol))
          .orderBy(desc(priceSnapshots.date))
          .limit(1);
        const latestPrice = snap[0]?.close != null ? parseFloat(snap[0].close) : null;

        const txns: Txn[] = p.positionLots.map((l: any) => ({
          id: l.id,
          type: (l.type as TxnType) ?? "BUY",
          shares: parseFloat(l.shares),
          price: parseFloat(l.costPrice),
          date: l.lotDate,
          createdAt: l.createdAt,
        }));
        const state = replayPosition(txns);
        const { unrealizedPnl, totalPnl, totalPnlPercent } = computeTotalPnl(state, latestPrice);

        const transactions = [...p.positionLots]
          .sort((a: any, b: any) =>
            a.lotDate === b.lotDate
              ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
              : a.lotDate < b.lotDate ? -1 : 1
          )
          .map((l: any) => ({
            id: l.id,
            type: (l.type as TxnType) ?? "BUY",
            shares: l.shares,
            costPrice: l.costPrice,
            lotDate: l.lotDate,
            notes: l.notes,
          }));

        return {
          id: p.id,
          symbol: p.symbol,
          referencePrice: p.referencePrice,
          latestPrice,
          totalShares: state.heldShares.toString(),
          avgCost: state.avgCost.toFixed(4),
          realizedPnl: state.realizedPnl,
          unrealizedPnl,
          totalPnl,
          totalPnlPercent,
          isClosed: state.isClosed,
          transactions,
        };
      })
    )
  );
}
