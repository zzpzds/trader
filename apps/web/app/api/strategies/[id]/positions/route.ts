export const dynamic = "force-dynamic";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions, positionLots, strategies, monitoringRuns } from "@trader/db";

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

  const latestRun = await db.query.monitoringRuns.findFirst({
    where: eq(monitoringRuns.strategyId, strategyId),
    orderBy: (r, { desc }) => [desc(r.createdAt)],
  });

  const prices = (latestRun?.prices as Record<string, number>) ?? {};

  return Response.json(
    positionsList.map((p) => ({
      ...p,
      latestPrice: prices[p.symbol] ?? null,
    }))
  );
}
