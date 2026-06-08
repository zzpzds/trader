import { notFound } from "next/navigation";
import { SkillEditor } from "@/components/skill-editor";
import { getSkill, getSkillUsage, type SkillCategory } from "@/lib/skills";

export const dynamic = "force-dynamic";

export default async function EditSkillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [skill, usage] = await Promise.all([getSkill(id), getSkillUsage(id)]);
  if (!skill) notFound();

  return (
    <SkillEditor
      mode="edit"
      initial={{
        id: skill.id,
        name: skill.name,
        description: skill.description,
        category: (skill.category ?? null) as SkillCategory | null,
        bodyMd: skill.bodyMd,
      }}
      associationCount={usage.associatedStrategyCount}
      associatedStrategyNames={usage.strategyNames}
    />
  );
}
