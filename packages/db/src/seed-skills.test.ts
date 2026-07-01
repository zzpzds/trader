import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "./seed-helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.join(__dirname, "..", "seed", "skills");

const ALLOWED_CATEGORIES = new Set([
  "pattern",
  "risk",
  "valuation",
  "behavioral",
  "macro",
  "fundamental",
  "process",
  "other",
]);

const BODY_MAX = 6000;

const ADAPTED_SEED_CATEGORIES: Record<string, string> = {
  "quality-screen": "fundamental",
  "investment-checklist": "fundamental",
  "thesis-tracker": "process",
  "portfolio-review": "process",
  "earnings-review": "fundamental",
  "news-pulse": "fundamental",
  "management-deep-dive": "fundamental",
  "dyp-ask": "behavioral",
};

const FORBIDDEN_ADAPTED_PATTERNS = [
  /\$ARGUMENTS/,
  /\bTask\b/,
  /并行\s*Agent/,
  /parallel\s+Agent/i,
  /python3\s+~\/ai-berkshire/,
  /reports\//,
];

function readSeedFiles(): { fname: string; raw: string }[] {
  return readdirSync(SEED_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((fname) => ({
      fname,
      raw: readFileSync(path.join(SEED_DIR, fname), "utf8"),
    }));
}

describe("seed/skills/*.md", () => {
  const files = readSeedFiles();

  it("contains at least one seed file", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("$fname parses cleanly", ({ fname, raw }) => {
    const parsed = parseFrontmatter(raw);
    const stem = fname.replace(/\.md$/, "");
    expect(parsed.name).toBe(stem);
    expect(parsed.description).toBeTruthy();
    expect((parsed.description ?? "").length).toBeGreaterThan(0);
    expect(parsed.category).not.toBeNull();
    expect(ALLOWED_CATEGORIES.has(parsed.category as string)).toBe(true);
    expect(parsed.bodyMd.length).toBeLessThanOrEqual(BODY_MAX);
  });

  it("has globally unique names", () => {
    const names = files.map(({ raw }) => parseFrontmatter(raw).name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("contains all ai-berkshire adapted seed files with expected categories", () => {
    const parsedByName = new Map(
      files.map(({ raw }) => {
        const parsed = parseFrontmatter(raw);
        return [parsed.name, parsed];
      })
    );

    for (const [name, category] of Object.entries(ADAPTED_SEED_CATEGORIES)) {
      expect(parsedByName.has(name)).toBe(true);
      expect(parsedByName.get(name)?.category).toBe(category);
    }
  });

  it("adapts ai-berkshire skills without slash-command workflow tokens", () => {
    const adaptedFiles = files.filter(({ fname }) =>
      Object.prototype.hasOwnProperty.call(
        ADAPTED_SEED_CATEGORIES,
        fname.replace(/\.md$/, "")
      )
    );

    expect(adaptedFiles.length).toBe(
      Object.keys(ADAPTED_SEED_CATEGORIES).length
    );

    for (const { fname, raw } of adaptedFiles) {
      const parsed = parseFrontmatter(raw);
      expect(parsed.bodyMd).toContain(
        `改写自 ai-berkshire/skills/${fname}`
      );
      for (const pattern of FORBIDDEN_ADAPTED_PATTERNS) {
        expect(parsed.bodyMd).not.toMatch(pattern);
      }
    }
  });
});
