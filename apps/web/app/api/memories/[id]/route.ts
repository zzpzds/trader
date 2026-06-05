export const dynamic = "force-dynamic";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { memories } from "@trader/db";

const VALID_KINDS = new Set(["note", "idea", "lesson", "context"]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const row = await db.query.memories.findFirst({
    where: eq(memories.id, id),
  });
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(row);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.length === 0)
      return Response.json({ error: "invalid title" }, { status: 400 });
    updates.title = body.title;
  }
  if (body.content !== undefined) {
    if (typeof body.content !== "string")
      return Response.json({ error: "invalid content" }, { status: 400 });
    updates.content = body.content;
  }
  if (body.kind !== undefined) {
    if (!VALID_KINDS.has(body.kind))
      return Response.json({ error: "invalid kind" }, { status: 400 });
    updates.kind = body.kind;
  }
  if (body.strategyId !== undefined) updates.strategyId = body.strategyId ?? null;
  if (body.symbol !== undefined) updates.symbol = body.symbol ?? null;
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags))
      return Response.json({ error: "tags must be an array" }, { status: 400 });
    updates.tags = body.tags;
  }
  if (body.pinned !== undefined) updates.pinned = !!body.pinned;

  const rows = await db
    .update(memories)
    .set(updates)
    .where(eq(memories.id, id))
    .returning();

  if (rows.length === 0)
    return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(rows[0]);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rows = await db
    .delete(memories)
    .where(eq(memories.id, id))
    .returning();
  if (rows.length === 0)
    return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
