export interface ParsedSkill {
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
 *
 * We resolve from the consumer's CWD/Node module path; in CJS we rely on
 * the bare-module specifier to find the package's installed location.
 */
export declare function resolveSeedDir(): string;
/**
 * Minimal frontmatter parser. Accepts files starting with `---\n<key: value>\n---\n<body>`.
 * Only string values are supported; unquoted strings are trimmed of surrounding whitespace
 * and matching quotes.
 */
export declare function parseFrontmatter(raw: string): ParsedSkill;
