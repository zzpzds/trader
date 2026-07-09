import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions, positionLots, type PositionLotRow } from "@trader/db";
import { replayPosition, type Txn, type TxnType } from "@/lib/pnl";

export async function upsertPositionAndCreateLot(
  strategyId: string | null,
  symbol: string,
  shares: number,
  costPrice: string,
  lotDate: string,
  notes?: string
) {
  const existing = await db.query.positions.findFirst({
    where:
      strategyId === null
        ? and(isNull(positions.strategyId), eq(positions.symbol, symbol))
        : and(eq(positions.strategyId, strategyId), eq(positions.symbol, symbol)),
  });

  let positionId: string;

  if (existing) {
    positionId = existing.id;
    await db
      .update(positions)
      .set({ updatedAt: new Date() })
      .where(eq(positions.id, positionId));
  } else {
    const [pos] = await db
      .insert(positions)
      .values({ strategyId, symbol, referencePrice: costPrice })
      .returning();
    positionId = pos.id;
  }

  const [lot] = await db
    .insert(positionLots)
    .values({ positionId, type: "BUY", shares: String(shares), costPrice, lotDate, notes: notes ?? null })
    .returning();

  return { positionId, lot };
}

export async function deleteLotAndCheckPosition(lotId: string) {
  const lot = await db.query.positionLots.findFirst({
    where: eq(positionLots.id, lotId),
  });

  if (!lot) return null;

  await db.delete(positionLots).where(eq(positionLots.id, lotId));

  return lot;
}

export async function recordSell(
  strategyId: string | null,
  symbol: string,
  shares: number,
  price: string,
  sellDate: string,
  notes?: string
): Promise<{ positionId?: string; lot?: PositionLotRow; error?: string; status: number }> {
  const position = await db.query.positions.findFirst({
    where:
      strategyId === null
        ? and(isNull(positions.strategyId), eq(positions.symbol, symbol))
        : and(eq(positions.strategyId, strategyId), eq(positions.symbol, symbol)),
    with: { positionLots: true },
  });

  if (!position) {
    return { error: "no position to sell", status: 404 };
  }

  const lots = (position as any).positionLots as Array<{
    id: string;
    type: string | null;
    shares: string;
    costPrice: string;
    lotDate: string;
    createdAt: Date;
  }>;

  const buyDates = lots
    .filter((l) => (l.type ?? "BUY") === "BUY")
    .map((l) => l.lotDate)
    .sort();
  if (buyDates.length === 0 || sellDate < buyDates[0]) {
    return { error: "sellDate is before first buy", status: 400 };
  }

  const txns: Txn[] = lots.map((l) => ({
    id: l.id,
    type: (l.type as TxnType) ?? "BUY",
    shares: parseFloat(l.shares),
    price: parseFloat(l.costPrice),
    date: l.lotDate,
    createdAt: l.createdAt,
  }));
  const state = replayPosition(txns);

  if (shares > state.heldShares + 1e-9) {
    return { error: "cannot sell more shares than held", status: 400 };
  }

  const [lot] = await db
    .insert(positionLots)
    .values({
      positionId: position.id,
      type: "SELL",
      shares: String(shares),
      costPrice: price,
      lotDate: sellDate,
      notes: notes ?? null,
    })
    .returning();

  return { positionId: position.id, lot, status: 201 };
}
