import { describe, it, expect, vi } from "vitest";
import {
  createAnalyzer,
  type PositionInfo,
  type PositionLotInfo,
} from "../analyze.js";

function makeToolUseResponse(input: { analysis: string; has_action_items: boolean; action_summary?: string; reference_price_updates?: Array<{ symbol: string; new_reference_price: number }>; suggested_skills?: string[] }) {
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

function position(overrides: Partial<PositionInfo> = {}): PositionInfo {
  return {
    symbol: "QQQ",
    totalShares: 10,
    costBasis: 1000,
    avgCost: 100,
    realizedPnl: 0,
    isClosed: false,
    lots: [],
    ...overrides,
  };
}

function lot(overrides: Partial<PositionLotInfo> = {}): PositionLotInfo {
  return {
    id: "lot-1",
    type: "BUY",
    shares: 10,
    costPrice: 100,
    lotDate: "2026-01-01",
    createdAt: "2026-01-01T09:00:00Z",
    ...overrides,
  };
}

describe("analyzeStrategy", () => {
  it("renders a closed position without Infinity and includes ordered transaction types", async () => {
    const client = mockClient(
      makeToolUseResponse({ analysis: "ok", has_action_items: false })
    );
    const analyze = createAnalyzer(client);

    await analyze(
      "Closed strategy",
      "rules",
      [
        position({
          symbol: "META",
          totalShares: 0,
          costBasis: 0,
          avgCost: 0,
          realizedPnl: 300,
          isClosed: true,
          lots: [
            lot({
              id: "sell",
              type: "SELL",
              shares: 5,
              costPrice: 660,
              lotDate: "2026-07-13",
              createdAt: "2026-07-13T09:00:00Z",
            }),
            lot({
              id: "buy",
              type: "BUY",
              shares: 5,
              costPrice: 600,
              lotDate: "2026-05-11",
              createdAt: "2026-05-11T09:00:00Z",
            }),
          ],
        }),
      ],
      { META: { latest: 556.71, bars: [] } }
    );

    const prompt = (client.messages.create as any).mock.calls[0][0]
      .messages[0].content as string;
    expect(prompt).toContain("META: 已清仓");
    expect(prompt).toContain("当前 0 shares");
    expect(prompt).toContain("已实现盈亏 $300.00");
    expect(prompt).toContain("当前持仓收益率不适用");
    expect(prompt).not.toContain("Infinity");
    expect(prompt).not.toContain("NaN");
    expect(prompt.indexOf("BUY 5 shares @ $600.00")).toBeLessThan(
      prompt.indexOf("SELL 5 shares @ $660.00")
    );
  });

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
      [position({ totalShares: 100, avgCost: 180, lots: [lot({ shares: 100, costPrice: 180, lotDate: "2025-01-01" })] })],
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
      [position({ totalShares: 100, avgCost: 180, lots: [lot({ shares: 100, costPrice: 180, lotDate: "2025-01-01" })] })],
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
      [position({ symbol: "ISRG", avgCost: 300, referencePrice: 300 })],
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
      [position({ symbol: "ISRG", avgCost: 300, referencePrice: 300 })],
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
      [position()],
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
      [position()],
      { QQQ: { latest: 110, bars: [] } },
      []
    );
    const prompt = (client.messages.create as any).mock.calls[0][0].messages[0].content;
    expect(prompt).not.toContain("你之前留下的相关笔记");
  });

  it("omits skills section when skills empty", async () => {
    const client = mockClient(
      makeToolUseResponse({ analysis: "ok", has_action_items: false })
    );
    const analyze = createAnalyzer(client);
    await analyze(
      "S",
      "rules",
      [position()],
      { QQQ: { latest: 110, bars: [] } },
      [],
      []
    );
    const prompt = (client.messages.create as any).mock.calls[0][0].messages[0].content;
    expect(prompt).not.toContain("## 可用方法论");
  });

  it("includes skills section before strategy when skills provided", async () => {
    const client = mockClient(
      makeToolUseResponse({ analysis: "ok", has_action_items: false })
    );
    const analyze = createAnalyzer(client);
    await analyze(
      "MyStrat",
      "rules go here",
      [position()],
      { QQQ: { latest: 110, bars: [] } },
      [],
      [
        { id: "a", name: "candlestick", bodyMd: "# K线\n方法论..." },
        { id: "b", name: "risk", bodyMd: "# 风险..." },
      ]
    );
    const prompt = (client.messages.create as any).mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("## 可用方法论");
    expect(prompt).toContain("### candlestick");
    expect(prompt).toContain("# K线\n方法论");
    expect(prompt).toContain("### risk");
    // skills block must appear before the strategy section
    const skillsIdx = prompt.indexOf("## 可用方法论");
    const strategyIdx = prompt.indexOf("## 策略：MyStrat");
    expect(skillsIdx).toBeGreaterThanOrEqual(0);
    expect(strategyIdx).toBeGreaterThan(skillsIdx);
  });

  it("places skills block before memories block", async () => {
    const client = mockClient(
      makeToolUseResponse({ analysis: "ok", has_action_items: false })
    );
    const analyze = createAnalyzer(client);
    await analyze(
      "S",
      "rules",
      [position()],
      { QQQ: { latest: 110, bars: [] } },
      [
        { id: "1", title: "看好 QQQ", kind: "idea", symbol: "QQQ", pinned: true, contentPreview: "H100 backlog" },
      ],
      [{ id: "a", name: "candlestick", bodyMd: "# K线" }]
    );
    const prompt = (client.messages.create as any).mock.calls[0][0].messages[0].content as string;
    const skillsIdx = prompt.indexOf("## 可用方法论");
    const memoriesIdx = prompt.indexOf("## 你之前留下的相关笔记");
    expect(skillsIdx).toBeGreaterThanOrEqual(0);
    expect(memoriesIdx).toBeGreaterThan(skillsIdx);
  });

  it("omits catalog block when availableSkills empty", async () => {
    const client = mockClient(
      makeToolUseResponse({ analysis: "ok", has_action_items: false })
    );
    const analyze = createAnalyzer(client);
    await analyze(
      "S",
      "rules",
      [position()],
      { QQQ: { latest: 110, bars: [] } },
      [],
      [],
      []
    );
    const prompt = (client.messages.create as any).mock.calls[0][0].messages[0].content as string;
    expect(prompt).not.toContain("## 可选技能目录");
  });

  it("includes catalog block between skills and memories with proper formatting", async () => {
    const client = mockClient(
      makeToolUseResponse({ analysis: "ok", has_action_items: false })
    );
    const analyze = createAnalyzer(client);
    await analyze(
      "MyStrat",
      "rules",
      [position()],
      { QQQ: { latest: 110, bars: [] } },
      [{ id: "1", title: "note", kind: "idea", symbol: "QQQ", pinned: false, contentPreview: "hi" }],
      [{ id: "sk", name: "active-skill", bodyMd: "# active" }],
      [
        { name: "a", description: "A desc" },
        { name: "b", description: null },
      ]
    );
    const prompt = (client.messages.create as any).mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("## 可选技能目录");
    expect(prompt).toContain("- a: A desc");
    // null description → no colon
    expect(prompt).toMatch(/(^|\n)- b(\n|$)/);
    // ordering: skills < catalog < memories < strategy
    const skillsIdx = prompt.indexOf("## 可用方法论");
    const catalogIdx = prompt.indexOf("## 可选技能目录");
    const memoriesIdx = prompt.indexOf("## 你之前留下的相关笔记");
    const strategyIdx = prompt.indexOf("## 策略：MyStrat");
    expect(skillsIdx).toBeGreaterThanOrEqual(0);
    expect(catalogIdx).toBeGreaterThan(skillsIdx);
    expect(memoriesIdx).toBeGreaterThan(catalogIdx);
    expect(strategyIdx).toBeGreaterThan(memoriesIdx);
  });

  it("parses suggestedSkills from tool input", async () => {
    const client = mockClient(
      makeToolUseResponse({
        analysis: "ok",
        has_action_items: false,
        suggested_skills: ["candlestick", "risk-checklist"],
      })
    );
    const analyze = createAnalyzer(client);
    const result = await analyze(
      "S",
      "rules",
      [position()],
      { QQQ: { latest: 110, bars: [] } }
    );
    expect(result.suggestedSkills).toEqual(["candlestick", "risk-checklist"]);
  });

  it("defaults suggestedSkills to [] when LLM omits the field", async () => {
    const client = mockClient(
      makeToolUseResponse({ analysis: "ok", has_action_items: false })
    );
    const analyze = createAnalyzer(client);
    const result = await analyze(
      "S",
      "rules",
      [position()],
      { QQQ: { latest: 110, bars: [] } }
    );
    expect(result.suggestedSkills).toEqual([]);
  });

  it("works without the memories argument (back-compat)", async () => {
    const client = mockClient(
      makeToolUseResponse({ analysis: "ok", has_action_items: false })
    );
    const analyze = createAnalyzer(client);
    const result = await analyze(
      "S",
      "rules",
      [position()],
      { QQQ: { latest: 110, bars: [] } }
    );
    expect(result.analysis).toBe("ok");
  });
});
