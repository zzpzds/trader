# 策略解析 Prompt 优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化 `parseStrategyScript` 的 LLM prompt，使解析结果精炼、中文输出，并能从多参数对比脚本中自动选出最优参数。

**Architecture:** 仅修改 `parse-strategy.ts`：新增中文 system prompt、改写 user message、更新 `content` 工具字段描述为固定的 5 节格式（"采用参数"节在无多组参数对比时省略）。工具 schema 结构（`name/symbols/content`）不变，前端无需修改。

**Tech Stack:** Anthropic SDK（`@anthropic-ai/sdk`），Vitest

---

### Task 1: 更新 parse-strategy.ts

**Files:**
- Modify: `apps/web/lib/parse-strategy.ts`

- [ ] **Step 1: 在测试文件中新增两个失败测试，验证 system prompt 存在且 user message 为中文**

打开 `apps/web/lib/__tests__/parse-strategy.test.ts`，在现有 describe 块末尾追加：

```typescript
  it("passes a Chinese system prompt to the API", async () => {
    const mockInstance = new (Anthropic as any)();
    mockInstance.messages.create.mockResolvedValueOnce(
      makeToolUseResponse({ name: "T", symbols: [], content: "c" })
    );

    await parseStrategyScript("some code");

    const callArgs = mockInstance.messages.create.mock.calls[0][0];
    expect(callArgs.system).toContain("量化策略分析师");
    expect(callArgs.system).toContain("中文");
    expect(callArgs.system).toContain("最优");
  });

  it("sends user message in Chinese containing the script", async () => {
    const mockInstance = new (Anthropic as any)();
    mockInstance.messages.create.mockResolvedValueOnce(
      makeToolUseResponse({ name: "T", symbols: [], content: "c" })
    );

    await parseStrategyScript("print('hello')");

    const callArgs = mockInstance.messages.create.mock.calls[0][0];
    const userMessage = callArgs.messages[0].content as string;
    expect(userMessage).toContain("请分析以下");
    expect(userMessage).toContain("print('hello')");
  });
```

- [ ] **Step 2: 运行新增测试，确认它们失败**

```bash
cd apps/web && npx vitest run lib/__tests__/parse-strategy.test.ts
```

预期：前 4 个测试 PASS，新增 2 个测试 FAIL（`callArgs.system` 为 undefined，user message 为英文）。

- [ ] **Step 3: 更新 parse-strategy.ts**

将 `apps/web/lib/parse-strategy.ts` 全文替换为：

```typescript
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
（仅当脚本含多组参数回测对比时输出）列出选定的最优参数组合及选择依据（如最高年化收益、最大夏普比等）。

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
    model: "glm-5.1",
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
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === PARSE_TOOL_NAME
  );

  if (!toolUse) {
    throw new Error("LLM did not return structured parse result");
  }

  const input = toolUse.input as ParsedStrategy;
  return {
    name: input.name ?? "",
    symbols: Array.isArray(input.symbols) ? input.symbols : [],
    content: input.content ?? "",
  };
}
```

- [ ] **Step 4: 运行全部测试，确认全部通过**

```bash
cd apps/web && npx vitest run lib/__tests__/parse-strategy.test.ts
```

预期：6 个测试全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/lib/parse-strategy.ts apps/web/lib/__tests__/parse-strategy.test.ts
git commit -m "feat: 优化策略解析 prompt，中文输出，精炼格式，支持最优参数选取"
```
