import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@trader/db";

export async function DELETE() {
  await db
    .delete(notifications)
    .where(eq(notifications.isRead, true));

  return Response.json({ ok: true });
}
