// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { PortfolioChatContext } from "./context";
import {
  buildAiChatMessages,
  formatPortfolioContext,
  sanitizeHistory,
} from "./prompt";

function makeContext(): PortfolioChatContext {
  return {
    generatedAt: "2026-07-08T10:00:00.000Z",
    strategies: [
      {
        id: "s1",
        name: "趋势策略",
        symbols: ["AAPL"],
        content: "跟随趋势，跌破均线减仓。",
      },
    ],
    positions: [
      {
        id: "p1",
        strategyId: "s1",
        strategyName: "趋势策略",
        symbol: "AAPL",
        referencePrice: 180,
        totalShares: 10,
        averageCost: 150,
        latestPrice: 190,
        unrealizedPnl: 400,
      },
    ],
    prices: [
      {
        symbol: "AAPL",
        latestClose: 190,
        recentCloses: [
          { date: "2026-07-08", close: 190 },
          { date: "2026-07-07", close: 188 },
        ],
      },
    ],
    memories: [
      {
        id: "m1",
        title: "AAPL 复盘",
        content: "偏好分批止盈。",
        label: "背景 / 复盘 / AAPL / 趋势策略",
        pinned: true,
        updatedAt: "2026-07-08T09:00:00.000Z",
      },
    ],
    limitations: ["价格来自系统已有快照，不保证实时。"],
  };
}

describe("sanitizeHistory", () => {
  it("keeps only user and assistant messages, trims content, and caps history", () => {
    const history = Array.from({ length: 14 }, (_, index) => ({
      role:
        index === 0
          ? "system"
          : (index % 2 === 0 ? "user" : "assistant"),
      content:
        index === 1
          ? " ".repeat(3)
          : index === 2
            ? "x".repeat(4005)
            : ` message-${index} `,
    }));

    const result = sanitizeHistory(history);

    expect(result).toHaveLength(12);
    expect(result.every((message) => message.role !== "system")).toBe(true);
    expect(result[0]).toEqual({ role: "user", content: "x".repeat(4000) });
    expect(result.at(-1)).toEqual({ role: "assistant", content: "message-13" });
  });
});

describe("formatPortfolioContext", () => {
  it("formats Chinese context with freshness, background, and priority notes", () => {
    const text = formatPortfolioContext(makeContext());

    expect(text).toContain("生成时间：2026-07-08 10:00:00 UTC");
    expect(text).toContain("策略");
    expect(text).toContain("未关闭持仓");
    expect(text).toContain("价格快照");
    expect(text).toContain("记忆背景");
    expect(text).toContain("不保证实时");
    expect(text).toContain("用户背景/偏好/复盘/笔记");
    expect(text).toContain("当前组合数据和价格快照优先于记忆");
    expect(text).toContain("数据限制");
  });
});

describe("buildAiChatMessages", () => {
  it("builds a Chinese text-only system prompt and appends the current question last", () => {
    const messages = buildAiChatMessages({
      contextText: formatPortfolioContext(makeContext()),
      question: "现在要不要加仓 AAPL？",
      history: [
        { role: "system", content: "should be filtered" },
        { role: "user", content: "前面聊过仓位" },
        { role: "assistant", content: "可以继续观察。" },
      ],
    });

    expect(messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("基于系统提供的数据回答"),
    });
    expect(messages[0]).toMatchObject({
      content: expect.stringContaining("明确买入、卖出、加仓、减仓、持有/观望"),
    });
    expect(messages[0]).toMatchObject({
      content: expect.stringContaining("不声称已执行交易"),
    });
    expect(messages[0]).toMatchObject({
      content: expect.stringContaining("不输出工具调用或结构化交易指令"),
    });
    expect(messages[1]).toMatchObject({
      role: "user",
      content: expect.stringContaining("以下是系统提供的组合上下文"),
    });
    expect(messages.slice(2, -1)).toEqual([
      { role: "user", content: "前面聊过仓位" },
      { role: "assistant", content: "可以继续观察。" },
    ]);
    expect(messages.at(-1)).toEqual({
      role: "user",
      content: "现在要不要加仓 AAPL？",
    });
  });
});
