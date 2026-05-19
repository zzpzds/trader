export const dynamic = "force-dynamic";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { monitoringRuns } from "@trader/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const row = await db.query.monitoringRuns.findFirst({
    where: eq(monitoringRuns.id, id),
  });
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(row);
}
