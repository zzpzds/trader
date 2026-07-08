// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPortfolioChatContext, type AiChatRepository } from "./context";

afterEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
  vi.unmock("@/lib/db");
  vi.unmock("drizzle-orm");
});

describe("buildPortfolioChatContext", () => {
  it("builds context from strategies, open positions, prices, lots, and memories", async () => {
    const repo: AiChatRepository = {
      listStrategies: async () => [
        {
          id: "s1",
          name: "趋势策略",
          symbols: ["AAPL"],
          content: "跟随趋势，跌破均线减仓。",
          createdAt: new Date("2026-06-01T00:00:00Z"),
          updatedAt: new Date("2026-07-07T00:00:00Z"),
        },
      ],
      listPositions: async () => [
        {
          id: "p1",
          strategyId: "s1",
          symbol: "AAPL",
          referencePrice: "180.0000",
          createdAt: new Date("2026-07-01T00:00:00Z"),
          updatedAt: new Date("2026-07-08T00:00:00Z"),
        },
      ],
      listLots: async () => [
        {
          id: "l1",
          positionId: "p1",
          type: "BUY",
          shares: "10",
          costPrice: "150.0000",
          lotDate: "2026-07-01",
          notes: "初始建仓",
          createdAt: new Date("2026-07-01T00:00:00Z"),
        },
      ],
      listRecentPrices: async () => ({
        AAPL: [
          { symbol: "AAPL", date: "2026-07-08", close: "190.0000" },
          { symbol: "AAPL", date: "2026-07-07", close: "188.0000" },
        ],
      }),
      listMemories: async () => [
        {
          id: "m1",
          title: "AAPL 复盘",
          content: "偏好分批止盈。",
          kind: "lesson",
          strategyId: "s1",
          symbol: "AAPL",
          tags: ["仓位"],
          pinned: true,
          createdAt: new Date("2026-07-01T00:00:00Z"),
          updatedAt: new Date("2026-07-08T00:00:00Z"),
        },
      ],
    };

    const context = await buildPortfolioChatContext({
      repo,
      now: new Date("2026-07-08T10:00:00Z"),
    });

    expect(context.generatedAt).toBe("2026-07-08T10:00:00.000Z");
    expect(context.positions).toHaveLength(1);
    expect(context.positions[0]).toMatchObject({
      symbol: "AAPL",
      totalShares: 10,
      averageCost: 150,
      latestPrice: 190,
      unrealizedPnl: 400,
    });
    expect(context.prices).toEqual([
      {
        symbol: "AAPL",
        latestClose: 190,
        recentCloses: [
          { date: "2026-07-08", close: 190 },
          { date: "2026-07-07", close: 188 },
        ],
      },
    ]);
    expect(context.memories[0]?.label).toContain("背景");
    expect(context.limitations).toContain("价格来自系统已有快照，不保证实时。");
  });

  it("filters closed positions and records missing latest price limitations", async () => {
    const repo: AiChatRepository = {
      listStrategies: async () => [],
      listPositions: async () => [
        {
          id: "closed",
          strategyId: null,
          symbol: "AAPL",
          referencePrice: null,
          createdAt: new Date("2026-07-01T00:00:00Z"),
          updatedAt: new Date("2026-07-08T00:00:00Z"),
        },
        {
          id: "open",
          strategyId: null,
          symbol: "MSFT",
          referencePrice: null,
          createdAt: new Date("2026-07-01T00:00:00Z"),
          updatedAt: new Date("2026-07-08T00:00:00Z"),
        },
      ],
      listLots: async () => [
        {
          id: "l1",
          positionId: "closed",
          type: "BUY",
          shares: "5",
          costPrice: "100",
          lotDate: "2026-07-01",
          notes: null,
          createdAt: new Date("2026-07-01T00:00:00Z"),
        },
        {
          id: "l2",
          positionId: "closed",
          type: "SELL",
          shares: "5",
          costPrice: "110",
          lotDate: "2026-07-02",
          notes: null,
          createdAt: new Date("2026-07-02T00:00:00Z"),
        },
        {
          id: "l3",
          positionId: "open",
          type: "BUY",
          shares: "3",
          costPrice: "200",
          lotDate: "2026-07-01",
          notes: null,
          createdAt: new Date("2026-07-01T00:00:00Z"),
        },
      ],
      listRecentPrices: async () => ({
        AAPL: [{ symbol: "AAPL", date: "2026-07-08", close: "111" }],
        MSFT: [],
      }),
      listMemories: async () => [],
    };

    const context = await buildPortfolioChatContext({
      repo,
      now: new Date("2026-07-08T10:00:00Z"),
    });

    expect(context.positions).toHaveLength(1);
    expect(context.positions[0]).toMatchObject({
      symbol: "MSFT",
      totalShares: 3,
      latestPrice: null,
      unrealizedPnl: null,
    });
    expect(context.positions.find((position) => position.symbol === "AAPL")).toBeUndefined();
    expect(context.limitations).toContain("MSFT 缺少最新可用价格快照");
    expect(context.limitations).toContain("价格来自系统已有快照，不保证实时。");
  });

  it("caps memories at 12 items and 6000 chars while keeping pinned memories first", async () => {
    const long = "L".repeat(1500);
    const repo: AiChatRepository = {
      listStrategies: async () => [
        {
          id: "s1",
          name: "趋势策略",
          symbols: ["AAPL"],
          content: "趋势",
          createdAt: new Date("2026-06-01T00:00:00Z"),
          updatedAt: new Date("2026-07-08T00:00:00Z"),
        },
      ],
      listPositions: async () => [
        {
          id: "p1",
          strategyId: "s1",
          symbol: "AAPL",
          referencePrice: null,
          createdAt: new Date("2026-07-01T00:00:00Z"),
          updatedAt: new Date("2026-07-08T00:00:00Z"),
        },
      ],
      listLots: async () => [
        {
          id: "l1",
          positionId: "p1",
          type: "BUY",
          shares: "1",
          costPrice: "100",
          lotDate: "2026-07-01",
          notes: null,
          createdAt: new Date("2026-07-01T00:00:00Z"),
        },
      ],
      listRecentPrices: async () => ({
        AAPL: [{ symbol: "AAPL", date: "2026-07-08", close: "120" }],
      }),
      listMemories: async () =>
        Array.from({ length: 14 }, (_, index) => ({
          id: `m${index + 1}`,
          title: `memory-${index + 1}`,
          content: `${index < 4 ? long : `content-${index + 1}`}${index === 10 ? " AAPL" : ""}`,
          kind: (index % 2 === 0 ? "context" : "note") as "context" | "note",
          strategyId: index === 11 ? "s1" : null,
          symbol: index === 10 ? "AAPL" : null,
          tags: [],
          pinned: index === 8 || index === 12,
          createdAt: new Date(`2026-07-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
          updatedAt: new Date(`2026-07-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
        })),
    };

    const context = await buildPortfolioChatContext({
      repo,
      now: new Date("2026-07-08T10:00:00Z"),
    });

    expect(context.memories.length).toBeLessThanOrEqual(12);
    expect(context.memories[0]?.id).toBe("m13");
    expect(context.memories[1]?.id).toBe("m9");
    expect(
      context.memories.reduce((sum, memory) => sum + memory.content.length, 0)
    ).toBeLessThanOrEqual(6000);
  });

  it("includes recent global memories in repository candidates", async () => {
    const findMany = vi.fn(async (args?: { where?: unknown }) => {
      if (args?.where) {
        return [
          {
            id: "m-targeted",
            title: "策略复盘",
            content: "与策略直接相关。",
            kind: "lesson",
            strategyId: "s1",
            symbol: null,
            tags: [],
            pinned: false,
            createdAt: new Date("2026-07-07T00:00:00Z"),
            updatedAt: new Date("2026-07-07T00:00:00Z"),
          },
        ];
      }

      return [
        {
          id: "m-targeted",
          title: "策略复盘",
          content: "与策略直接相关。",
          kind: "lesson",
          strategyId: "s1",
          symbol: null,
          tags: [],
          pinned: false,
          createdAt: new Date("2026-07-07T00:00:00Z"),
          updatedAt: new Date("2026-07-07T00:00:00Z"),
        },
        {
          id: "m-global",
          title: "市场观察",
          content: "近期但未绑定 symbol 或 strategy。",
          kind: "context",
          strategyId: null,
          symbol: null,
          tags: [],
          pinned: false,
          createdAt: new Date("2026-07-08T00:00:00Z"),
          updatedAt: new Date("2026-07-08T00:00:00Z"),
        },
      ];
    });

    vi.doMock("@/lib/db", () => ({
      db: {
        query: {
          strategies: { findMany: vi.fn() },
          positions: { findMany: vi.fn() },
          positionLots: { findMany: vi.fn() },
          memories: { findMany },
        },
      },
    }));

    const { createDbAiChatRepository } = await import("./context");
    const repo = createDbAiChatRepository();
    const memories = await repo.listMemories({
      symbols: ["AAPL"],
      strategyIds: ["s1"],
    });

    expect(memories.map((memory) => memory.id)).toContain("m-global");
  });

  it("limits recent price queries to 10 rows per symbol in repository layer", async () => {
    const queryCalls: Array<{
      symbol: string;
      limit?: number;
    }> = [];

    vi.doMock("drizzle-orm", async () => {
      const actual = await vi.importActual<typeof import("drizzle-orm")>(
        "drizzle-orm"
      );
      return {
        ...actual,
        eq: (_column: unknown, symbol: string) => ({ symbol }),
        desc: (value: unknown) => value,
      };
    });

    vi.doMock("@/lib/db", () => ({
      db: {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn((condition: { symbol: string }) => {
              const call = { symbol: condition.symbol } as {
                symbol: string;
                limit?: number;
              };
              queryCalls.push(call);
              const orderedResult = {
                limit: vi.fn(async (value: number) => {
                  call.limit = value;
                  return [];
                }),
                then: (resolve: (value: []) => unknown) => resolve([]),
              };
              return {
                orderBy: vi.fn(() => orderedResult),
              };
            }),
          })),
        })),
        query: {
          strategies: { findMany: vi.fn() },
          positions: { findMany: vi.fn() },
          positionLots: { findMany: vi.fn() },
          memories: { findMany: vi.fn() },
        },
      },
    }));

    const { createDbAiChatRepository } = await import("./context");
    const repo = createDbAiChatRepository();

    await repo.listRecentPrices(["AAPL", "MSFT"]);

    expect(queryCalls).toEqual([
      { symbol: "AAPL", limit: 10 },
      { symbol: "MSFT", limit: 10 },
    ]);
  });
});
