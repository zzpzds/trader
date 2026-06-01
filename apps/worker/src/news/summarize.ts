import Anthropic from "@anthropic-ai/sdk";
import type { TavilyArticle } from "./tavily-fetch.js";

const FALLBACK = "摘要生成失败，请稍后重试";

export async function summarizeNews(
  strategyName: string,
  strategyContent: string,
  articles: TavilyArticle[],
  client?: Anthropic
): Promise<string> {
  const anthropic =
    client ??
    new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL,
    });

  const model = process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-20241022";

  const articleText = articles
    .map((a, i) => `[${i + 1}] ${a.title}\n${a.content}`)
    .join("\n\n");

  const prompt = `你是一位股票投资助手。以下是策略「${strategyName}」今日相关新闻：

策略概述：${strategyContent.slice(0, 300)}

今日新闻：
${articleText || "（无新闻）"}

请用 200 字以内的中文总结今日热点要点，重点关注对该策略持仓的潜在影响。不要使用 Markdown 格式。`;

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    const block = response.content[0];
    return block && block.type === "text" ? block.text.trim() : FALLBACK;
  } catch (err) {
    console.warn(
      "[news] LLM summarize failed:",
      err instanceof Error ? err.message : String(err)
    );
    return FALLBACK;
  }
}
