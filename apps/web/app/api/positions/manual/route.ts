export const dynamic = "force-dynamic";
import { eq, isNull, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions, priceSnapshots } from "@trader/db";
import { upsertPositionAndCreateLot } from "@/lib/position-service";
import { getBoss } from "@/lib/queue";

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

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { symbol, shares, costPrice, lotDate, notes } = body ?? {};

  if (typeof symbol !== "string" || symbol.trim() === "") {
    return Response.json({ error: "symbol required" }, { status: 400 });
  }
  if (typeof shares !== "number" || !(shares > 0)) {
    return Response.json({ error: "shares must be > 0" }, { status: 400 });
  }
  if (typeof costPrice !== "string" || !(parseFloat(costPrice) > 0)) {
    return Response.json({ error: "costPrice must be > 0" }, { status: 400 });
  }
  const today = new Date().toISOString().slice(0, 10);
  if (typeof lotDate !== "string" || lotDate > today) {
    return Response.json({ error: "lotDate must be on or before today" }, { status: 400 });
  }

  const trimmedSymbol = symbol.trim().toUpperCase();
  const { positionId, lot } = await upsertPositionAndCreateLot(
    null,
    trimmedSymbol,
    shares,
    costPrice,
    lotDate,
    typeof notes === "string" && notes.trim() !== "" ? notes.trim() : undefined
  );

  try {
    const boss = await getBoss();
    await boss.send("manual-backfill", { symbol: trimmedSymbol, fromDate: lotDate });
  } catch (err) {
    console.error(
      "[api/positions/manual] failed to enqueue manual-backfill:",
      err instanceof Error ? err.message : String(err)
    );
  }

  return Response.json({ positionId, lotId: lot.id }, { status: 201 });
}
