import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicConfig } from "../lib/anthropic-config.js";
export async function summarizeNews(strategyName, strategyContent, articles, client) {
    const cfg = getAnthropicConfig("NEWS");
    const anthropic = client ??
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
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock) {
        const got = response.content.map((b) => b.type).join(", ") || "empty";
        throw new Error(`LLM did not return a text block (got: ${got})`);
    }
    return textBlock.text.trim();
}
