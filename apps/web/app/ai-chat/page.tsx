"use client";

import { useState } from "react";
import { SendHorizonal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export default function AiChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    const question = input.trim();
    if (!question || loading) return;

    const history = messages;
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          messages: history,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "请求失败，请稍后重试");
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: typeof data?.answer === "string" ? data.answer : "" },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col gap-4 p-4 md:p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">组合问答</h1>
        <p className="text-sm text-muted-foreground">基于系统已有组合数据和价格快照回答</p>
      </div>

      <Card className="flex-1">
        <CardContent className="flex h-full min-h-[480px] flex-col gap-4 p-4">
          <div className="flex-1 space-y-3 overflow-y-auto">
            {messages.length === 0 ? (
              <div className="space-y-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                <p>当前对话只保留在本页，会在刷新后清空。</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>当前组合最需要关注的风险是什么？</li>
                  <li>如果只调整一笔仓位，优先动哪一个标的？</li>
                  <li>结合近期价格快照，哪些持仓更适合继续观察？</li>
                </ul>
              </div>
            ) : (
              messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
                >
                  <div
                    className={
                      message.role === "user"
                        ? "max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                        : "max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm"
                    }
                  >
                    <p className="mb-1 text-xs opacity-70">
                      {message.role === "user" ? "你" : "助手"}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{message.content}</p>
                  </div>
                </div>
              ))
            )}

            {loading && (
              <div className="flex justify-start">
                <div className="rounded-lg bg-muted px-3 py-2 text-sm">
                  <p className="mb-1 text-xs opacity-70">助手</p>
                  <p>正在生成回答...</p>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3 border-t pt-4">
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-col gap-3">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="询问组合、持仓、风险或调仓建议"
                rows={4}
                disabled={loading}
              />
              <div className="flex justify-end">
                <Button type="button" onClick={handleSubmit} disabled={loading || input.trim().length === 0}>
                  <SendHorizonal />
                  <span>发送</span>
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
