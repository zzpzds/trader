import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { positionLots } from "@trader/db";
import { canDeleteBuy, type Txn, type TxnType } from "@/lib/pnl";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ lotId: string }> }
) {
  const { lotId } = await params;
  const body = await request.json();
  const { shares, costPrice, lotDate, notes } = body as {
    shares?: number;
    costPrice?: string;
    lotDate?: string;
    notes?: string;
  };

  const updates: Record<string, unknown> = {};
  if (shares !== undefined) updates.shares = shares;
  if (costPrice !== undefined) updates.costPrice = costPrice;
  if (lotDate !== undefined) updates.lotDate = lotDate;
  if (notes !== undefined) updates.notes = notes;

  const [row] = await db
    .update(positionLots)
    .set(updates)
    .where(eq(positionLots.id, lotId))
    .returning();

  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(row);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ lotId: string }> }
) {
  const { lotId } = await params;

  const lot = await db.query.positionLots.findFirst({
    where: eq(positionLots.id, lotId),
    with: { position: { with: { positionLots: true } } },
  });
  if (!lot) return new Response(null, { status: 204 });

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

  await db.delete(positionLots).where(eq(positionLots.id, lotId));
  return new Response(null, { status: 204 });
}
