import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL,
});

const PARSE_TOOL_NAME = "parse_strategy";

const SYSTEM_PROMPT = `你是一名量化策略分析师。请用中文分析 Python 交易策略脚本，提取关键信息。
输出内容要精炼，不要重复代码，不要冗余描述。
若脚本中包含多组参数的回测对比结果，请选取收益表现最优的那组参数作为最终策略描述的依据。`;

const parseToolSchema = {
  name: PARSE_TOOL_NAME,
  description: "将 Python 交易策略脚本解析为结构化数据",
  input_schema: {
    type: "object" as const,
    properties: {
      name: {
        type: "string" as const,
        description: "从脚本中提取的策略名称",
      },
      symbols: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "脚本中涉及的股票代码列表",
      },
      content: {
        type: "string" as const,
        description: `用中文撰写的策略描述（markdown 格式），固定包含以下段落：
## 策略总结
1-3 句话概括策略核心逻辑。

## 采用参数
若脚本含多组参数回测对比，列出选定的最优参数组合及选择依据（如最高年化收益、最大夏普比等）；若无多组参数对比，注明"无参数对比"。

## 涉及标的
列出所有股票代码及其在策略中的角色。

## 买卖规则
每支股票独立列出买入条件和卖出条件。

## 切换逻辑
何时从一支股票切换到另一支，以及切换依据。若策略仅含单一持仓，注明"无切换逻辑"。`,
      },
    },
    required: ["name", "symbols", "content"],
  },
};

export interface ParsedStrategy {
  name: string;
  symbols: string[];
  content: string;
}

export async function parseStrategyScript(script: string): Promise<ParsedStrategy> {
  const response = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? "glm-5.1",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [parseToolSchema],
    messages: [
      {
        role: "user",
        content: `请分析以下 Python 交易策略脚本：\n\n\`\`\`python\n${script}\n\`\`\``,
      },
    ],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === PARSE_TOOL_NAME
  );

  if (!toolUse) {
    throw new Error("LLM 未返回结构化解析结果");
  }

  const input = toolUse.input as ParsedStrategy;
  return {
    name: input.name ?? "",
    symbols: Array.isArray(input.symbols) ? input.symbols : [],
    content: input.content ?? "",
  };
}
