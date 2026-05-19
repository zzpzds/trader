import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@trader/db";

export async function PUT(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(eq(notifications.id, id));
  return Response.json({ ok: true });
}
