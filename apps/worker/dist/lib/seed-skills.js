import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import * as schema from "@trader/db";
import { resolveSeedDir, parseFrontmatter } from "@trader/db";
// Re-export helpers so existing imports `from "../seed-skills.js"` keep working
// (notably the worker test suite). New code should import directly from `@trader/db`.
export { resolveSeedDir, parseFrontmatter };
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
