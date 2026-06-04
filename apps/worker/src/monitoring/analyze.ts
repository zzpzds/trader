import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicConfig } from "../lib/anthropic-config.js";

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
      reference_price_updates: {
        type: "array" as const,
        description: "List of reference price resets triggered by strategy rules",
        items: {
          type: "object" as const,
          properties: {
            symbol: { type: "string" as const, description: "Stock symbol" },
            new_reference_price: { type: "number" as const, description: "New reference price value" },
          },
          required: ["symbol", "new_reference_price"],
        },
      },
    },
    required: ["analysis", "has_action_items"],
  },
};

export interface AnalysisResult {
  analysis: string;
  hasActionItems: boolean;
  actionSummary?: string;
  referencePriceUpdates: Array<{ symbol: string; newReferencePrice: number }>;
}

export interface PositionInfo {
  symbol: string;
  totalShares: number;
  avgCost: number;
  referencePrice?: number | null;
  lots: Array<{ shares: number; costPrice: number; lotDate: string; notes?: string }>;
}

export function createAnalyzer(client?: Anthropic) {
  const cfg = getAnthropicConfig("MONITORING");
  const anthropic = client ?? new Anthropic({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL,
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
        const refLabel = p.referencePrice != null ? `$${p.referencePrice.toFixed(2)}` : "无参考价";
        return `- ${p.symbol}: ${p.totalShares} shares @ avg $${p.avgCost.toFixed(2)}, ref ${refLabel}, latest $${latestPrice ?? "N/A"}, P&L ${pnl ?? "N/A"}%`;
      })
      .join("\n");

    const recentBars = Object.entries(prices)
      .map(([symbol, data]) => {
        const last10 = data.bars.slice(-10);
        return `${symbol} recent closes: ${last10.map((b) => `${b.date}: $${b.close}`).join(", ")}`;
      })
      .join("\n");

    const response = await anthropic.messages.create({
      model: cfg.model,
      max_tokens: 4096,
      tools: [reportToolSchema],
      messages: [
        {
          role: "user",
          content: `请分析以下交易策略及其当前持仓情况，根据策略规则判断是否需要采取操作。请用中文输出分析报告。

## 策略：${strategyName}

${strategyContent}

## 当前持仓
${positionSummary}

## 近期价格数据
${recentBars}

请分析当前市场状况是否触发了策略规则（入场、出场、仓位调整、参考价重置），并给出你的判断。若参考价需要更新，请在 reference_price_updates 中输出新值。`,
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
      reference_price_updates?: Array<{ symbol: string; new_reference_price: number }>;
    };

    return {
      analysis: input.analysis ?? "",
      hasActionItems: input.has_action_items ?? false,
      actionSummary: input.action_summary,
      referencePriceUpdates: (input.reference_price_updates ?? []).map((u) => ({
        symbol: u.symbol,
        newReferencePrice: u.new_reference_price,
      })),
    };
  };
}

export const analyzeStrategy = createAnalyzer();
