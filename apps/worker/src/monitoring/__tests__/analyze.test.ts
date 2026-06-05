import { describe, it, expect, vi } from "vitest";
import { createAnalyzer } from "../analyze.js";

function makeToolUseResponse(input: { analysis: string; has_action_items: boolean; action_summary?: string; reference_price_updates?: Array<{ symbol: string; new_reference_price: number }> }) {
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

  it("returns referencePriceUpdates when LLM outputs them", async () => {
    const client = mockClient(
      makeToolUseResponse({
        analysis: "## Analysis\nISRG hit reset threshold.",
        has_action_items: false,
        reference_price_updates: [{ symbol: "ISRG", new_reference_price: 348.5 }],
      })
    );
    const analyze = createAnalyzer(client);

    const result = await analyze(
      "T1 Strategy",
      "Reset ref price when price >= ref * 1.15",
      [{ symbol: "ISRG", totalShares: 10, avgCost: 300, referencePrice: 300, lots: [] }],
      { ISRG: { latest: 348.5, bars: [] } }
    );

    expect(result.referencePriceUpdates).toEqual([
      { symbol: "ISRG", newReferencePrice: 348.5 },
    ]);
  });

  it("returns empty referencePriceUpdates when LLM omits the field", async () => {
    const client = mockClient(
      makeToolUseResponse({
        analysis: "## Analysis\nAll within range.",
        has_action_items: false,
      })
    );
    const analyze = createAnalyzer(client);

    const result = await analyze(
      "T1 Strategy",
      "Reset ref price when price >= ref * 1.15",
      [{ symbol: "ISRG", totalShares: 10, avgCost: 300, referencePrice: 300, lots: [] }],
      { ISRG: { latest: 310, bars: [] } }
    );

    expect(result.referencePriceUpdates).toEqual([]);
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

  it("includes memories section in prompt when memories provided", async () => {
    const client = mockClient(
      makeToolUseResponse({ analysis: "ok", has_action_items: false })
    );
    const analyze = createAnalyzer(client);
    await analyze(
      "S",
      "rules",
      [{ symbol: "QQQ", totalShares: 10, avgCost: 100, lots: [] }],
      { QQQ: { latest: 110, bars: [] } },
      [
        { id: "1", title: "看好 QQQ", kind: "idea", symbol: "QQQ", pinned: true, contentPreview: "H100 backlog" },
      ]
    );
    const prompt = (client.messages.create as any).mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("你之前留下的相关笔记");
    expect(prompt).toContain("看好 QQQ");
  });

  it("omits memories section when memories empty", async () => {
    const client = mockClient(
      makeToolUseResponse({ analysis: "ok", has_action_items: false })
    );
    const analyze = createAnalyzer(client);
    await analyze(
      "S",
      "rules",
      [{ symbol: "QQQ", totalShares: 10, avgCost: 100, lots: [] }],
      { QQQ: { latest: 110, bars: [] } },
      []
    );
    const prompt = (client.messages.create as any).mock.calls[0][0].messages[0].content;
    expect(prompt).not.toContain("你之前留下的相关笔记");
  });

  it("works without the memories argument (back-compat)", async () => {
    const client = mockClient(
      makeToolUseResponse({ analysis: "ok", has_action_items: false })
    );
    const analyze = createAnalyzer(client);
    const result = await analyze(
      "S",
      "rules",
      [{ symbol: "QQQ", totalShares: 10, avgCost: 100, lots: [] }],
      { QQQ: { latest: 110, bars: [] } }
    );
    expect(result.analysis).toBe("ok");
  });
});
