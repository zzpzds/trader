// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- Mock @/lib/db before importing skills.ts ----------
const { mockTx, mockDb } = vi.hoisted(() => {
  const mockTx = {
    delete: vi.fn(),
    insert: vi.fn(),
  };
  const mockDb = {
    query: {
      skills: { findFirst: vi.fn(), findMany: vi.fn() },
      strategySkills: { findMany: vi.fn() },
      monitoringRuns: { findFirst: vi.fn() },
    },
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(async (cb: (tx: typeof mockTx) => Promise<void>) => {
      await cb(mockTx);
    }),
  };
  return { mockTx, mockDb };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));

import {
  ConflictError,
  NotFoundError,
  SKILL_BODY_MAX,
  STRATEGY_SKILLS_MAX,
  ValidationError,
  createSkill,
  getSeedManifest,
  getStrategyLatestSuggestedSkills,
  importSeedSkill,
  setStrategySkills,
  validateSkillBody,
  validateSkillCategory,
  validateSkillIdsList,
  validateSkillName,
  validateSkillDescription,
} from "../skills";
import { mergeWithCap } from "../skills-ui";

describe("validateSkillBody", () => {
  it("accepts a normal markdown body", () => {
    expect(validateSkillBody("hello world")).toBeNull();
  });

  it("accepts exactly SKILL_BODY_MAX characters", () => {
    const body = "a".repeat(SKILL_BODY_MAX);
    expect(validateSkillBody(body)).toBeNull();
  });

  it("rejects > SKILL_BODY_MAX characters", () => {
    const body = "a".repeat(SKILL_BODY_MAX + 1);
    const err = validateSkillBody(body);
    expect(err).not.toBeNull();
    expect(err).toMatch(/6000/);
    expect(err).toMatch(/6001/);
  });

  it("rejects non-string", () => {
    expect(validateSkillBody(undefined)).toMatch(/string/);
    expect(validateSkillBody(123)).toMatch(/string/);
    expect(validateSkillBody(null)).toMatch(/string/);
  });

  it("rejects empty / whitespace-only body", () => {
    expect(validateSkillBody("")).toMatch(/required/);
    expect(validateSkillBody("   \n\t")).toMatch(/required/);
  });
});

describe("validateSkillName", () => {
  it("accepts normal names", () => {
    expect(validateSkillName("breakout-pattern")).toBeNull();
    expect(validateSkillName("DCF Valuation")).toBeNull();
  });

  it("rejects non-string", () => {
    expect(validateSkillName(undefined)).toMatch(/string/);
    expect(validateSkillName(42)).toMatch(/string/);
  });

  it("rejects empty after trim", () => {
    expect(validateSkillName("")).toMatch(/required/);
    expect(validateSkillName("   ")).toMatch(/required/);
  });

  it("rejects > 200 chars", () => {
    expect(validateSkillName("a".repeat(201))).toMatch(/200/);
  });
});

describe("validateSkillDescription", () => {
  it("accepts undefined / null", () => {
    expect(validateSkillDescription(undefined)).toBeNull();
    expect(validateSkillDescription(null)).toBeNull();
  });

  it("accepts strings up to 500 chars", () => {
    expect(validateSkillDescription("short")).toBeNull();
    expect(validateSkillDescription("a".repeat(500))).toBeNull();
  });

  it("rejects > 500 chars", () => {
    expect(validateSkillDescription("a".repeat(501))).toMatch(/500/);
  });
});

describe("validateSkillCategory", () => {
  it("accepts undefined or null (optional)", () => {
    expect(validateSkillCategory(undefined)).toBeNull();
    expect(validateSkillCategory(null)).toBeNull();
  });

  it("accepts each enum value", () => {
    for (const cat of [
      "pattern",
      "risk",
      "valuation",
      "behavioral",
      "macro",
      "other",
    ]) {
      expect(validateSkillCategory(cat)).toBeNull();
    }
  });

  it("rejects unknown category", () => {
    expect(validateSkillCategory("bogus")).toMatch(/one of/);
  });

  it("rejects non-string", () => {
    expect(validateSkillCategory(123)).toMatch(/string/);
  });
});

