// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPortfolioChatContext,
  type AiChatRepository,
  type OpenPositionCandidateRow,
} from "./context";

afterEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
  vi.unmock("@/lib/db");
  vi.unmock("drizzle-orm");
});

function makeRepo(args: {
  strategies?: Awaited<ReturnType<AiChatRepository["listStrategies"]>>;
  openPositions?: OpenPositionCandidateRow[];
  lots?: Awaited<ReturnType<AiChatRepository["listLotsForPositions"]>>;
  recentPrices?: Awaited<ReturnType<AiChatRepository["listRecentPrices"]>>;
  memories?: Awaited<ReturnType<AiChatRepository["listMemories"]>>;
  onListLotsForPositions?: (positionIds: string[]) => void;
}): AiChatRepository {
  return {
    listStrategies: async () => args.strategies ?? [],
    listOpenPositionCandidates: async ({ limit }) =>
      [...(args.openPositions ?? [])]
        .sort(
          (left, right) =>
            new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        )
        .slice(0, limit),
    listLotsForPositions: async (positionIds) => {
      args.onListLotsForPositions?.(positionIds);
      const positionIdsSet = new Set(positionIds);
      return (args.lots ?? []).filter((lot) => positionIdsSet.has(lot.positionId));
    },
    listRecentPrices: async (symbols) =>
      Object.fromEntries(symbols.map((symbol) => [symbol, args.recentPrices?.[symbol] ?? []])),
    listMemories: async () => args.memories ?? [],
  };
}

