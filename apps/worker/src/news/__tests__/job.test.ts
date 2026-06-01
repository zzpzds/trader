// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockTavilyFetch, mockSummarize } = vi.hoisted(() => ({
  mockTavilyFetch: vi.fn(),
  mockSummarize: vi.fn(),
}));

vi.mock("../tavily-fetch.js", () => ({ tavilyFetch: mockTavilyFetch }));
vi.mock("../summarize.js", () => ({ summarizeNews: mockSummarize }));
vi.mock("@trader/db", () => ({
  strategies: {},
  newsSummaries: {
    strategyId: { name: "strategy_id" },
    summaryDate: { name: "summary_date" },
  },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  lt: vi.fn((col, val) => ({ _type: "lt", col, val })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray) => ({ _type: "sql", text: strings.join("") })),
    {}
  ),
}));

import { runNewsJob } from "../job.js";

function makeDbMock(strategyRows: any[]) {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const valuesChain = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insertMock = vi.fn().mockReturnValue({ values: valuesChain });
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const deleteMock = vi.fn().mockReturnValue({ where: deleteWhere });

  const db = {
    query: {
      strategies: {
        findMany: vi.fn().mockResolvedValue(strategyRows),
      },
    },
    delete: deleteMock,
    insert: insertMock,
  } as any;

  return { db, insertMock, valuesChain, onConflictDoUpdate, deleteMock, deleteWhere };
}

describe("runNewsJob", () => {
  beforeEach(() => {
    mockTavilyFetch.mockReset();
    mockSummarize.mockReset();
    mockTavilyFetch.mockResolvedValue([]);
    mockSummarize.mockResolvedValue("摘要");
  });

  it("cleans up old rows but skips per-strategy work when no strategies exist", async () => {
    const { db, deleteMock, insertMock } = makeDbMock([]);

    await runNewsJob(db);

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(mockTavilyFetch).not.toHaveBeenCalled();
    expect(mockSummarize).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("queries Tavily once per symbol plus once per strategy name and upserts a single row with merged articles", async () => {
    mockTavilyFetch.mockImplementation(async (q: string) => {
      if (q === "ISRG stock news") {
        return [
          { title: "ISRG A", url: "https://a", content: "a" },
          { title: "Dup", url: "https://dup", content: "x" },
        ];
      }
      if (q === "ROBO stock news") {
        return [{ title: "ROBO B", url: "https://b", content: "b" }];
      }
      if (q === "T1 策略 investing news") {
        return [
          { title: "Strat C", url: "https://c", content: "c" },
          { title: "Dup again", url: "https://dup", content: "x" },
        ];
      }
      return [];
    });
    mockSummarize.mockResolvedValueOnce("今日 ISRG/ROBO 摘要");

    const { db, insertMock, valuesChain, onConflictDoUpdate } = makeDbMock([
      { id: "strat-1", name: "T1 策略", content: "买入规则", symbols: ["ISRG", "ROBO"] },
    ]);

    await runNewsJob(db);

    expect(mockTavilyFetch).toHaveBeenCalledTimes(3);
    expect(mockTavilyFetch).toHaveBeenCalledWith("ISRG stock news");
    expect(mockTavilyFetch).toHaveBeenCalledWith("ROBO stock news");
    expect(mockTavilyFetch).toHaveBeenCalledWith("T1 策略 investing news");

    expect(mockSummarize).toHaveBeenCalledTimes(1);
    const [, , passedArticles] = mockSummarize.mock.calls[0];
    expect(passedArticles).toHaveLength(4);
    expect(passedArticles.map((a: any) => a.url)).toEqual([
      "https://a",
      "https://dup",
      "https://b",
      "https://c",
    ]);

    expect(insertMock).toHaveBeenCalledTimes(1);
    const insertedValues = (valuesChain as any).mock.calls[0][0];
    expect(insertedValues.strategyId).toBe("strat-1");
    expect(insertedValues.content).toBe("今日 ISRG/ROBO 摘要");
    expect(insertedValues.summaryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(insertedValues.rawArticles).toHaveLength(4);

    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    const conflictArg = (onConflictDoUpdate as any).mock.calls[0][0];
    expect(conflictArg.target).toBeTruthy();
    expect(conflictArg.set).toBeTruthy();
  });

  it("continues other strategies when one strategy's Tavily call rejects", async () => {
    mockTavilyFetch.mockReset();
    mockTavilyFetch
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue([]);
    mockSummarize.mockResolvedValue("fallback summary");

    const { db, insertMock } = makeDbMock([
      { id: "strat-1", name: "T1", content: "x", symbols: ["ISRG"] },
    ]);

    await runNewsJob(db);

    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
