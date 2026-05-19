import { describe, it, expect, vi } from "vitest";
import { createAnalyzer } from "../analyze.js";

function makeToolUseResponse(input: { analysis: string; has_action_items: boolean; action_summary?: string }) {
  return {
    content: [
      {
        type: "tool_use",
        id: "toolu_456",
        name: "report_analysis",
        input,
      },
    ],
  };
}

function mockClient(resolvedValue: any) {
  return {
    messages: {
      create: vi.fn().mockResolvedValueOnce(resolvedValue),
    },
  } as any;
}

describe("analyzeStrategy", () => {
  it("returns analysis with action items when triggered", async () => {
    const client = mockClient(
      makeToolUseResponse({
        analysis: "## Analysis\nQQQ is approaching stop loss level.",
        has_action_items: true,
        action_summary: "Consider reducing QQQ position",
      })
    );
    const analyze = createAnalyzer(client);

    const result = await analyze(
      "Test Strategy",
      "Buy QQQ when SMA20 > SMA50",
      [{ symbol: "QQQ", totalShares: 100, avgCost: 180, lots: [{ shares: 100, costPrice: 180, lotDate: "2025-01-01" }] }],
      { QQQ: { latest: 170, bars: [{ date: "2025-05-01", close: 170 }] } }
    );

    expect(result.hasActionItems).toBe(true);
    expect(result.actionSummary).toBe("Consider reducing QQQ position");
    expect(result.analysis).toContain("stop loss");
  });

  it("returns analysis without action items when no triggers", async () => {
    const client = mockClient(
      makeToolUseResponse({
        analysis: "## Analysis\nAll positions within normal range.",
        has_action_items: false,
      })
    );
    const analyze = createAnalyzer(client);

    const result = await analyze(
      "Test Strategy",
      "Buy QQQ when SMA20 > SMA50",
      [{ symbol: "QQQ", totalShares: 100, avgCost: 180, lots: [{ shares: 100, costPrice: 180, lotDate: "2025-01-01" }] }],
      { QQQ: { latest: 190, bars: [{ date: "2025-05-01", close: 190 }] } }
    );

    expect(result.hasActionItems).toBe(false);
    expect(result.actionSummary).toBeUndefined();
  });

  it("throws when LLM does not return tool_use", async () => {
    const client = mockClient({
      content: [{ type: "text", text: "Here's my analysis..." }],
    });
    const analyze = createAnalyzer(client);

    await expect(
      analyze("Test", "desc", [], {})
    ).rejects.toThrow("LLM did not return structured analysis result");
  });

  it("defaults analysis to empty string if missing", async () => {
    const client = mockClient(
      makeToolUseResponse({
        analysis: undefined as any,
        has_action_items: false,
      })
    );
    const analyze = createAnalyzer(client);

    const result = await analyze("Test", "desc", [], {});
    expect(result.analysis).toBe("");
  });
});
