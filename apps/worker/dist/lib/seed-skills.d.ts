import * as schema from "@trader/db";
import type { drizzle } from "drizzle-orm/postgres-js";
type Db = ReturnType<typeof drizzle<typeof schema>>;
export interface SeedSkillsResult {
    inserted: number;
    skipped: number;
    failed: number;
}
interface ParsedSkill {
    name: string;
    description: string | null;
    category: string | null;
    bodyMd: string;
}
/**
 * Resolve the seed directory inside `@trader/db`. The directory ships with
 * the `packages/db` workspace, which is COPYed into the worker Docker image.
 *
 * Strategy: resolve the package.json path of `@trader/db` and join `seed/skills`.
 * This works in three modes:
 *   - local dev (tsx)  : node_modules/@trader/db symlinks to packages/db
 *   - local build      : packages/db/dist + packages/db/seed both exist
 *   - Docker worker    : /app/packages/db copied wholesale (incl. seed/)
 */
export declare function resolveSeedDir(): string;
/**
 * Minimal frontmatter parser. Accepts files starting with `---\n<key: value>\n---\n<body>`.
 * Only string values are supported; unquoted strings are trimmed of surrounding whitespace
 * and matching quotes.
 */
export declare function parseFrontmatter(raw: string): ParsedSkill;
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
export {};