describe("validateSkillIdsList", () => {
  it("accepts empty array (clears all relations)", () => {
    expect(validateSkillIdsList([])).toBeNull();
  });

  it("accepts up to STRATEGY_SKILLS_MAX entries", () => {
    expect(validateSkillIdsList(["a"])).toBeNull();
    expect(validateSkillIdsList(["a", "b"])).toBeNull();
    expect(validateSkillIdsList(["a", "b", "c"])).toBeNull();
  });

  it("rejects > STRATEGY_SKILLS_MAX entries", () => {
    const err = validateSkillIdsList(["a", "b", "c", "d"]);
    expect(err).not.toBeNull();
    expect(err).toMatch(new RegExp(String(STRATEGY_SKILLS_MAX)));
  });

  it("rejects non-array", () => {
    expect(validateSkillIdsList("a")).toMatch(/array/);
    expect(validateSkillIdsList(undefined)).toMatch(/array/);
    expect(validateSkillIdsList({ 0: "a" })).toMatch(/array/);
  });

  it("rejects non-string entries", () => {
    expect(validateSkillIdsList(["a", 1])).toMatch(/string/);
    expect(validateSkillIdsList([null])).toMatch(/string/);
  });

  it("rejects empty-string entries", () => {
    expect(validateSkillIdsList(["a", ""])).toMatch(/string/);
  });

  it("rejects duplicates", () => {
    expect(validateSkillIdsList(["a", "b", "a"])).toMatch(/duplicate/);
  });
});

// ---------- DB-touching tests with mocked db ----------

