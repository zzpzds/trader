// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StrategyDetailPage from "../page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ id: "strat-1" }),
}));

const baseStrategy = {
  id: "strat-1",
  name: "QQQ动量策略",
  symbols: ["QQQ"],
  content: "## 策略描述",
  script: "print('hello')",
};

function mockFetch(strategyData = baseStrategy) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("/api/strategies/strat-1/positions"))
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    if (url.includes("/api/strategies/strat-1"))
      return Promise.resolve({ ok: true, json: () => Promise.resolve(strategyData) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  });
}

describe("StrategyDetailPage rename", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch();
  });

  it("shows the Edit2 icon next to the strategy name", async () => {
    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));
    expect(screen.getByRole("button", { name: /rename/i })).toBeInTheDocument();
  });

  it("clicking Edit2 replaces h1 with a focused input", async () => {
    const user = userEvent.setup();
    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));

    await user.click(screen.getByRole("button", { name: /rename/i }));

    const input = screen.getByRole("textbox", { name: /strategy name/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("QQQ动量策略");
    expect(screen.queryByRole("heading", { name: "QQQ动量策略" })).not.toBeInTheDocument();
  });

  it("pressing Enter saves the new name via PUT", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "PUT")
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...baseStrategy, name: "新名称" }),
        });
      if (url.includes("/api/strategies/strat-1/positions"))
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(baseStrategy) });
    });

    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));

    await user.click(screen.getByRole("button", { name: /rename/i }));
    const input = screen.getByRole("textbox", { name: /strategy name/i });
    await user.clear(input);
    await user.type(input, "新名称");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/strategies/strat-1",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ name: "新名称" }),
        })
      );
    });

    await waitFor(() => screen.getByRole("heading", { name: "新名称" }));
  });

  it("pressing Esc cancels without saving", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch();
    global.fetch = fetchMock;

    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));

    await user.click(screen.getByRole("button", { name: /rename/i }));
    const input = screen.getByRole("textbox", { name: /strategy name/i });
    await user.clear(input);
    await user.type(input, "临时名称");
    await user.keyboard("{Escape}");

    expect(screen.getByRole("heading", { name: "QQQ动量策略" })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    const putCalls = fetchMock.mock.calls.filter(
      ([, opts]: [string, RequestInit?]) => opts?.method === "PUT"
    );
    expect(putCalls).toHaveLength(0);
  });
});
