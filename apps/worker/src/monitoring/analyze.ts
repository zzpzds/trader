import Anthropic from "@anthropic-ai/sdk";

const REPORT_TOOL_NAME = "report_analysis";

const reportToolSchema = {
  name: REPORT_TOOL_NAME,
  description: "Submit the analysis report for a trading strategy with positions",
  input_schema: {
    type: "object" as const,
    properties: {
      analysis: {
        type: "string" as const,
        description: "Full markdown analysis report of the strategy's current state",
      },
      has_action_items: {
        type: "boolean" as const,
        description: "Whether any action items (buy/sell/adjust) are recommended",
      },
      action_summary: {
        type: "string" as const,
        description: "Brief summary of recommended actions, if any",
      },
    },
    required: ["analysis", "has_action_items"],
  },
};

export interface AnalysisResult {
  analysis: string;
  hasActionItems: boolean;
  actionSummary?: string;
}

export interface PositionInfo {
  symbol: string;
  totalShares: number;
  avgCost: number;
  lots: Array<{ shares: number; costPrice: number; lotDate: string; notes?: string }>;
}

export function createAnalyzer(client?: Anthropic) {
  const anthropic = client ?? new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL,
  });

  return async function analyzeStrategy(
    strategyName: string,
    strategyContent: string,
    positions: PositionInfo[],
    prices: Record<string, { latest: number; bars: Array<{ date: string; close: number }> }>
  ): Promise<AnalysisResult> {
    const positionSummary = positions
      .map((p) => {
        const priceData = prices[p.symbol];
        const latestPrice = priceData?.latest;
        const pnl = latestPrice ? ((latestPrice - p.avgCost) / p.avgCost * 100).toFixed(2) : null;
        return `- ${p.symbol}: ${p.totalShares} shares @ avg $${p.avgCost.toFixed(2)}, latest $${latestPrice ?? "N/A"}, P&L ${pnl ?? "N/A"}%`;
      })
      .join("\n");

    const recentBars = Object.entries(prices)
      .map(([symbol, data]) => {
        const last10 = data.bars.slice(-10);
        return `${symbol} recent closes: ${last10.map((b) => `${b.date}: $${b.close}`).join(", ")}`;
      })
      .join("\n");

    const response = await anthropic.messages.create({
      model: "glm-5.1",
      max_tokens: 4096,
      tools: [reportToolSchema],
      messages: [
        {
          role: "user",
          content: `Analyze the following trading strategy and its current positions. Determine if any action items are needed based on the strategy rules.

## Strategy: ${strategyName}

${strategyContent}

## Current Positions
${positionSummary}

## Recent Price Data
${recentBars}

Please analyze whether the current market conditions trigger any strategy rules (entry, exit, position adjustments) and provide your assessment.`,
        },
      ],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === REPORT_TOOL_NAME
    );

    if (!toolUse) {
      throw new Error("LLM did not return structured analysis result");
    }

    const input = toolUse.input as {
      analysis: string;
      has_action_items: boolean;
      action_summary?: string;
    };

    return {
      analysis: input.analysis ?? "",
      hasActionItems: input.has_action_items ?? false,
      actionSummary: input.action_summary,
    };
  };
}

export const analyzeStrategy = createAnalyzer();
