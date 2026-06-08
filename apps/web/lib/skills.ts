import { eq, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { skills, strategySkills, type SkillRow } from "@trader/db";

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

const VALID_CATEGORIES = new Set<string>(SKILL_CATEGORIES);

export class ConflictError extends Error {
  code = "CONFLICT" as const;
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class ValidationError extends Error {
  code = "VALIDATION" as const;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// ---------- Pure validators ----------

export function validateSkillName(name: unknown): string | null {
  if (typeof name !== "string") return "name must be a string";
  const trimmed = name.trim();
  if (trimmed.length === 0) return "name is required";
  if (trimmed.length > 200) return "name must be ≤ 200 characters";
  return null;
}

export function validateSkillBody(body: unknown): string | null {
  if (typeof body !== "string") return "bodyMd must be a string";
  if (body.trim().length === 0) return "bodyMd is required";
  if (body.length > SKILL_BODY_MAX) {
    return `bodyMd must be ≤ ${SKILL_BODY_MAX} characters (got ${body.length})`;
  }
  return null;
}

export function validateSkillDescription(description: unknown): string | null {
  if (description === undefined || description === null) return null;
  if (typeof description !== "string") return "description must be a string";
  if (description.length > 500) return "description must be ≤ 500 characters";
  return null;
}

export function validateSkillCategory(category: unknown): string | null {
  if (category === undefined || category === null) return null;
  if (typeof category !== "string") return "category must be a string";
  if (!VALID_CATEGORIES.has(category)) {
    return `category must be one of: ${SKILL_CATEGORIES.join(", ")}`;
  }
  return null;
}

export function validateSkillIdsList(ids: unknown): string | null {
  if (!Array.isArray(ids)) return "skillIds must be an array";
  if (ids.length > STRATEGY_SKILLS_MAX) {
    return `skillIds must contain at most ${STRATEGY_SKILLS_MAX} entries (got ${ids.length})`;
  }
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || id.trim().length === 0) {
      return "skillIds entries must be non-empty strings";
    }
    if (seen.has(id)) {
      return "skillIds must not contain duplicates";
    }
    seen.add(id);
  }
  return null;
}

// ---------- DB helpers ----------

export interface CreateSkillInput {
  name: string;
  description?: string | null;
  category?: string | null;
  bodyMd: string;
  source?: "user" | "seed";
}

export interface UpdateSkillInput {
  name?: string;
  description?: string | null;
  category?: string | null;
  bodyMd?: string;
}

export type SkillListItem = Pick<
  SkillRow,
  "id" | "name" | "description" | "category" | "source" | "updatedAt"
>;

export async function listSkills(): Promise<SkillListItem[]> {
  const rows = await db.query.skills.findMany({
    columns: {
      id: true,
      name: true,
      description: true,
      category: true,
      source: true,
      updatedAt: true,
    },
    orderBy: (s) => [asc(s.category), asc(s.name)],
  });
  return rows;
}

export async function getSkill(id: string): Promise<SkillRow | null> {
  const row = await db.query.skills.findFirst({
    where: eq(skills.id, id),
  });
  return row ?? null;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

export async function createSkill(input: CreateSkillInput): Promise<SkillRow> {
  const nameErr = validateSkillName(input.name);
  if (nameErr) throw new ValidationError(nameErr);
  const bodyErr = validateSkillBody(input.bodyMd);
  if (bodyErr) throw new ValidationError(bodyErr);
  const descErr = validateSkillDescription(input.description ?? undefined);
  if (descErr) throw new ValidationError(descErr);
  const catErr = validateSkillCategory(input.category ?? undefined);
  if (catErr) throw new ValidationError(catErr);

  const name = input.name.trim();

  // Pre-check for clearer error before relying on UNIQUE violation
  const existing = await db.query.skills.findFirst({
    where: eq(skills.name, name),
    columns: { id: true },
  });
  if (existing) {
    throw new ConflictError(`skill with name "${name}" already exists`);
  }

  try {
    const [row] = await db
      .insert(skills)
      .values({
        name,
        description: input.description ?? null,
        category: input.category ?? null,
        bodyMd: input.bodyMd,
        source: input.source ?? "user",
      })
      .returning();
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(`skill with name "${name}" already exists`);
    }
    throw err;
  }
}

export async function updateSkill(
  id: string,
  patch: UpdateSkillInput
): Promise<SkillRow | null> {
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (patch.name !== undefined) {
    const err = validateSkillName(patch.name);
    if (err) throw new ValidationError(err);
    updates.name = patch.name.trim();
  }
  if (patch.bodyMd !== undefined) {
    const err = validateSkillBody(patch.bodyMd);
    if (err) throw new ValidationError(err);
    updates.bodyMd = patch.bodyMd;
  }
  if (patch.description !== undefined) {
    const err = validateSkillDescription(patch.description ?? undefined);
    if (err) throw new ValidationError(err);
    updates.description = patch.description ?? null;
  }
  if (patch.category !== undefined) {
    const err = validateSkillCategory(patch.category ?? undefined);
    if (err) throw new ValidationError(err);
    updates.category = patch.category ?? null;
  }

  // If name change, pre-check uniqueness against other rows
  if (typeof updates.name === "string") {
    const existing = await db.query.skills.findFirst({
      where: eq(skills.name, updates.name as string),
      columns: { id: true },
    });
    if (existing && existing.id !== id) {
      throw new ConflictError(
        `skill with name "${updates.name}" already exists`
      );
    }
  }

  try {
    const rows = await db
      .update(skills)
      .set(updates)
      .where(eq(skills.id, id))
      .returning();
    return rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(
        typeof updates.name === "string"
          ? `skill with name "${updates.name}" already exists`
          : "skill name conflict"
      );
    }
    throw err;
  }
}

export async function deleteSkill(id: string): Promise<boolean> {
  const rows = await db.delete(skills).where(eq(skills.id, id)).returning({
    id: skills.id,
  });
  return rows.length > 0;
}

export async function getStrategySkillIds(
  strategyId: string
): Promise<string[]> {
  const rows = await db.query.strategySkills.findMany({
    where: eq(strategySkills.strategyId, strategyId),
    columns: { skillId: true },
  });
  return rows.map((r) => r.skillId);
}

export async function setStrategySkills(
  strategyId: string,
  skillIds: string[]
): Promise<void> {
  const err = validateSkillIdsList(skillIds);
  if (err) throw new ValidationError(err);

  // Deduplicate defensively (validator already rejects dupes, but be safe)
  const unique = Array.from(new Set(skillIds));

  await db.transaction(async (tx) => {
    await tx
      .delete(strategySkills)
      .where(eq(strategySkills.strategyId, strategyId));
    if (unique.length > 0) {
      await tx
        .insert(strategySkills)
        .values(unique.map((skillId) => ({ strategyId, skillId })));
    }
  });
}
