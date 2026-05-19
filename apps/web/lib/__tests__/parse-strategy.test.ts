// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(() => ({
    messages: { create: mockCreate },
  })),
}));

import { parseStrategyScript } from "../parse-strategy";

function makeToolUseResponse(input: { name: string; symbols: string[]; content: string }) {
  return {
    content: [
      {
        type: "tool_use",
        id: "toolu_123",
        name: "parse_strategy",
        input,
      },
    ],
  };
}

describe("parseStrategyScript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed strategy when LLM returns tool_use", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse({
        name: "QQQ Momentum",
        symbols: ["QQQ", "SPY"],
        content: "## Strategy Overview\nA momentum strategy...",
      })
    );

    const result = await parseStrategyScript("some python code");

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      name: "QQQ Momentum",
      symbols: ["QQQ", "SPY"],
      content: "## Strategy Overview\nA momentum strategy...",
    });
  });

  it("throws when LLM does not return tool_use", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "I analyzed the script..." }],
    });

    await expect(parseStrategyScript("code")).rejects.toThrow(
      "LLM 未返回结构化解析结果"
    );
  });

  it("defaults symbols to empty array if missing", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse({
        name: "Test",
        symbols: undefined as any,
        content: "desc",
      })
    );

    const result = await parseStrategyScript("code");

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.symbols).toEqual([]);
  });

  it("defaults name and content to empty string if missing", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse({
        name: undefined as any,
        symbols: [],
        content: undefined as any,
      })
    );

    const result = await parseStrategyScript("code");

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.name).toBe("");
    expect(result.content).toBe("");
  });

  it("passes a Chinese system prompt to the API", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse({ name: "T", symbols: [], content: "c" })
    );

    await parseStrategyScript("some code");

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system).toContain("量化策略分析师");
    expect(callArgs.system).toContain("中文");
    expect(callArgs.system).toContain("最优");
  });

  it("sends user message in Chinese containing the script", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse({ name: "T", symbols: [], content: "c" })
    );

    await parseStrategyScript("print('hello')");

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    const userMessage = callArgs.messages[0].content as string;
    expect(userMessage).toContain("请分析以下");
    expect(userMessage).toContain("print('hello')");
  });

  it("calls the API with the correct model", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse({ name: "T", symbols: [], content: "c" })
    );

    await parseStrategyScript("some code");

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe("glm-5.1");
  });
});
