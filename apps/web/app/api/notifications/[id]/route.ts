import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@trader/db";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await db
    .delete(notifications)
    .where(eq(notifications.id, id));

  return Response.json({ ok: true });
}
