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
  SKILL_BODY_MAX,
  STRATEGY_SKILLS_MAX,
  ValidationError,
  createSkill,
  setStrategySkills,
  validateSkillBody,
  validateSkillCategory,
  validateSkillIdsList,
  validateSkillName,
  validateSkillDescription,
} from "../skills";

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

// ---------- Documentation-style note for CASCADE / UNIQUE behaviors ----------
// `name` UNIQUE constraint and `strategy_skills` ON DELETE CASCADE are enforced
// at the DB schema level (see packages/db/src/schema.ts). The application-layer
// validators above cover the request-shape contract; the application throws
// ConflictError when the DB rejects a duplicate name (race-safe path tested
// via mocked 23505 above). CASCADE delete is exercised by integration smoke
// tests / schema tests in @trader/db.
describe("schema-level invariants (documentation)", () => {
  it.skip("name UNIQUE: enforced by schema.ts skills.name.unique()", () => {});
  it.skip("strategy_skills CASCADE: enforced by schema.ts onDelete: 'cascade'", () => {});
});
