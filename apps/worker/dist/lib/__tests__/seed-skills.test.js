// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
// Pull in the real seed-helpers so parseFrontmatter / resolveSeedDir keep
// working when the SUT now imports them from "@trader/db" rather than defining
// them locally. We import from the package's *built* seed-helpers entry to
// avoid dragging schema.ts (which needs drizzle internals we don't mock).
vi.mock("@trader/db", async () => {
    const helpers = await vi.importActual("../../../../../packages/db/dist/seed-helpers.js");
    return {
        ...helpers,
        skills: {
            id: { name: "id" },
            name: { name: "name" },
        },
    };
});
vi.mock("drizzle-orm", () => ({
    eq: vi.fn((col, val) => ({ _type: "eq", col, val })),
}));
import { seedSkills, parseFrontmatter } from "../seed-skills.js";
function makeDbMock(state) {
    // select(...).from(...).where(...).limit(...) -> Promise<rows>
    const limit = vi.fn().mockImplementation(async () => []);
    const where = vi.fn().mockImplementation((cond) => {
        const lookupName = cond?.val;
        return {
            limit: vi.fn().mockImplementation(async () => state.existingNames.has(lookupName) ? [{ id: "existing-id" }] : []),
        };
    });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    // insert(...).values(...) -> Promise<void>
    const values = vi.fn().mockImplementation(async (row) => {
        state.inserted.push(row);
    });
    const insert = vi.fn().mockReturnValue({ values });
    return { select, insert, limit, where, from, values };
}
const VALID_MD = `---
name: candlestick
description: K 线形态识别
category: pattern
---

# Body

Some content.
`;
const VALID_MD_2 = `---
name: risk-checklist
description: 风险体检
category: risk
---

# Risk
`;
describe("parseFrontmatter", () => {
    it("parses name/description/category and returns body", () => {
        const parsed = parseFrontmatter(VALID_MD);
        expect(parsed.name).toBe("candlestick");
        expect(parsed.description).toBe("K 线形态识别");
        expect(parsed.category).toBe("pattern");
        expect(parsed.bodyMd).toContain("# Body");
    });
    it("strips matching surrounding quotes from values", () => {
        const md = `---\nname: foo\ndescription: "with: colon"\ncategory: x\n---\nbody\n`;
        const parsed = parseFrontmatter(md);
        expect(parsed.description).toBe("with: colon");
    });
    it("throws if frontmatter open marker missing", () => {
        expect(() => parseFrontmatter("name: foo\n---\nbody")).toThrow(/open marker/);
    });
    it("throws if frontmatter close marker missing", () => {
        expect(() => parseFrontmatter("---\nname: foo\nbody")).toThrow(/close marker/);
    });
    it("throws if name field missing", () => {
        const md = `---\ndescription: only desc\n---\nbody\n`;
        expect(() => parseFrontmatter(md)).toThrow(/name/);
    });
});
describe("seedSkills", () => {
    let state;
    let db;
    beforeEach(() => {
        state = { existingNames: new Set(), inserted: [] };
        db = makeDbMock(state);
    });
    it("inserts all skills on first run", async () => {
        const result = await seedSkills(db, {
            seedDir: "/seed",
            readDir: async () => ["candlestick.md", "risk-checklist.md"],
            readFileText: async (p) => p.endsWith("candlestick.md") ? VALID_MD : VALID_MD_2,
        });
        expect(result).toEqual({ inserted: 2, skipped: 0, failed: 0 });
        expect(state.inserted).toHaveLength(2);
        expect(state.inserted[0]).toMatchObject({
            name: "candlestick",
            source: "seed",
            category: "pattern",
        });
        expect(state.inserted[1]).toMatchObject({ name: "risk-checklist", source: "seed" });
    });
    it("skips existing skills by name", async () => {
        state.existingNames.add("candlestick");
        state.existingNames.add("risk-checklist");
        const result = await seedSkills(db, {
            seedDir: "/seed",
            readDir: async () => ["candlestick.md", "risk-checklist.md"],
            readFileText: async (p) => p.endsWith("candlestick.md") ? VALID_MD : VALID_MD_2,
        });
        expect(result).toEqual({ inserted: 0, skipped: 2, failed: 0 });
        expect(state.inserted).toHaveLength(0);
    });
    it("counts a single bad file as failed but continues with the rest", async () => {
        const logger = { warn: vi.fn(), error: vi.fn() };
        const result = await seedSkills(db, {
            seedDir: "/seed",
            readDir: async () => ["good.md", "bad.md", "another.md"],
            readFileText: async (p) => {
                if (p.endsWith("bad.md"))
                    throw new Error("disk on fire");
                if (p.endsWith("good.md"))
                    return VALID_MD;
                return VALID_MD_2;
            },
            logger,
        });
        expect(result.failed).toBe(1);
        expect(result.inserted).toBe(2);
        expect(result.skipped).toBe(0);
        expect(state.inserted.map((r) => r.name).sort()).toEqual([
            "candlestick",
            "risk-checklist",
        ]);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("bad.md"));
    });
    it("returns zeros without throwing if seed dir does not exist", async () => {
        const logger = { warn: vi.fn(), error: vi.fn() };
        const result = await seedSkills(db, {
            seedDir: "/nope",
            readDir: async () => {
                throw new Error("ENOENT");
            },
            logger,
        });
        expect(result).toEqual({ inserted: 0, skipped: 0, failed: 0 });
        expect(logger.warn).toHaveBeenCalled();
    });
    it("ignores non-markdown files in the seed dir", async () => {
        const result = await seedSkills(db, {
            seedDir: "/seed",
            readDir: async () => ["candlestick.md", "README.txt", ".DS_Store"],
            readFileText: async () => VALID_MD,
        });
        expect(result.inserted).toBe(1);
        expect(state.inserted).toHaveLength(1);
    });
});
