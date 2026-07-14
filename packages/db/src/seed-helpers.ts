import path from "node:path";
import { existsSync } from "node:fs";

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
export function resolveSeedDir(): string {
  if (process.env.SEED_SKILLS_DIR) {
    return process.env.SEED_SKILLS_DIR;
  }

  // Use require.resolve so this works both when the consumer is CJS (worker
  // production build, web Next.js server runtime) and when this module is
  // bundled or transpiled. The function relies on Node's CJS resolver being
  // available at runtime (always true in Node ≥ 12).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const req: NodeJS.Require =
    typeof require === "function"
      ? require
      : // Fallback for ESM consumers: build a require relative to this file.
        // `module` is a Node built-in, but importing it dynamically keeps the
        // CJS code path simple.
        (eval("require") as NodeJS.Require);
  const pkgJsonPath = req.resolve("@trader/db/package.json");
  if (typeof pkgJsonPath === "string") {
    return path.join(path.dirname(pkgJsonPath), "seed", "skills");
  }

  for (const candidate of [
    path.join(process.cwd(), "packages", "db", "seed", "skills"),
    "/app/packages/db/seed/skills",
  ]) {
    if (existsSync(candidate)) return candidate;
  }

  return path.join(process.cwd(), "packages", "db", "seed", "skills");
}

/**
 * Minimal frontmatter parser. Accepts files starting with `---\n<key: value>\n---\n<body>`.
 * Only string values are supported; unquoted strings are trimmed of surrounding whitespace
 * and matching quotes.
 */
export function parseFrontmatter(raw: string): ParsedSkill {
  if (!raw.startsWith("---")) {
    throw new Error("missing frontmatter open marker");
  }
  // find the closing `---` after the first one
  const afterOpen = raw.slice(3);
  const lf = afterOpen.indexOf("\n");
  if (lf === -1) throw new Error("malformed frontmatter");
  const closeIdx = afterOpen.indexOf("\n---", lf);
  if (closeIdx === -1) throw new Error("missing frontmatter close marker");

  const fmBlock = afterOpen.slice(lf + 1, closeIdx);
  // body starts after `\n---` then a newline
  const bodyStart = closeIdx + "\n---".length;
  let body = afterOpen.slice(bodyStart);
  if (body.startsWith("\n")) body = body.slice(1);

  const fm: Record<string, string> = {};
  for (const line of fmBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fm[key] = value;
  }

  const name = fm.name;
  if (!name) throw new Error("frontmatter missing `name`");
  const description = fm.description ?? null;
  const category = fm.category ?? null;

  return { name, description, category, bodyMd: body.trimEnd() + "\n" };
}
