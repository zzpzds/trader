import * as schema from "@trader/db";
import { resolveSeedDir, parseFrontmatter } from "@trader/db";
import type { drizzle } from "drizzle-orm/postgres-js";
type Db = ReturnType<typeof drizzle<typeof schema>>;
export interface SeedSkillsResult {
    inserted: number;
    skipped: number;
    failed: number;
}
export { resolveSeedDir, parseFrontmatter };
interface SeedDeps {
    /** Override seed dir (test injection). Defaults to resolveSeedDir(). */
    seedDir?: string;
    /** Override file reader (test injection). */
    readDir?: (dir: string) => Promise<string[]>;
    readFileText?: (filePath: string) => Promise<string>;
    /** Override logger (test injection). */
    logger?: Pick<Console, "warn" | "error">;
}
/**
 * Idempotent seed: scan packages/db/seed/skills/*.md, parse, insert any that
 * don't yet exist by `name`. Failures on individual files are logged and counted
 * but do not abort the rest of the run.
 */
export declare function seedSkills(db: Db, deps?: SeedDeps): Promise<SeedSkillsResult>;
