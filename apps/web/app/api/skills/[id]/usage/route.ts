export const dynamic = "force-dynamic";

import { getSkill, getSkillUsage } from "@/lib/skills";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const skill = await getSkill(id);
  if (!skill) return Response.json({ error: "Not found" }, { status: 404 });
  const usage = await getSkillUsage(id);
  return Response.json(usage);
}
