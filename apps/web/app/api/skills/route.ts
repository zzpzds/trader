export const dynamic = "force-dynamic";

import {
  ConflictError,
  ValidationError,
  createSkill,
  listSkills,
} from "@/lib/skills";

export async function GET() {
  const rows = await listSkills();
  return Response.json(rows);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    const row = await createSkill({
      name: body.name as string,
      description: (body.description ?? null) as string | null,
      category: (body.category ?? null) as string | null,
      bodyMd: body.bodyMd as string,
    });
    return Response.json(row, { status: 201 });
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
