export const dynamic = "force-dynamic";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { strategies } from "@trader/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const row = await db.query.strategies.findFirst({
    where: eq(strategies.id, id),
  });
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(row);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { name, symbols, content, script, analysisWindowDays } = body as {
    name?: string;
    symbols?: string[];
    content?: string;
    script?: string;
    analysisWindowDays?: number;
  };

  if (analysisWindowDays !== undefined) {
    if (
      typeof analysisWindowDays !== "number" ||
      !Number.isInteger(analysisWindowDays) ||
      analysisWindowDays < 1
    ) {
      return Response.json(
        { error: "analysisWindowDays must be a positive integer" },
        { status: 400 }
      );
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name;
  if (symbols !== undefined) updates.symbols = symbols;
  if (content !== undefined) updates.content = content;
  if (script !== undefined) updates.script = script;
  if (analysisWindowDays !== undefined) updates.analysisWindowDays = analysisWindowDays;

  const [row] = await db
    .update(strategies)
    .set(updates)
    .where(eq(strategies.id, id))
    .returning();

  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(row);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await db.delete(strategies).where(eq(strategies.id, id));
  return new Response(null, { status: 204 });
}
