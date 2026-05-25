export const dynamic = "force-dynamic";
import { db } from "@/lib/db";

export async function GET() {
  const allPositions = await db.query.positions.findMany({
    with: { positionLots: true },
  });

  const allRuns = await db.query.monitoringRuns.findMany({
    orderBy: (r, { desc }) => [desc(r.createdAt)],
  });

  // Latest run per strategy (runs are already sorted newest-first)
  const latestPrices = new Map<string, Record<string, number>>();
  for (const run of allRuns) {
    if (!latestPrices.has(run.strategyId) && run.prices) {
      latestPrices.set(run.strategyId, run.prices as Record<string, number>);
    }
  }

  let totalCost = 0;
  let coveredCost = 0;
  let totalValue = 0;
  let coveredPositions = 0;
  const totalPositions = allPositions.length;

  for (const pos of allPositions) {
    const { positionLots, strategyId, symbol } = pos;
    if (positionLots.length === 0) continue;

    const shares = positionLots.reduce((s, l) => s + l.shares, 0);
    const cost = positionLots.reduce((s, l) => s + l.shares * parseFloat(l.costPrice), 0);
    totalCost += cost;

    const latestPrice = latestPrices.get(strategyId)?.[symbol];
    if (latestPrice !== undefined) {
      coveredCost += cost;
      totalValue += shares * latestPrice;
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
    coveredPositions,
    totalPositions,
  });
}
