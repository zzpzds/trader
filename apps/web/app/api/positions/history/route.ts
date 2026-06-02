export const dynamic = "force-dynamic";
import { and, asc, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { priceSnapshots } from "@trader/db";

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

  // Aggregate by symbol across all positions (strategy + manual)
  const bySymbol = new Map<string, { shares: number; cost: number }>();
  for (const pos of allPositions as any[]) {
    if (pos.positionLots.length === 0) continue;
    const shares = pos.positionLots.reduce(
      (s: number, l: any) => s + parseFloat(l.shares),
      0
    );
    const cost = pos.positionLots.reduce(
      (s: number, l: any) => s + parseFloat(l.shares) * parseFloat(l.costPrice),
      0
    );
    const cur = bySymbol.get(pos.symbol) ?? { shares: 0, cost: 0 };
    cur.shares += shares;
    cur.cost += cost;
    bySymbol.set(pos.symbol, cur);
  }

  const symbols = [...bySymbol.keys()];
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

  // date → symbol → close
  const byDate = new Map<string, Map<string, number>>();
  for (const r of rows as any[]) {
    if (!byDate.has(r.date)) byDate.set(r.date, new Map());
    byDate.get(r.date)!.set(r.symbol, parseFloat(r.close));
  }

  const result: Array<{ date: string; percentPnl: number }> = [];
  for (const date of [...byDate.keys()].sort()) {
    const prices = byDate.get(date)!;
    let value = 0;
    let cost = 0;
    for (const [symbol, agg] of bySymbol) {
      const px = prices.get(symbol);
      if (px === undefined) continue;
      value += agg.shares * px;
      cost += agg.cost;
    }
    if (cost === 0) continue;
    result.push({
      date,
      percentPnl: Math.round(((value - cost) / cost) * 10000) / 100,
    });
  }

  return Response.json(result);
}
