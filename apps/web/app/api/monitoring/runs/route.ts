export const dynamic = "force-dynamic";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { monitoringRuns, strategies } from "@trader/db";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const strategyId = url.searchParams.get("strategyId");
  const date = url.searchParams.get("date");

  const conditions = [];
  if (strategyId) conditions.push(eq(monitoringRuns.strategyId, strategyId));
  if (date) conditions.push(eq(monitoringRuns.runDate, date));

  const rows = await db.query.monitoringRuns.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: (r, { desc }) => [desc(r.createdAt)],
    limit: 100,
  });

  const strategyNames = new Map<string, string>();
  for (const row of rows) {
    if (!strategyNames.has(row.strategyId)) {
      const s = await db.query.strategies.findFirst({
        where: eq(strategies.id, row.strategyId),
      });
      if (s) strategyNames.set(row.strategyId, s.name);
    }
  }

  return Response.json(
    rows.map((r) => ({
      ...r,
      strategyName: strategyNames.get(r.strategyId) ?? "Unknown",
    }))
  );
}