describe("buildPortfolioChatContext", () => {
  it("builds context from strategies, open positions, prices, lots, and memories", async () => {
    const repo = makeRepo({
      strategies: [
        {
          id: "s1",
          name: "趋势策略",
          symbols: ["AAPL"],
          content: "跟随趋势，跌破均线减仓。",
          createdAt: new Date("2026-06-01T00:00:00Z"),
          updatedAt: new Date("2026-07-07T00:00:00Z"),
        },
      ],
      openPositions: [
        {
          id: "p1",
          strategyId: "s1",
          symbol: "AAPL",
          referencePrice: "180.0000",
          updatedAt: new Date("2026-07-08T00:00:00Z"),
        },
      ],
      lots: [
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
      recentPrices: {
        AAPL: [
          { symbol: "AAPL", date: "2026-07-08", close: "190.0000" },
          { symbol: "AAPL", date: "2026-07-07", close: "188.0000" },
        ],
      },
      memories: [
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
    });

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

  it("records missing latest price limitations for returned open positions", async () => {
    const repo = makeRepo({
      openPositions: [
        {
          id: "open",
          strategyId: null,
          symbol: "MSFT",
          referencePrice: null,
          updatedAt: new Date("2026-07-08T00:00:00Z"),
        },
      ],
      lots: [
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
      recentPrices: {
        MSFT: [],
      },
    });

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
    expect(context.limitations).toContain("MSFT 缺少最新可用价格快照");
    expect(context.limitations).toContain("价格来自系统已有快照，不保证实时。");
  });

  it("caps memories at 12 items and 6000 chars while keeping pinned memories first", async () => {
    const long = "L".repeat(1500);
    const repo = makeRepo({
      strategies: [
        {
          id: "s1",
          name: "趋势策略",
          symbols: ["AAPL"],
          content: "趋势",
          createdAt: new Date("2026-06-01T00:00:00Z"),
          updatedAt: new Date("2026-07-08T00:00:00Z"),
        },
      ],
      openPositions: [
        {
          id: "p1",
          strategyId: "s1",
          symbol: "AAPL",
          referencePrice: null,
          updatedAt: new Date("2026-07-08T00:00:00Z"),
        },
      ],
      lots: [
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
      recentPrices: {
        AAPL: [{ symbol: "AAPL", date: "2026-07-08", close: "120" }],
      },
      memories:
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
    });

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

  it("requests lots only for bounded open positions and records the truncation limitation", async () => {
    const requestedPositionIds: string[][] = [];
    const repo = makeRepo({
      openPositions: Array.from({ length: 55 }, (_, index) => ({
          id: `p${String(index + 1).padStart(2, "0")}`,
          strategyId: null,
          symbol: `SYM${String(index + 1).padStart(2, "0")}`,
          referencePrice: null,
          updatedAt: new Date(Date.UTC(2026, 6, 1, 0, index)),
        })),
      lots:
        Array.from({ length: 55 }, (_, index) => ({
          id: `l${index + 1}`,
          positionId: `p${String(index + 1).padStart(2, "0")}`,
          type: "BUY",
          shares: "1",
          costPrice: "100",
          lotDate: "2026-07-01",
          notes: null,
          createdAt: new Date("2026-07-01T00:00:00Z"),
        })),
      recentPrices: Object.fromEntries(
        Array.from({ length: 55 }, (_, index) => {
          const symbol = `SYM${String(index + 1).padStart(2, "0")}`;
          return [symbol, [{ symbol, date: "2026-07-08", close: "101" }]];
        })
      ),
      onListLotsForPositions: (positionIds) => {
        requestedPositionIds.push(positionIds);
        expect(positionIds).not.toContain("p05");
        expect(positionIds).not.toContain("p01");
      },
    });

    const context = await buildPortfolioChatContext({
      repo,
      now: new Date("2026-07-08T10:00:00Z"),
    });

    expect(context.positions).toHaveLength(50);
    expect(requestedPositionIds).toEqual([
      Array.from({ length: 50 }, (_, index) => `p${String(55 - index).padStart(2, "0")}`),
    ]);
    expect(context.positions.map((position) => position.symbol)).not.toContain("SYM05");
    expect(context.positions.map((position) => position.symbol)).not.toContain("SYM01");
    expect(context.limitations).toContain("未关闭持仓过多，仅包含前 50 条持仓上下文。");
  });

  it("skips invalid price snapshots instead of rendering them as 0", async () => {
    const repo = makeRepo({
      openPositions: [
        {
          id: "p1",
          strategyId: null,
          symbol: "AAPL",
          referencePrice: null,
          updatedAt: new Date("2026-07-08T00:00:00Z"),
        },
      ],
      lots: [
        {
          id: "l1",
          positionId: "p1",
          type: "BUY",
          shares: "2",
          costPrice: "150",
          lotDate: "2026-07-01",
          notes: null,
          createdAt: new Date("2026-07-01T00:00:00Z"),
        },
      ],
      recentPrices: {
        AAPL: [
          { symbol: "AAPL", date: "2026-07-08", close: "bad" },
          { symbol: "AAPL", date: "2026-07-07", close: "190" },
        ],
      },
    });

    const context = await buildPortfolioChatContext({
      repo,
      now: new Date("2026-07-08T10:00:00Z"),
    });

    expect(context.prices).toEqual([
      {
        symbol: "AAPL",
        latestClose: 190,
        recentCloses: [{ date: "2026-07-07", close: 190 }],
      },
    ]);
    expect(context.positions[0]).toMatchObject({
      symbol: "AAPL",
      latestPrice: 190,
      unrealizedPnl: 80,
    });
    expect(context.limitations).toContain("AAPL 存在无效价格快照，已跳过部分价格数据。");
  });

  it("keeps old but relevant symbol and strategy memories ahead of recent unrelated memories", async () => {
    const repo = makeRepo({
      strategies: [
        {
          id: "s1",
          name: "趋势策略",
          symbols: ["AAPL"],
          content: "趋势",
          createdAt: new Date("2026-06-01T00:00:00Z"),
          updatedAt: new Date("2026-07-08T00:00:00Z"),
        },
      ],
      openPositions: [
        {
          id: "p1",
          strategyId: "s1",
          symbol: "AAPL",
          referencePrice: null,
          updatedAt: new Date("2026-07-08T00:00:00Z"),
        },
      ],
      lots: [
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
      recentPrices: {
        AAPL: [{ symbol: "AAPL", date: "2026-07-08", close: "120" }],
      },
      memories: [
        {
          id: "m-old-symbol",
          title: "老的 symbol 记忆",
          content: "这是较旧但与 AAPL 直接相关的记忆。",
          kind: "context",
          strategyId: null,
          symbol: "AAPL",
          tags: [],
          pinned: false,
          createdAt: new Date("2020-01-01T00:00:00Z"),
          updatedAt: new Date("2020-01-01T00:00:00Z"),
        },
        {
          id: "m-old-strategy",
          title: "老的 strategy 记忆",
          content: "这是较旧但与策略直接相关的记忆。",
          kind: "lesson",
          strategyId: "s1",
          symbol: null,
          tags: [],
          pinned: false,
          createdAt: new Date("2020-01-02T00:00:00Z"),
          updatedAt: new Date("2020-01-02T00:00:00Z"),
        },
        ...Array.from({ length: 12 }, (_, index) => ({
          id: `m-global-${index + 1}`,
          title: `最近全局记忆 ${index + 1}`,
          content: `近期但无关的全局记忆 ${index + 1}`,
          kind: "note" as const,
          strategyId: null,
          symbol: null,
          tags: [],
          pinned: false,
          createdAt: new Date(`2026-07-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
          updatedAt: new Date(`2026-07-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
        })),
      ],
    });

    const context = await buildPortfolioChatContext({
      repo,
      now: new Date("2026-07-08T10:00:00Z"),
    });

    expect(context.memories).toHaveLength(12);
    expect(context.memories.map((memory) => memory.id)).toEqual(
      expect.arrayContaining(["m-old-symbol", "m-old-strategy"])
    );
    expect(context.memories.map((memory) => memory.id)).not.toEqual(
      expect.arrayContaining(["m-global-1", "m-global-2", "m-global-3", "m-global-4", "m-global-5", "m-global-6", "m-global-7", "m-global-8", "m-global-9", "m-global-10", "m-global-11", "m-global-12"])
    );
  });

  it("merges pinned, symbol, strategy, and recent global memory buckets without duplicates", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "m-pinned",
          title: "置顶背景",
          content: "始终保留。",
          kind: "context",
          strategyId: null,
          symbol: null,
          tags: [],
          pinned: true,
          createdAt: new Date("2026-07-08T00:00:00Z"),
          updatedAt: new Date("2026-07-08T00:00:00Z"),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "m-symbol",
          title: "symbol 相关",
          content: "与 AAPL 相关。",
          kind: "lesson",
          strategyId: null,
          symbol: "AAPL",
          tags: [],
          pinned: false,
          createdAt: new Date("2020-01-01T00:00:00Z"),
          updatedAt: new Date("2020-01-01T00:00:00Z"),
        },
        {
          id: "m-overlap",
          title: "重叠记忆",
          content: "同时命中多个 bucket。",
          kind: "note",
          strategyId: "s1",
          symbol: "AAPL",
          tags: [],
          pinned: false,
          createdAt: new Date("2026-07-07T00:00:00Z"),
          updatedAt: new Date("2026-07-07T00:00:00Z"),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "m-strategy",
          title: "strategy 相关",
          content: "与策略相关。",
          kind: "lesson",
          strategyId: "s1",
          symbol: null,
          tags: [],
          pinned: false,
          createdAt: new Date("2020-01-02T00:00:00Z"),
          updatedAt: new Date("2020-01-02T00:00:00Z"),
        },
        {
          id: "m-overlap",
          title: "重叠记忆",
          content: "同时命中多个 bucket。",
          kind: "note",
          strategyId: "s1",
          symbol: "AAPL",
          tags: [],
          pinned: false,
          createdAt: new Date("2026-07-07T00:00:00Z"),
          updatedAt: new Date("2026-07-07T00:00:00Z"),
        },
      ])
      .mockResolvedValueOnce([
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
      ]);

    vi.doMock("@/lib/db", () => ({
      db: {
        query: {
          strategies: { findMany: vi.fn() },
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

    expect(findMany).toHaveBeenCalledTimes(4);
    expect(memories.map((memory) => memory.id)).toEqual([
      "m-pinned",
      "m-symbol",
      "m-overlap",
      "m-strategy",
      "m-global",
    ]);
  });

  it("limits open position candidate queries in the repository layer", async () => {
    const queryCalls: Array<{ limit?: number }> = [];

    vi.doMock("drizzle-orm", async () => {
      const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
      return {
        ...actual,
        desc: (value: unknown) => value,
        eq: vi.fn((_left: unknown, _right: unknown) => ({ type: "eq" })),
        sql: (() => ({ raw: "net_shares" })) as unknown as typeof actual.sql,
      };
    });

    vi.doMock("@/lib/db", () => ({
      db: {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            innerJoin: vi.fn(() => ({
              groupBy: vi.fn(() => ({
                having: vi.fn(() => ({
                  orderBy: vi.fn(() => ({
                    limit: vi.fn(async (value: number) => {
                      queryCalls.push({ limit: value });
                      return [];
                    }),
                  })),
                })),
              })),
            })),
          })),
        })),
        query: {
          strategies: { findMany: vi.fn() },
          positionLots: { findMany: vi.fn() },
          memories: { findMany: vi.fn() },
        },
      },
    }));

    const { createDbAiChatRepository } = await import("./context");
    const repo = createDbAiChatRepository();

    await repo.listOpenPositionCandidates({ limit: 51 });

    expect(queryCalls).toEqual([{ limit: 51 }]);
  });

  it("scopes lot queries to the requested position ids in the repository layer", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const inArrayMock = vi.fn((_column: unknown, positionIds: string[]) => ({ positionIds }));

    vi.doMock("drizzle-orm", async () => {
      const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
      return {
        ...actual,
        asc: (value: unknown) => value,
        inArray: inArrayMock,
      };
    });

    vi.doMock("@/lib/db", () => ({
      db: {
        query: {
          strategies: { findMany: vi.fn() },
          positionLots: { findMany },
          memories: { findMany: vi.fn() },
        },
      },
    }));

    const { createDbAiChatRepository } = await import("./context");
    const repo = createDbAiChatRepository();

    await repo.listLotsForPositions(["p1", "p2"]);

    expect(inArrayMock).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { positionIds: ["p1", "p2"] },
      })
    );
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
