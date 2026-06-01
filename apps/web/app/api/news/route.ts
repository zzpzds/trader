export const dynamic = "force-dynamic";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { newsSummaries } from "@trader/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? new Date().toISOString().slice(0, 10);

  const rows = await db.query.newsSummaries.findMany({
    where: eq(newsSummaries.summaryDate, date),
    with: { strategy: { columns: { name: true } } },
  });

  return Response.json({
    date,
    summaries: rows.map((r) => ({
      strategyId: r.strategyId,
      strategyName: (r as { strategy?: { name: string } }).strategy?.name ?? null,
      content: r.content,
    })),
  });
}
