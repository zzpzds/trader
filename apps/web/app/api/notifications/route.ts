export const dynamic = "force-dynamic";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@trader/db";

export async function GET() {
  const rows = await db.query.notifications.findMany({
    orderBy: (n, { desc }) => [desc(n.createdAt)],
    limit: 50,
  });

  const unreadCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(eq(notifications.isRead, false));

  return Response.json({
    notifications: rows,
    unreadCount: Number(unreadCount[0]?.count ?? 0),
  });
}
