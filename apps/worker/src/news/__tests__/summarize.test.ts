// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

import { summarizeNews } from "../summarize.js";

describe("summarizeNews", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns trimmed text content from the LLM", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "  今日 ISRG 消息：手术机器人需求持续增长。  " }],
    });

    const result = await summarizeNews(
      "T1 策略",
      "买入 ISRG，参考价重置规则",
      [{ title: "ISRG Q1", url: "https://example.com", content: "Strong earnings" }]
    );

    expect(result).toBe("今日 ISRG 消息：手术机器人需求持续增长。");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 400,
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "user" }),
        ]),
      })
    );
  });

  it("propagates the error when LLM call throws", async () => {
    mockCreate.mockRejectedValueOnce(new Error("rate limit"));

    await expect(
      summarizeNews("T1 策略", "内容", [
        { title: "x", url: "https://x", content: "x" },
      ])
    ).rejects.toThrow("rate limit");
  });

  it("throws when first content block is not text", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "abc", name: "n", input: {} }],
    });

    await expect(
      summarizeNews("T1 策略", "内容", [
        { title: "x", url: "https://x", content: "x" },
      ])
    ).rejects.toThrow(/text block/);
  });
});
