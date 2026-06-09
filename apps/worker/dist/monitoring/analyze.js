import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicConfig } from "../lib/anthropic-config.js";
const REPORT_TOOL_NAME = "report_analysis";
const reportToolSchema = {
    name: REPORT_TOOL_NAME,
    description: "Submit the analysis report for a trading strategy with positions",
    input_schema: {
        type: "object",
        properties: {
            analysis: {
                type: "string",
                description: "Full markdown analysis report of the strategy's current state",
            },
            has_action_items: {
                type: "boolean",
                description: "Whether any action items (buy/sell/adjust) are recommended",
            },
            action_summary: {
                type: "string",
                description: "Brief summary of recommended actions, if any",
            },
            reference_price_updates: {
                type: "array",
                description: "List of reference price resets triggered by strategy rules",
                items: {
                    type: "object",
                    properties: {
                        symbol: { type: "string", description: "Stock symbol" },
                        new_reference_price: { type: "number", description: "New reference price value" },
                    },
                    required: ["symbol", "new_reference_price"],
                },
            },
        },
        required: ["analysis", "has_action_items"],
    },
};
export function createAnalyzer(client) {
    const cfg = getAnthropicConfig("MONITORING");
    const anthropic = client ?? new Anthropic({
        apiKey: cfg.apiKey,
        baseURL: cfg.baseURL,
    });
    return async function analyzeStrategy(strategyName, strategyContent, positions, prices, memories = [], skills = []) {
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
                    content: `你是一位严格按规则行事的交易策略分析师。基于下方策略 + 持仓 + 行情，判断今天是否触发了策略规则，并产出**简短**的中文分析。

${skillsBlock}${memoriesBlock}## 策略：${strategyName}

${strategyContent}

## 当前持仓
${positionSummary}

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
        const toolUse = response.content.find((block) => block.type === "tool_use" && block.name === REPORT_TOOL_NAME);
        if (!toolUse) {
            throw new Error("LLM did not return structured analysis result");
        }
        const input = toolUse.input;
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
