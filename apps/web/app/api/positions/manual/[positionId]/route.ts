export const dynamic = "force-dynamic";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { positions } from "@trader/db";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ positionId: string }> }
) {
  const { positionId } = await params;

  const pos = await db.query.positions.findFirst({
    where: eq(positions.id, positionId),
  });

  if (!pos || pos.strategyId !== null) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  await db.delete(positions).where(eq(positions.id, positionId));
  return Response.json({ ok: true });
}
