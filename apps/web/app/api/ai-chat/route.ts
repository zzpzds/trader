import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildPortfolioChatContext } from "@/lib/ai-chat/context";
import {
  buildAiChatMessages,
  formatPortfolioContext,
  sanitizeHistory,
} from "@/lib/ai-chat/prompt";
import { getAnthropicConfig } from "@/lib/anthropic-config";

const MAX_REQUEST_BODY_BYTES = 128 * 1024;
const MAX_HISTORY_INPUT_MESSAGES = 24;

const requestSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  messages: z
    .array(
      z.object({
        role: z.string(),
        content: z.string().max(4000),
      })
    )
    .max(MAX_HISTORY_INPUT_MESSAGES, "历史消息过多，请精简后重试。")
    .optional(),
});

export async function POST(request: Request) {
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : Number.NaN;
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    return NextResponse.json(
      { error: "请求体过大，请减少问题或历史消息后重试。" },
      { status: 413 }
    );
  }

  const body = await request.json().catch(() => null);

  if (typeof body?.question === "string" && body.question.trim().length === 0) {
    return NextResponse.json({ error: "请输入问题。" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const message =
      parsed.error.issues.find((issue) => issue.path[0] === "messages")?.message ??
      "请求参数不合法。";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { apiKey, baseURL, model } = getAnthropicConfig("CHAT");
  if (!apiKey) {
    return NextResponse.json({ error: "AI Chat 模型配置缺失。" }, { status: 500 });
  }

  try {
    const context = await buildPortfolioChatContext();
    const contextText = formatPortfolioContext(context);
    const history = sanitizeHistory(parsed.data.messages);
    const messages = buildAiChatMessages({
      contextText,
      question: parsed.data.question,
      history,
    });
    const system = messages.find((message) => message.role === "system")?.content;
    const chatMessages = messages.filter(
      (message): message is { role: "user" | "assistant"; content: string } =>
        message.role === "user" || message.role === "assistant"
    );

    const client = new Anthropic({ apiKey, baseURL });
    const completion = await client.messages.create({
      model,
      max_tokens: 2000,
      ...(system ? { system } : {}),
      messages: chatMessages,
    });

    const answer = completion.content.find((item) => item.type === "text")?.text;
    if (!answer) {
      return NextResponse.json({ error: "AI Chat 未返回可读文本。" }, { status: 500 });
    }

    return NextResponse.json({ answer });
  } catch {
    return NextResponse.json(
      { error: "AI Chat 暂时不可用，请稍后重试。" },
      { status: 500 }
    );
  }
}
