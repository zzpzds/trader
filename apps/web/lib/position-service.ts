import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions, positionLots } from "@trader/db";

export async function upsertPositionAndCreateLot(
  strategyId: string,
  symbol: string,
  shares: number,
  costPrice: string,
  lotDate: string,
  notes?: string
) {
  const existing = await db.query.positions.findFirst({
    where: and(eq(positions.strategyId, strategyId), eq(positions.symbol, symbol)),
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
    .values({ positionId, shares, costPrice, lotDate, notes: notes ?? null })
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
