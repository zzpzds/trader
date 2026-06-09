import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import * as schema from "@trader/db";
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
export function resolveSeedDir() {
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve("@trader/db/package.json");
    return path.join(path.dirname(pkgJsonPath), "seed", "skills");
}
/**
 * Minimal frontmatter parser. Accepts files starting with `---\n<key: value>\n---\n<body>`.
 * Only string values are supported; unquoted strings are trimmed of surrounding whitespace
 * and matching quotes.
 */
export function parseFrontmatter(raw) {
    if (!raw.startsWith("---")) {
        throw new Error("missing frontmatter open marker");
    }
    // find the closing `---` after the first one
    const afterOpen = raw.slice(3);
    const lf = afterOpen.indexOf("\n");
    if (lf === -1)
        throw new Error("malformed frontmatter");
    const closeIdx = afterOpen.indexOf("\n---", lf);
    if (closeIdx === -1)
        throw new Error("missing frontmatter close marker");
    const fmBlock = afterOpen.slice(lf + 1, closeIdx);
    // body starts after `\n---` then a newline
    const bodyStart = closeIdx + "\n---".length;
    let body = afterOpen.slice(bodyStart);
    if (body.startsWith("\n"))
        body = body.slice(1);
    const fm = {};
    for (const line of fmBlock.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx === -1)
            continue;
        const key = trimmed.slice(0, colonIdx).trim();
        let value = trimmed.slice(colonIdx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        fm[key] = value;
    }
    const name = fm.name;
    if (!name)
        throw new Error("frontmatter missing `name`");
    const description = fm.description ?? null;
    const category = fm.category ?? null;
    return { name, description, category, bodyMd: body.trimEnd() + "\n" };
}
/**
 * Idempotent seed: scan packages/db/seed/skills/*.md, parse, insert any that
 * don't yet exist by `name`. Failures on individual files are logged and counted
 * but do not abort the rest of the run.
 */
export async function seedSkills(db, deps = {}) {
    const seedDir = deps.seedDir ?? resolveSeedDir();
    const readDir = deps.readDir ?? ((d) => readdir(d));
    const readFileText = deps.readFileText ?? ((p) => readFile(p, "utf8"));
    const logger = deps.logger ?? console;
    let entries;
    try {
        entries = await readDir(seedDir);
    }
    catch (err) {
        logger.warn(`[seed-skills] cannot read seed dir ${seedDir}: ${err.message}`);
        return { inserted: 0, skipped: 0, failed: 0 };
    }
    const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();
    let inserted = 0;
    let skipped = 0;
    let failed = 0;
    for (const fname of mdFiles) {
        const fullPath = path.join(seedDir, fname);
        try {
            const raw = await readFileText(fullPath);
            const parsed = parseFrontmatter(raw);
            const existing = await db
                .select({ id: schema.skills.id })
                .from(schema.skills)
                .where(eq(schema.skills.name, parsed.name))
                .limit(1);
            if (existing.length > 0) {
                skipped += 1;
                continue;
            }
            await db.insert(schema.skills).values({
                name: parsed.name,
                description: parsed.description,
                category: parsed.category,
                bodyMd: parsed.bodyMd,
                source: "seed",
            });
            inserted += 1;
        }
        catch (err) {
            failed += 1;
            logger.error(`[seed-skills] failed to seed ${fname}: ${err.message}`);
        }
    }
    return { inserted, skipped, failed };
}
