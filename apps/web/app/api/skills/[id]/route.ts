export const dynamic = "force-dynamic";

import {
  ConflictError,
  ValidationError,
  deleteSkill,
  getSkill,
  updateSkill,
} from "@/lib/skills";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const row = await getSkill(id);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(row);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // Allowed fields: name, description, category, bodyMd. source / id silently dropped.
  const patch: {
    name?: string;
    description?: string | null;
    category?: string | null;
    bodyMd?: string;
  } = {};
  if (body.name !== undefined) patch.name = body.name as string;
  if (body.description !== undefined)
    patch.description = body.description as string | null;
  if (body.category !== undefined)
    patch.category = body.category as string | null;
  if (body.bodyMd !== undefined) patch.bodyMd = body.bodyMd as string;

  try {
    const row = await updateSkill(id, patch);
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(row);
  } catch (err) {
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof ConflictError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ok = await deleteSkill(id);
  if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
