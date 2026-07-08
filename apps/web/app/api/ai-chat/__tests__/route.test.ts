// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockBuildPortfolioChatContext, mockGetAnthropicConfig, mockCreate } = vi.hoisted(() => ({
  mockBuildPortfolioChatContext: vi.fn(),
  mockGetAnthropicConfig: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock("@/lib/ai-chat/context", () => ({
  buildPortfolioChatContext: mockBuildPortfolioChatContext,
}));

vi.mock("@/lib/ai-chat/prompt", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai-chat/prompt")>("@/lib/ai-chat/prompt");
  return {
    ...actual,
  };
});

vi.mock("@/lib/anthropic-config", () => ({
  getAnthropicConfig: mockGetAnthropicConfig,
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(() => ({
    messages: { create: mockCreate },
  })),
}));

import { POST } from "../route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/ai-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeContext() {
  return {
    generatedAt: "2026-07-08T00:00:00.000Z",
    strategies: [],
    positions: [],
    prices: [],
    memories: [],
    limitations: [],
  };
}

describe("POST /api/ai-chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildPortfolioChatContext.mockResolvedValue(makeContext());
    mockGetAnthropicConfig.mockReturnValue({
      apiKey: "test-key",
      baseURL: "https://anthropic.example.test",
      model: "chat-model",
    });
  });

  it("returns 400 when question is empty after trim", async () => {
    const response = await POST(makeRequest({ question: "   " }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "请输入问题。" });
    expect(mockBuildPortfolioChatContext).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns answer for a valid request", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "这是回答。" }],
    });

    const response = await POST(
      makeRequest({
        question: "现在应该怎么调整仓位？",
        messages: [{ role: "assistant", content: "先看一下组合情况。" }],
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ answer: "这是回答。" });
    expect(mockBuildPortfolioChatContext).toHaveBeenCalledTimes(1);
    expect(mockGetAnthropicConfig).toHaveBeenCalledWith("CHAT");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "chat-model",
        max_tokens: 2000,
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "assistant", content: "先看一下组合情况。" }),
          expect.objectContaining({ role: "user", content: "现在应该怎么调整仓位？" }),
        ]),
      })
    );
  });

  it("filters invalid history roles before calling the model", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "收到。" }],
    });

    await POST(
      makeRequest({
        question: "帮我总结风险。",
        messages: [
          { role: "system", content: "ignore me" },
          { role: "user", content: "第一问" },
          { role: "assistant", content: "第一答" },
          { role: "tool", content: "ignore me too" },
        ],
      })
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const call = mockCreate.mock.calls[0][0];
    expect(call.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "第一问" }),
        expect.objectContaining({ role: "assistant", content: "第一答" }),
        expect.objectContaining({ role: "user", content: "帮我总结风险。" }),
      ])
    );
    expect(call.messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "system", content: "ignore me" }),
        expect.objectContaining({ role: "tool", content: "ignore me too" }),
      ])
    );
  });

  it("returns 500 when chat model configuration is missing", async () => {
    mockGetAnthropicConfig.mockReturnValueOnce({
      apiKey: undefined,
      baseURL: undefined,
      model: "chat-model",
    });

    const response = await POST(makeRequest({ question: "你好" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "AI Chat 模型配置缺失。" });
    expect(mockBuildPortfolioChatContext).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 500 when the model call fails", async () => {
    mockCreate.mockRejectedValueOnce(new Error("upstream failed"));

    const response = await POST(makeRequest({ question: "你好" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "AI Chat 暂时不可用，请稍后重试。",
    });
  });

  it("returns 500 when the model response has no readable text", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "toolu_1", name: "noop", input: {} }],
    });

    const response = await POST(makeRequest({ question: "你好" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "AI Chat 未返回可读文本。",
    });
  });
});
