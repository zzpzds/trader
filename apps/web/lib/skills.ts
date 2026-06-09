import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { eq, asc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  skills,
  strategies,
  strategySkills,
  type SkillRow,
  resolveSeedDir,
  parseFrontmatter,
} from "@trader/db";
import {
  SKILL_BODY_MAX,
  SKILL_CATEGORIES,
  STRATEGY_SKILLS_MAX,
  type SkillCategory,
} from "@/lib/skills-ui";

// Re-export the client-safe constants so existing imports from "@/lib/skills"
// continue to work for server-side code.
export {
  SKILL_BODY_MAX,
  SKILL_CATEGORIES,
  STRATEGY_SKILLS_MAX,
  type SkillCategory,
};

// Postgres error codes (https://www.postgresql.org/docs/current/errcodes-appendix.html)
export const PG_ERROR_CODES = {
  UNIQUE_VIOLATION: "23505",
  FK_VIOLATION: "23503",
} as const;

function getPgErrorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? ((err as { code?: unknown }).code as string | undefined)
    : undefined;
}

export function isUniqueViolation(err: unknown): boolean {
  return getPgErrorCode(err) === PG_ERROR_CODES.UNIQUE_VIOLATION;
}

export function isFkViolation(err: unknown): boolean {
  return getPgErrorCode(err) === PG_ERROR_CODES.FK_VIOLATION;
}

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

