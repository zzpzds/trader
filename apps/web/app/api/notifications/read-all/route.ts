import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@trader/db";

export async function PUT() {
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(eq(notifications.isRead, false));
  return Response.json({ ok: true });
}
