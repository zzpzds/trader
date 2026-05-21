export const dynamic = "force-dynamic";
import { eq, desc, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@trader/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "all";
  const strategyIdParam = searchParams.get("strategyId");

  const whereParts: ((...args: any[]) => any)[] = [];

  if (status === "unread") {
    whereParts.push((n: any, { eq }: any) => eq(n.isRead, false));
  } else if (status === "read") {
    whereParts.push((n: any, { eq }: any) => eq(n.isRead, true));
  }

  if (strategyIdParam) {
    whereParts.push((n: any, { eq }: any) =>
      eq(n.monitoringRun.strategyId, strategyIdParam)
    );
  }

  const rows = await db.query.notifications.findMany({
    where: whereParts.length > 0
      ? (n: any, ops: any) => and(...whereParts.map((fn) => fn(n, ops)))
      : undefined,
    with: {
      monitoringRun: {
        columns: { strategyId: true, hasActionItems: true },
        with: {
          strategy: {
            columns: { name: true },
          },
        },
      },
    },
    orderBy: (n: any, { desc }: any) => [desc(n.createdAt)],
    limit: 50,
  });

  const mapped = rows.map((n: any) => ({
    id: n.id,
    monitoringRunId: n.monitoringRunId,
    strategyId: n.monitoringRun?.strategyId ?? null,
    strategyName: n.monitoringRun?.strategy?.name ?? null,
    title: n.title,
    content: n.content,
    isRead: n.isRead,
    createdAt: n.createdAt,
  }));

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const unreadCount = rows.filter((n: any) => !n.isRead).length;
  const todayCount = rows.filter((n: any) => new Date(n.createdAt) >= todayStart).length;
  const weekActionCount = rows.filter(
    (n: any) => new Date(n.createdAt) >= weekAgo && n.monitoringRun?.hasActionItems
  ).length;

  return Response.json({
    notifications: mapped,
    unreadCount,
    todayCount,
    weekActionCount,
  });
}
