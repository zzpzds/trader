export const dynamic = "force-dynamic";

import {
  ValidationError,
  getStrategySkillIds,
  isFkViolation,
  setStrategySkills,
} from "@/lib/skills";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const skillIds = await getStrategySkillIds(id);
  return Response.json({ skillIds });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const skillIds = body.skillIds;

  try {
    await setStrategySkills(id, skillIds as string[]);
    // Re-read to return canonical state (also dedupes)
    const current = await getStrategySkillIds(id);
    return Response.json({ skillIds: current });
  } catch (err) {
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    // FK violation on unknown skill id → 400
    if (isFkViolation(err)) {
      return Response.json(
        { error: "one or more skillIds reference unknown skill or strategy" },
        { status: 400 }
      );
    }
    throw err;
  }
}
