import type { PortfolioChatContext } from "./context";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const MAX_HISTORY_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 4000;

function trimAndLimit(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_MESSAGE_LENGTH);
}

function formatUtcTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace("T", " ").replace(".000Z", " UTC").replace("Z", " UTC");
}

export function sanitizeHistory(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) return [];

  const cleaned: ChatMessage[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const record = message as { role?: unknown; content?: unknown };
    if (record.role !== "user" && record.role !== "assistant") continue;
    const content = trimAndLimit(record.content);
    if (!content) continue;
    cleaned.push({ role: record.role, content });
  }

  return cleaned.slice(-MAX_HISTORY_MESSAGES);
}

export function formatPortfolioContext(context: PortfolioChatContext): string {
  const lines: string[] = [];

  lines.push(`生成时间：${formatUtcTimestamp(context.generatedAt)}`);
  lines.push("");
  lines.push("策略：");
  if (context.strategies.length === 0) {
    lines.push("- 无可用策略");
  } else {
    for (const strategy of context.strategies) {
      lines.push(`- ${strategy.name}（${strategy.symbols.join(", ") || "无 symbols"}）`);
      lines.push(`  内容：${strategy.content}`);
    }
  }

  lines.push("");
  lines.push("未关闭持仓：");
  if (context.positions.length === 0) {
    lines.push("- 无未关闭持仓");
  } else {
    for (const position of context.positions) {
      const latestPrice = position.latestPrice == null ? "缺失" : position.latestPrice.toFixed(2);
      const unrealizedPnl =
        position.unrealizedPnl == null ? "缺失" : position.unrealizedPnl.toFixed(2);
      lines.push(
        `- ${position.symbol}：${position.totalShares} 股，均价 ${position.averageCost.toFixed(2)}，` +
          `参考价 ${position.referencePrice == null ? "缺失" : position.referencePrice.toFixed(2)}，` +
          `最新价 ${latestPrice}，浮动盈亏 ${unrealizedPnl}`
      );
      if (position.strategyName) {
        lines.push(`  关联策略：${position.strategyName}`);
      }
    }
  }

  lines.push("");
  lines.push("价格快照：");
  if (context.prices.length === 0) {
    lines.push("- 无可用价格快照");
  } else {
    for (const price of context.prices) {
      const latestClose = price.latestClose == null ? "缺失" : price.latestClose.toFixed(2);
      lines.push(`- ${price.symbol}：最新可用收盘价 ${latestClose}`);
      if (price.recentCloses.length === 0) {
        lines.push("  近期收盘：无");
      } else {
        lines.push(
          `  近期收盘：${price.recentCloses
            .map((row) => `${row.date}=${row.close.toFixed(2)}`)
            .join("；")}`
        );
      }
    }
  }

  lines.push("");
  lines.push("记忆背景：");
  if (context.memories.length === 0) {
    lines.push("- 无可用记忆背景");
  } else {
    lines.push("- 记忆仅代表用户背景/偏好/复盘/笔记，不是当前行情事实。");
    lines.push("- 当前组合数据和价格快照优先于记忆。");
    for (const memory of context.memories) {
      lines.push(
        `- ${memory.label}｜${memory.title}｜${memory.updatedAt}${memory.pinned ? "｜置顶" : ""}`
      );
      lines.push(`  ${memory.content}`);
    }
  }

  lines.push("");
  lines.push("数据限制：");
  if (context.limitations.length === 0) {
    lines.push("- 无额外限制");
  } else {
    for (const limitation of context.limitations) {
      lines.push(`- ${limitation}`);
    }
  }

  return lines.join("\n");
}

function buildSystemPrompt(): string {
  return [
    "你是一个中文投资组合问答助手。",
    "基于系统提供的数据回答。",
    "允许给出明确买入、卖出、加仓、减仓、持有/观望建议。",
    "建议必须说明依据、关键风险、数据时效和不确定性。",
    "缺少持仓、价格、策略或历史数据时必须指出缺口。",
    "不声称使用实时行情。",
    "不声称已执行交易。",
    "不输出工具调用或结构化交易指令。",
    "回答应以文本为主，不输出 JSON。",
  ].join("\n");
}

export function buildAiChatMessages(args: {
  contextText: string;
  question: string;
  history?: unknown;
}): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: `以下是系统提供的组合上下文：\n${args.contextText}` },
    ...sanitizeHistory(args.history),
    { role: "user", content: trimAndLimit(args.question) ?? "" },
  ];

  return messages.filter((message) => message.content.length > 0);
}
