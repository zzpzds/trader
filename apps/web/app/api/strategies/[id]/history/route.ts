export const dynamic = "force-dynamic";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { monitoringRuns, positions } from "@trader/db";

function getCutoff(range: string): string | null {
  if (range === "all") return null;
  const d = new Date();
  d.setDate(d.getDate() - (range === "3m" ? 90 : 30));
  return d.toISOString().slice(0, 10);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: strategyId } = await params;
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") ?? "1m";
  const cutoff = getCutoff(range);

  const strategyPositions = await db.query.positions.findMany({
    where: eq(positions.strategyId, strategyId),
    with: { positionLots: true },
  });

  // symbol → { shares, cost }
  const costBasis = new Map<string, { shares: number; cost: number }>();
  for (const pos of strategyPositions) {
    if (pos.positionLots.length === 0) continue;
    const shares = pos.positionLots.reduce((s, l) => s + l.shares, 0);
    const cost = pos.positionLots.reduce((s, l) => s + l.shares * parseFloat(l.costPrice), 0);
    costBasis.set(pos.symbol, { shares, cost });
  }

  const conditions = [
    eq(monitoringRuns.strategyId, strategyId),
    eq(monitoringRuns.status, "completed"),
  ];
  if (cutoff) conditions.push(gte(monitoringRuns.runDate, cutoff));

  const runs = await db.query.monitoringRuns.findMany({
    where: and(...conditions),
    orderBy: (r, { asc }) => [asc(r.runDate), asc(r.createdAt)],
  });

  // runDate → prices  (last write wins = latest createdAt)
  const latestByDate = new Map<string, Record<string, number>>();
  for (const run of runs) {
    if (run.prices) latestByDate.set(run.runDate, run.prices as Record<string, number>);
  }

  const result: Array<{ date: string; percentPnl: number }> = [];
  for (const date of [...latestByDate.keys()].sort()) {
    const prices = latestByDate.get(date)!;
    let coveredValue = 0;
    let coveredCost = 0;

    for (const [symbol, { shares, cost }] of costBasis) {
      const price = prices[symbol];
      if (price === undefined) continue;
      coveredValue += shares * price;
      coveredCost += cost;
    }

    if (coveredCost === 0) continue;
    result.push({
      date,
      percentPnl: Math.round(((coveredValue - coveredCost) / coveredCost) * 10000) / 100,
    });
  }

  return Response.json(result);
}
