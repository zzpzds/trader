export const dynamic = "force-dynamic";
import { eq, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { positionLots, positions } from "@trader/db";
import { canDeleteBuy, type Txn, type TxnType } from "@/lib/pnl";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ lotId: string }> }
) {
  const { lotId } = await params;

  const lot = await db.query.positionLots.findFirst({
    where: eq(positionLots.id, lotId),
    with: { position: { with: { positionLots: true } } },
  });

  if (!lot || (lot as any).position?.strategyId !== null) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const siblings = (lot as any).position?.positionLots as any[] | undefined;
  if (siblings) {
    const txns: Txn[] = siblings.map((l) => ({
      id: l.id,
      type: (l.type as TxnType) ?? "BUY",
      shares: parseFloat(l.shares),
      price: parseFloat(l.costPrice),
      date: l.lotDate,
      createdAt: l.createdAt,
    }));
    if (!canDeleteBuy(txns, lotId)) {
      return Response.json(
        { error: "deleting this buy would make holdings negative; delete the sell first" },
        { status: 409 }
      );
    }
  }

  const positionId = (lot as any).positionId;

  await db.delete(positionLots).where(eq(positionLots.id, lotId));

  const remaining = await db
    .select({ count: count() })
    .from(positionLots)
    .where(eq(positionLots.positionId, positionId));

  if (Number(remaining[0]?.count ?? 0) === 0) {
    await db.delete(positions).where(eq(positions.id, positionId));
    return Response.json({ deletedPosition: true });
  }
  return Response.json({ deletedPosition: false });
}
