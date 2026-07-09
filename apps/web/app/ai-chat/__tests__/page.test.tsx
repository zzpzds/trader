// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AiChatPage from "../page";

type FetchOkPayload = { answer: string };
type FetchErrorPayload = { error: string };

function deferredResponse<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function okResponse(data: FetchOkPayload) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

function errorResponse(data: FetchErrorPayload) {
  return Promise.resolve({
    ok: false,
    json: () => Promise.resolve(data),
  });
}

describe("AiChatPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("submits a question and shows user and assistant messages", async () => {
    const user = userEvent.setup();
    const response = deferredResponse<Awaited<ReturnType<typeof okResponse>>>();
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValueOnce(response.promise);

    render(<AiChatPage />);

    await user.type(
      screen.getByPlaceholderText("询问组合、持仓、风险或调仓建议"),
      "现在组合风险大吗？"
    );
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(screen.getByText("现在组合风险大吗？")).toBeInTheDocument();
    expect(screen.getByText("正在生成回答...")).toBeInTheDocument();

    response.resolve(okResponse({ answer: "当前仓位偏进攻，可继续观察回撤风险。" }));

    await waitFor(() => {
      expect(screen.getByText("当前仓位偏进攻，可继续观察回撤风险。")).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/ai-chat",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: "现在组合风险大吗？",
          messages: [],
        }),
      })
    );
  });

  it("sends only prior page messages in follow-up request body", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(okResponse({ answer: "先关注仓位集中度。" }))
      .mockResolvedValueOnce(okResponse({ answer: "可以先减仓高波动标的。" }));

    render(<AiChatPage />);

    const input = screen.getByPlaceholderText("询问组合、持仓、风险或调仓建议");
    await user.type(input, "先看一下当前风险");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(screen.getByText("先关注仓位集中度。")).toBeInTheDocument();
    });

    await user.type(input, "那接下来怎么调仓？");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(screen.getByText("可以先减仓高波动标的。")).toBeInTheDocument();
    });

    const secondCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(secondCall).toEqual([
      "/api/ai-chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          question: "那接下来怎么调仓？",
          messages: [
            { role: "user", content: "先看一下当前风险" },
            { role: "assistant", content: "先关注仓位集中度。" },
          ],
        }),
      }),
    ]);
  });

  it("shows chinese api error message", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      errorResponse({ error: "模型暂时不可用，请稍后重试" })
    );

    render(<AiChatPage />);

    await user.type(
      screen.getByPlaceholderText("询问组合、持仓、风险或调仓建议"),
      "给我一个调仓建议"
    );
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(screen.getByText("模型暂时不可用，请稍后重试")).toBeInTheDocument();
    });
  });

  it("starts with an empty conversation after remount", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      okResponse({ answer: "先保留现金缓冲。" })
    );

    const view = render(<AiChatPage />);

    await user.type(
      screen.getByPlaceholderText("询问组合、持仓、风险或调仓建议"),
      "要不要留更多现金？"
    );
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(screen.getByText("先保留现金缓冲。")).toBeInTheDocument();
    });

    view.unmount();
    render(<AiChatPage />);

    expect(screen.queryByText("要不要留更多现金？")).not.toBeInTheDocument();
    expect(screen.queryByText("先保留现金缓冲。")).not.toBeInTheDocument();
  });
});