describe("createSkill (mocked db)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws ConflictError when name already exists (pre-check)", async () => {
    mockDb.query.skills.findFirst.mockResolvedValueOnce({ id: "existing-id" });
    await expect(
      createSkill({ name: "dup", bodyMd: "body" })
    ).rejects.toBeInstanceOf(ConflictError);
    // insert should never have been called
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("throws ConflictError on UNIQUE violation (postgres 23505) race", async () => {
    mockDb.query.skills.findFirst.mockResolvedValueOnce(undefined);
    const insertChain = {
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockRejectedValueOnce(
        Object.assign(new Error("dup"), { code: "23505" })
      ),
    };
    mockDb.insert.mockReturnValueOnce(insertChain);

    await expect(
      createSkill({ name: "race", bodyMd: "body" })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("throws ValidationError on body too long", async () => {
    await expect(
      createSkill({ name: "x", bodyMd: "a".repeat(SKILL_BODY_MAX + 1) })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockDb.query.skills.findFirst).not.toHaveBeenCalled();
  });
});

describe("setStrategySkills (mocked db)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects > STRATEGY_SKILLS_MAX with ValidationError before any DB call", async () => {
    await expect(
      setStrategySkills("strat-1", ["a", "b", "c", "d"])
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("delete-then-insert in transaction (replace semantics)", async () => {
    const deleteChain = { where: vi.fn().mockResolvedValue(undefined) };
    const insertChain = { values: vi.fn().mockResolvedValue(undefined) };
    mockTx.delete.mockReturnValue(deleteChain);
    mockTx.insert.mockReturnValue(insertChain);

    await setStrategySkills("strat-1", ["sk-1", "sk-2"]);

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.delete).toHaveBeenCalledTimes(1);
    expect(mockTx.insert).toHaveBeenCalledTimes(1);
    expect(insertChain.values).toHaveBeenCalledWith([
      { strategyId: "strat-1", skillId: "sk-1" },
      { strategyId: "strat-1", skillId: "sk-2" },
    ]);
  });

  it("with empty skillIds: deletes but does not insert", async () => {
    const deleteChain = { where: vi.fn().mockResolvedValue(undefined) };
    mockTx.delete.mockReturnValue(deleteChain);

    await setStrategySkills("strat-1", []);

    expect(mockTx.delete).toHaveBeenCalledTimes(1);
    expect(mockTx.insert).not.toHaveBeenCalled();
  });
});

// ---------- Seed manifest / import (mocked db + injected fs) ----------

import { createHash } from "node:crypto";

const SEED_CANDLESTICK = `---
name: candlestick
description: K 线形态识别
category: pattern
---

# Body
v1
`;

const SEED_RISK = `---
name: risk-checklist
description: 风险体检
category: risk
---

# Risk
v1
`;

// What parseFrontmatter would return for SEED_CANDLESTICK's bodyMd: it trims
// trailing whitespace and re-appends a single newline.
function bodyOf(raw: string): string {
  const after = raw.split("\n---\n")[1] ?? "";
  return after.trimEnd() + "\n";
}

function makeFsDeps(files: Record<string, string>) {
  return {
    seedDir: "/seed",
    readDir: vi.fn(async () => Object.keys(files)),
    readFileText: vi.fn(async (p: string) => {
      const fname = p.split("/").pop()!;
      const raw = files[fname];
      if (raw === undefined) throw new Error(`ENOENT: ${p}`);
      return raw;
    }),
    logger: { warn: vi.fn(), error: vi.fn() },
  };
}

describe("getSeedManifest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 'missing' when DB has no row for the seed name", async () => {
    const fs = makeFsDeps({ "candlestick.md": SEED_CANDLESTICK });
    mockDb.query.skills.findMany.mockResolvedValueOnce([]);

    const manifest = await getSeedManifest(fs);

    expect(manifest).toHaveLength(1);
    expect(manifest[0].name).toBe("candlestick");
    expect(manifest[0].status).toBe("missing");
    expect(manifest[0].source).toBeNull();
    expect(manifest[0].currentBodyHash).toBe(
      createHash("sha256").update(bodyOf(SEED_CANDLESTICK)).digest("hex")
    );
  });

  it("returns 'in-sync' when DB body matches repo body", async () => {
    const fs = makeFsDeps({ "candlestick.md": SEED_CANDLESTICK });
    mockDb.query.skills.findMany.mockResolvedValueOnce([
      {
        name: "candlestick",
        source: "seed",
        bodyMd: bodyOf(SEED_CANDLESTICK),
      },
    ]);

    const [entry] = await getSeedManifest(fs);
    expect(entry.status).toBe("in-sync");
    expect(entry.source).toBe("seed");
  });

  it("returns 'edited' when DB body differs", async () => {
    const fs = makeFsDeps({ "candlestick.md": SEED_CANDLESTICK });
    mockDb.query.skills.findMany.mockResolvedValueOnce([
      {
        name: "candlestick",
        source: "user",
        bodyMd: "# user-modified body\n",
      },
    ]);

    const [entry] = await getSeedManifest(fs);
    expect(entry.status).toBe("edited");
    expect(entry.source).toBe("user");
  });

  it("skips malformed seed files without crashing", async () => {
    const fs = makeFsDeps({
      "candlestick.md": SEED_CANDLESTICK,
      "broken.md": "no frontmatter here at all",
    });
    mockDb.query.skills.findMany.mockResolvedValueOnce([]);

    const manifest = await getSeedManifest(fs);
    expect(manifest.map((e) => e.name)).toEqual(["candlestick"]);
    expect(fs.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("broken.md")
    );
  });
});

describe("importSeedSkill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mode=create inserts a new row with source='seed'", async () => {
    const fs = makeFsDeps({ "candlestick.md": SEED_CANDLESTICK });
    mockDb.query.skills.findFirst.mockResolvedValueOnce(undefined);
    const insertChain = {
      values: vi.fn().mockReturnThis(),
      returning: vi
        .fn()
        .mockResolvedValueOnce([{ id: "new-id", name: "candlestick" }]),
    };
    mockDb.insert.mockReturnValueOnce(insertChain);

    const row = await importSeedSkill(
      { name: "candlestick", mode: "create" },
      fs
    );

    expect(row).toMatchObject({ id: "new-id", name: "candlestick" });
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "candlestick",
        source: "seed",
        category: "pattern",
      })
    );
  });

  it("mode=create throws ConflictError when DB already has the name", async () => {
    const fs = makeFsDeps({ "candlestick.md": SEED_CANDLESTICK });
    mockDb.query.skills.findFirst.mockResolvedValueOnce({
      id: "existing-id",
      source: "seed",
    });

    await expect(
      importSeedSkill({ name: "candlestick", mode: "create" }, fs)
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("mode=overwrite-seed updates the row when source='seed'", async () => {
    const fs = makeFsDeps({ "candlestick.md": SEED_CANDLESTICK });
    mockDb.query.skills.findFirst.mockResolvedValueOnce({
      id: "existing-id",
      source: "seed",
    });
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi
        .fn()
        .mockResolvedValueOnce([{ id: "existing-id", name: "candlestick" }]),
    };
    mockDb.update.mockReturnValueOnce(updateChain);

    const row = await importSeedSkill(
      { name: "candlestick", mode: "overwrite-seed" },
      fs
    );

    expect(row).toMatchObject({ id: "existing-id" });
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyMd: bodyOf(SEED_CANDLESTICK),
        source: "seed",
        category: "pattern",
      })
    );
  });

  it("mode=overwrite-seed throws ConflictError when source='user'", async () => {
    const fs = makeFsDeps({ "candlestick.md": SEED_CANDLESTICK });
    mockDb.query.skills.findFirst.mockResolvedValueOnce({
      id: "existing-id",
      source: "user",
    });

    await expect(
      importSeedSkill({ name: "candlestick", mode: "overwrite-seed" }, fs)
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("mode=duplicate inserts with `<name>-vibe-trading` when free", async () => {
    const fs = makeFsDeps({ "candlestick.md": SEED_CANDLESTICK });
    mockDb.query.skills.findFirst.mockResolvedValueOnce({
      id: "existing-id",
      source: "user",
    });
    // findMany for free-name search returns no taken candidates
    mockDb.query.skills.findMany.mockResolvedValueOnce([]);
    const insertChain = {
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValueOnce([
        { id: "dup-id", name: "candlestick-vibe-trading" },
      ]),
    };
    mockDb.insert.mockReturnValueOnce(insertChain);

    const row = await importSeedSkill(
      { name: "candlestick", mode: "duplicate" },
      fs
    );

    expect(row.name).toBe("candlestick-vibe-trading");
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "candlestick-vibe-trading",
        source: "seed",
      })
    );
  });

  it("mode=duplicate increments suffix when first candidate is taken", async () => {
    const fs = makeFsDeps({ "candlestick.md": SEED_CANDLESTICK });
    mockDb.query.skills.findFirst.mockResolvedValueOnce(undefined);
    mockDb.query.skills.findMany.mockResolvedValueOnce([
      { name: "candlestick-vibe-trading" },
      { name: "candlestick-vibe-trading-2" },
    ]);
    const insertChain = {
      values: vi.fn().mockReturnThis(),
      returning: vi
        .fn()
        .mockResolvedValueOnce([
          { id: "dup-3", name: "candlestick-vibe-trading-3" },
        ]),
    };
    mockDb.insert.mockReturnValueOnce(insertChain);

    const row = await importSeedSkill(
      { name: "candlestick", mode: "duplicate" },
      fs
    );

    expect(row.name).toBe("candlestick-vibe-trading-3");
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ name: "candlestick-vibe-trading-3" })
    );
  });

  it("throws NotFoundError when the seed file is missing", async () => {
    const fs = makeFsDeps({ "risk-checklist.md": SEED_RISK });
    await expect(
      importSeedSkill({ name: "candlestick", mode: "create" }, fs)
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("getStrategyLatestSuggestedSkills", () => {
  beforeEach(() => {
    mockDb.query.monitoringRuns.findFirst.mockReset();
    mockDb.query.skills.findMany.mockReset();
  });

  it("returns [] when no completed monitoring run exists", async () => {
    mockDb.query.monitoringRuns.findFirst.mockResolvedValueOnce(undefined);
    const result = await getStrategyLatestSuggestedSkills("strat-1");
    expect(result).toEqual([]);
    expect(mockDb.query.skills.findMany).not.toHaveBeenCalled();
  });

  it("returns [] when latest completed run has no suggestedSkills", async () => {
    mockDb.query.monitoringRuns.findFirst.mockResolvedValueOnce({
      suggestedSkills: null,
    });
    const result = await getStrategyLatestSuggestedSkills("strat-1");
    expect(result).toEqual([]);
    expect(mockDb.query.skills.findMany).not.toHaveBeenCalled();
  });

  it("returns [] when suggestedSkills is an empty array", async () => {
    mockDb.query.monitoringRuns.findFirst.mockResolvedValueOnce({
      suggestedSkills: [],
    });
    const result = await getStrategyLatestSuggestedSkills("strat-1");
    expect(result).toEqual([]);
    expect(mockDb.query.skills.findMany).not.toHaveBeenCalled();
  });

  it("preserves the LLM order when all names exist in skills table", async () => {
    mockDb.query.monitoringRuns.findFirst.mockResolvedValueOnce({
      suggestedSkills: ["risk-checklist", "breakout-pattern", "dcf"],
    });
    mockDb.query.skills.findMany.mockResolvedValueOnce([
      { name: "breakout-pattern" },
      { name: "dcf" },
      { name: "risk-checklist" },
    ]);
    const result = await getStrategyLatestSuggestedSkills("strat-1");
    expect(result).toEqual(["risk-checklist", "breakout-pattern", "dcf"]);
  });

  it("filters out names that no longer exist in skills table", async () => {
    mockDb.query.monitoringRuns.findFirst.mockResolvedValueOnce({
      suggestedSkills: ["risk-checklist", "deleted-skill", "dcf"],
    });
    mockDb.query.skills.findMany.mockResolvedValueOnce([
      { name: "risk-checklist" },
      { name: "dcf" },
    ]);
    const result = await getStrategyLatestSuggestedSkills("strat-1");
    expect(result).toEqual(["risk-checklist", "dcf"]);
  });
});

describe("mergeWithCap", () => {
  it("returns currentIds unchanged when suggestedIds are empty", () => {
    expect(mergeWithCap(["a", "b"], [], 3)).toEqual(["a", "b"]);
  });

  it("appends new suggestions in order until cap is reached", () => {
    expect(mergeWithCap(["a"], ["b", "c", "d"], 3)).toEqual(["a", "b", "c"]);
  });

  it("does not duplicate suggestions already in currentIds", () => {
    expect(mergeWithCap(["a", "b"], ["b", "c"], 3)).toEqual(["a", "b", "c"]);
  });

  it("respects the cap when currentIds is already at the limit", () => {
    expect(mergeWithCap(["a", "b", "c"], ["d"], 3)).toEqual(["a", "b", "c"]);
  });

  it("truncates currentIds when they exceed the cap (defensive)", () => {
    expect(mergeWithCap(["a", "b", "c", "d"], ["e"], 3)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

// ---------- Documentation-style note for CASCADE / UNIQUE behaviors ----------
// `name` UNIQUE constraint and `strategy_skills` ON DELETE CASCADE are enforced
// at the DB schema level (see packages/db/src/schema.ts). The application-layer
// validators above cover the request-shape contract; the application throws
// ConflictError when the DB rejects a duplicate name (race-safe path tested
// via mocked 23505 above). CASCADE delete is exercised by integration smoke
// tests / schema tests in @trader/db.
