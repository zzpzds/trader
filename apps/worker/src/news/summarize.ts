import Anthropic from "@anthropic-ai/sdk";
import type { TavilyArticle } from "./tavily-fetch.js";
import { getAnthropicConfig } from "../lib/anthropic-config.js";

export async function summarizeNews(
  strategyName: string,
  strategyContent: string,
  articles: TavilyArticle[],
  client?: Anthropic
): Promise<string> {
  const cfg = getAnthropicConfig("NEWS");
  const anthropic =
    client ??
    new Anthropic({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
    });

  const model = cfg.model;

  const articleText = articles
    .map((a, i) => `[${i + 1}] ${a.title}\n${a.content}`)
    .join("\n\n");

  const prompt = `你是一位股票投资助手。以下是策略「${strategyName}」今日相关新闻：

策略概述：${strategyContent.slice(0, 300)}

今日新闻：
${articleText || "（无新闻）"}

请用 200 字以内的中文总结今日热点要点，重点关注对该策略持仓的潜在影响。不要使用 Markdown 格式。`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });

  const block = response.content[0];
  if (!block || block.type !== "text") {
    throw new Error("LLM did not return a text block");
  }
  return block.text.trim();
}
