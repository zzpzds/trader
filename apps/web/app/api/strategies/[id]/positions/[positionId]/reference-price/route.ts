import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions } from "@trader/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; positionId: string }> }
) {
  const { id: strategyId, positionId } = await params;
  const body = await request.json();
  const { referencePrice } = body as { referencePrice?: string };

  if (!referencePrice) {
    return Response.json(
      { error: "referencePrice is required" },
      { status: 400 }
    );
  }

  const existing = await db.query.positions.findFirst({
    where: and(eq(positions.id, positionId), eq(positions.strategyId, strategyId)),
  });

  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const [updated] = await db
    .update(positions)
    .set({ referencePrice })
    .where(eq(positions.id, positionId))
    .returning();

  return Response.json(updated);
}