export class NotFoundError extends Error {
  code = "NOT_FOUND" as const;
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
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
      // The only UNIQUE column is `name`, which is only updated when patch.name is set.
      throw new ConflictError(
        `skill with name "${String(updates.name)}" already exists`
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

export async function getSkillUsage(skillId: string): Promise<{
  associatedStrategyCount: number;
  strategyNames: string[];
}> {
  const links = await db.query.strategySkills.findMany({
    where: eq(strategySkills.skillId, skillId),
    columns: { strategyId: true },
  });
  const strategyIds = links.map((l) => l.strategyId);
  if (strategyIds.length === 0) {
    return { associatedStrategyCount: 0, strategyNames: [] };
  }
  const rows = await db.query.strategies.findMany({
    where: inArray(strategies.id, strategyIds),
    columns: { name: true },
    orderBy: (s) => [asc(s.name)],
  });
  return {
    associatedStrategyCount: rows.length,
    strategyNames: rows.map((r) => r.name),
  };
}

// ---------- Seed manifest / import ----------
//
// Status semantics (server-computed):
//   - "missing": DB has no row with this seed's name
//   - "in-sync": DB has the row AND sha256(db.body_md) === sha256(repo body)
//   - "edited" : DB has the row AND hashes differ
//
// Mode validity (server-enforced):
//   - "create"          → only valid when status === "missing"
//   - "overwrite-seed"  → only valid when DB row exists and source === "seed".
//                          The UI surfaces this only when status is "edited"
//                          and source === "seed" (i.e. the repo bumped the
//                          seed but the user has never edited it). Server-side
//                          we accept any state where source === "seed", since
//                          calling overwrite on an "in-sync" row is a no-op
//                          rather than a hazard.
//   - "duplicate"       → valid in any state; produces a fresh `<name>-vibe-trading`
//                          (or `-vibe-trading-N`) row so the user can keep both
//                          their edits and a clean copy of the seed.
//
// File-not-found yields NotFoundError (mapped to 404 by the route).

export type SeedManifestStatus = "missing" | "in-sync" | "edited";

export interface SeedManifestEntry {
  name: string;
  description: string | null;
  category: string | null;
  currentBodyHash: string;
  status: SeedManifestStatus;
  /** DB-side source if the skill exists, else null. Helps UI decide whether
   *  to offer "overwrite-seed" (only when source === "seed"). */
  source: "seed" | "user" | null;
}

export type SeedImportMode = "create" | "overwrite-seed" | "duplicate";

interface SeedDeps {
  /** Override seed dir (test injection). Defaults to resolveSeedDir(). */
  seedDir?: string;
  /** Override file reader (test injection). */
  readDir?: (dir: string) => Promise<string[]>;
  readFileText?: (filePath: string) => Promise<string>;
  /** Override logger (test injection). */
  logger?: Pick<Console, "warn" | "error">;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export async function getSeedManifest(
  deps: SeedDeps = {}
): Promise<SeedManifestEntry[]> {
  const seedDir = deps.seedDir ?? resolveSeedDir();
  const readDir = deps.readDir ?? ((d: string) => readdir(d));
  const readFileText =
    deps.readFileText ?? ((p: string) => readFile(p, "utf8"));
  const logger = deps.logger ?? console;

  const entries = await readDir(seedDir);
  const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();

  const dbRows = await db.query.skills.findMany({
    columns: { name: true, source: true, bodyMd: true },
  });
  const byName = new Map<string, { source: "seed" | "user"; bodyMd: string }>();
  for (const r of dbRows) {
    byName.set(r.name, {
      source: r.source as "seed" | "user",
      bodyMd: r.bodyMd,
    });
  }

  const out: SeedManifestEntry[] = [];
  for (const fname of mdFiles) {
    try {
      const raw = await readFileText(path.join(seedDir, fname));
      const parsed = parseFrontmatter(raw);
      const currentBodyHash = sha256(parsed.bodyMd);
      const dbRow = byName.get(parsed.name);
      let status: SeedManifestStatus;
      let source: "seed" | "user" | null = null;
      if (!dbRow) {
        status = "missing";
      } else {
        source = dbRow.source;
        status =
          sha256(dbRow.bodyMd) === currentBodyHash ? "in-sync" : "edited";
      }
      out.push({
        name: parsed.name,
        description: parsed.description,
        category: parsed.category,
        currentBodyHash,
        status,
        source,
      });
    } catch (err) {
      logger.warn(
        `[seed-manifest] failed to parse ${fname}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  return out;
}

async function findFreeDuplicateName(baseName: string): Promise<string> {
  const candidates: string[] = [`${baseName}-vibe-trading`];
  for (let i = 2; i <= 20; i++) {
    candidates.push(`${baseName}-vibe-trading-${i}`);
  }
  const existing = await db.query.skills.findMany({
    columns: { name: true },
    where: inArray(skills.name, candidates),
  });
  const taken = new Set(existing.map((r) => r.name));
  const free = candidates.find((c) => !taken.has(c));
  if (!free) {
    throw new ConflictError(
      `could not find a free duplicate name for "${baseName}" (>20 copies)`
    );
  }
  return free;
}

async function readSeedFileByName(
  name: string,
  deps: SeedDeps
): Promise<{
  name: string;
  description: string | null;
  category: string | null;
  bodyMd: string;
}> {
  const seedDir = deps.seedDir ?? resolveSeedDir();
  const readDir = deps.readDir ?? ((d: string) => readdir(d));
  const readFileText =
    deps.readFileText ?? ((p: string) => readFile(p, "utf8"));

  const entries = await readDir(seedDir);
  const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();
  for (const fname of mdFiles) {
    const raw = await readFileText(path.join(seedDir, fname));
    const parsed = parseFrontmatter(raw);
    if (parsed.name === name) return parsed;
  }
  throw new NotFoundError(`seed file not found for name "${name}"`);
}

export async function importSeedSkill(
  input: { name: string; mode: SeedImportMode },
  deps: SeedDeps = {}
): Promise<SkillRow> {
  if (!input.name || typeof input.name !== "string") {
    throw new ValidationError("name is required");
  }
  if (
    input.mode !== "create" &&
    input.mode !== "overwrite-seed" &&
    input.mode !== "duplicate"
  ) {
    throw new ValidationError("mode must be create | overwrite-seed | duplicate");
  }

  // 1. Locate seed file (404 surface lives in the route).
  const parsed = await readSeedFileByName(input.name, deps);

  // 2. Look up current DB state for this name.
  const dbRow = await db.query.skills.findFirst({
    where: eq(skills.name, parsed.name),
    columns: { id: true, source: true },
  });

  // 3. Validate mode against DB state.
  if (input.mode === "create" && dbRow) {
    throw new ConflictError(
      `skill with name "${parsed.name}" already exists; use mode='overwrite-seed' or mode='duplicate'`
    );
  }
  if (input.mode === "overwrite-seed") {
    if (!dbRow) {
      throw new ConflictError(
        `skill "${parsed.name}" does not exist; use mode='create' first`
      );
    }
    if (dbRow.source !== "seed") {
      throw new ConflictError(
        "skill has been edited; use mode='duplicate' to import as a copy"
      );
    }
  }

  // 4. Execute.
  if (input.mode === "create") {
    const [row] = await db
      .insert(skills)
      .values({
        name: parsed.name,
        description: parsed.description,
        category: parsed.category,
        bodyMd: parsed.bodyMd,
        source: "seed",
      })
      .returning();
    return row;
  }

  if (input.mode === "overwrite-seed") {
    const [row] = await db
      .update(skills)
      .set({
        bodyMd: parsed.bodyMd,
        description: parsed.description,
        category: parsed.category,
        source: "seed",
        updatedAt: new Date(),
      })
      .where(eq(skills.id, dbRow!.id))
      .returning();
    return row;
  }

  // mode === "duplicate"
  const freeName = await findFreeDuplicateName(parsed.name);
  const [row] = await db
    .insert(skills)
    .values({
      name: freeName,
      description: parsed.description,
      category: parsed.category,
      bodyMd: parsed.bodyMd,
      source: "seed",
    })
    .returning();
  return row;
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
