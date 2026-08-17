import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicConfig } from "../lib/anthropic-config.js";
import type { RelevantMemory } from "./load-memories.js";

const REPORT_TOOL_NAME = "report_analysis";
const POSITION_EPS = 1e-9;

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
      suggested_skills: {
        type: "array" as const,
        description:
          "Optional: 0–3 skill names from 可选技能目录 that would help future analyses. Return [] if none apply.",
        items: { type: "string" as const },
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
  suggestedSkills: string[];
}

export interface SkillCatalogEntry {
  name: string;
  description: string | null;
}

export interface PositionLotInfo {
  id: string;
  type: "BUY" | "SELL";
  shares: number;
  costPrice: number;
  lotDate: string;
  createdAt?: string | Date | null;
  notes?: string;
}

export interface PositionInfo {
  symbol: string;
  totalShares: number;
  costBasis: number;
  avgCost: number;
  realizedPnl: number;
  isClosed: boolean;
  referencePrice?: number | null;
  lots: PositionLotInfo[];
}

function createdAtMillis(value: string | Date | null | undefined): number {
  if (value == null) return 0;
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function orderedLots(lots: readonly PositionLotInfo[]): PositionLotInfo[] {
  return [...lots].sort((left, right) => {
    if (left.lotDate !== right.lotDate) {
      return left.lotDate < right.lotDate ? -1 : 1;
    }
    const createdAtDelta =
      createdAtMillis(left.createdAt) - createdAtMillis(right.createdAt);
    if (createdAtDelta !== 0) return createdAtDelta;
    return left.id.localeCompare(right.id);
  });
}

export interface SkillForAnalysis {
  id: string;
  name: string;
  bodyMd: string;
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
    prices: Record<string, { latest: number; bars: Array<{ date: string; close: number }> }>,
    memories: RelevantMemory[] = [],
    skills: SkillForAnalysis[] = [],
    availableSkills: SkillCatalogEntry[] = []
  ): Promise<AnalysisResult> {
    const memoriesBlock = memories.length === 0
      ? ""
      : `## 你之前留下的相关笔记\n\n${memories
          .map((m) => {
            const tags = [m.pinned ? "pinned" : null, m.kind, m.symbol].filter(Boolean).join(" · ");
            return `- [${tags}] ${m.title}：${m.contentPreview}`;
          })
          .join("\n")}\n\n`;

    const skillsBlock = skills.length === 0
      ? ""
      : `## 可用方法论\n\n${skills
          .map((s) => `### ${s.name}\n${s.bodyMd}`)
          .join("\n\n---\n\n")}\n\n`;

    const catalogBlock = availableSkills.length === 0
      ? ""
      : `## 可选技能目录\n（如果以下方法论中有任何一个对本次分析会有帮助但当前未被启用，请在 suggested_skills 中列出对应的 name；最多 3 条；如果都没必要，返回空数组）\n${availableSkills
          .map((s) => (s.description ? `- ${s.name}: ${s.description}` : `- ${s.name}`))
          .join("\n")}\n\n`;

    const positionSummary = positions
      .map((position) => {
        const latestPrice = prices[position.symbol]?.latest;
        const hasLatestPrice =
          typeof latestPrice === "number" && Number.isFinite(latestPrice);
        const latestLabel = hasLatestPrice ? `$${latestPrice}` : "N/A";
        const referenceLabel =
          position.referencePrice != null
            ? `$${position.referencePrice.toFixed(2)}`
            : "无参考价";

        if (position.isClosed) {
          return `- ${position.symbol}: 已清仓，当前 0 shares，成本基础 $0.00，已实现盈亏 $${position.realizedPnl.toFixed(2)}，ref ${referenceLabel}，latest ${latestLabel}，当前持仓收益率不适用`;
        }

        const pnl =
          hasLatestPrice && position.avgCost > POSITION_EPS
            ? `${(((latestPrice - position.avgCost) / position.avgCost) * 100).toFixed(2)}%`
            : "N/A";
        return `- ${position.symbol}: ${position.totalShares} shares @ avg $${position.avgCost.toFixed(2)}，成本基础 $${position.costBasis.toFixed(2)}，已实现盈亏 $${position.realizedPnl.toFixed(2)}，ref ${referenceLabel}，latest ${latestLabel}，P&L ${pnl}`;
      })
      .join("\n");

    const transactionHistory = positions
      .map((position) => {
        const lines = orderedLots(position.lots).map(
          (item) =>
            `- ${item.type} ${item.shares} shares @ $${item.costPrice.toFixed(2)} (${item.lotDate})`
        );
        return `### ${position.symbol}\n${lines.length > 0 ? lines.join("\n") : "- 无交易明细"}`;
      })
      .join("\n\n");

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
          content: `你是一位严格按规则行事的交易策略分析师。基于下方策略 + 持仓 + 行情，判断今天是否触发了策略规则，并产出**简短**的中文分析。

${skillsBlock}${catalogBlock}${memoriesBlock}## 策略：${strategyName}

${strategyContent}

## 当前持仓
${positionSummary}

## 交易历史
${transactionHistory}

## 近期价格数据
${recentBars}

---

请按下面**三段式结构**写 \`analysis\` 字段（直接是 markdown，不要寒暄、不要前后缀）：

### 结论
1 句话给出今天的判断。例：「NASA 触发首次加仓阈值，建议买入 ~28 股」或「无规则触发，继续持有」。

### 操作
若有操作，按下面格式列出，每条一行，必须含具体数字：
- **{符号}** 买入/卖出 ~{金额或股数}（{一句话原因}）
- **{符号}** 参考价更新 ${'$'}X → ${'$'}Y（{一句话原因}）

若无操作，写一行：\`无需操作\`。

### 详细分析
按需展开（持仓概览 / 规则触发检查 / 推理过程），让用户想看再看。可以用列表或小表格，但不要重复"结论"已经说过的话。

---

若参考价需要更新，**同时**在 \`reference_price_updates\` 中输出 { symbol, new_reference_price }。
\`action_summary\` 字段就是上面"结论"那一句，不要变。`,
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
      suggested_skills?: string[];
    };

    return {
      analysis: input.analysis ?? "",
      hasActionItems: input.has_action_items ?? false,
      actionSummary: input.action_summary,
      referencePriceUpdates: (input.reference_price_updates ?? []).map((u) => ({
        symbol: u.symbol,
        newReferencePrice: u.new_reference_price,
      })),
      suggestedSkills: input.suggested_skills ?? [],
    };
  };
}

export const analyzeStrategy = createAnalyzer();
