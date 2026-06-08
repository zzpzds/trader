// Client-safe constants and helpers for the skills feature.
// Keep this file free of any DB / server imports so it can be used in
// "use client" components.

export const SKILL_BODY_MAX = 6000;
export const STRATEGY_SKILLS_MAX = 3;

export const SKILL_CATEGORIES = [
  "pattern",
  "risk",
  "valuation",
  "behavioral",
  "macro",
  "other",
] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<SkillCategory, string> = {
  pattern: "形态识别",
  risk: "风险管理",
  valuation: "估值方法",
  behavioral: "行为金融",
  macro: "宏观分析",
  other: "其他",
};

export function categoryLabel(category: string | null | undefined): string {
  if (!category) return CATEGORY_LABELS.other;
  return (CATEGORY_LABELS as Record<string, string>)[category] ?? category;
}
