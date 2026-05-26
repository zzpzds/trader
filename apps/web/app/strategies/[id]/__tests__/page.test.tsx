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

describe("StrategyDetailPage description editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch();
  });

  it("description tab shows an edit button", async () => {
    const user = userEvent.setup();
    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));
    await user.click(screen.getByRole("button", { name: "策略描述" }));
    expect(screen.getByRole("button", { name: /edit description/i })).toBeInTheDocument();
  });

  it("clicking edit shows a textarea prefilled with current content", async () => {
    const user = userEvent.setup();
    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));
    await user.click(screen.getByRole("button", { name: "策略描述" }));
    await user.click(screen.getByRole("button", { name: /edit description/i }));
    const textarea = screen.getByRole("textbox", { name: /description input/i });
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue("## 策略描述");
  });

  it("saving calls PUT with updated content and switches back to preview", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "PUT")
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...baseStrategy, content: "## 新描述" }),
        });
      if (url.includes("/api/strategies/strat-1/positions"))
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(baseStrategy) });
    });

    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));
    await user.click(screen.getByRole("button", { name: "策略描述" }));
    await user.click(screen.getByRole("button", { name: /edit description/i }));
    const textarea = screen.getByRole("textbox", { name: /description input/i });
    await user.clear(textarea);
    await user.type(textarea, "## 新描述");
    await user.click(screen.getByRole("button", { name: /^保存$/ }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/strategies/strat-1",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ content: "## 新描述" }),
        })
      );
    });
    expect(screen.queryByRole("textbox", { name: /description input/i })).not.toBeInTheDocument();
  });

  it("cancel restores preview without PUT call", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch();
    global.fetch = fetchMock;

    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));
    await user.click(screen.getByRole("button", { name: "策略描述" }));
    await user.click(screen.getByRole("button", { name: /edit description/i }));
    await user.click(screen.getByRole("button", { name: /取消/ }));

    expect(screen.queryByRole("textbox", { name: /description input/i })).not.toBeInTheDocument();
    const putCalls = fetchMock.mock.calls.filter(
      ([, opts]: [string, RequestInit?]) => opts?.method === "PUT"
    );
    expect(putCalls).toHaveLength(0);
  });
});

describe("StrategyDetailPage script re-parse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch();
  });

  it("script tab shows a re-parse button", async () => {
    const user = userEvent.setup();
    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));
    await user.click(screen.getByRole("button", { name: "原始脚本" }));
    expect(screen.getByRole("button", { name: /re-parse script/i })).toBeInTheDocument();
  });

  it("clicking re-parse shows the input panel with paste tab", async () => {
    const user = userEvent.setup();
    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));
    await user.click(screen.getByRole("button", { name: "原始脚本" }));
    await user.click(screen.getByRole("button", { name: /re-parse script/i }));
    expect(screen.getByText("解析脚本")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/粘贴新版/i)).toBeInTheDocument();
  });

  it("parsing calls POST /api/strategies/parse and shows preview", async () => {
    const user = userEvent.setup();
    const parsedResult = { name: "新策略", symbols: ["SPY"], content: "## 新策略描述" };
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes("/api/strategies/parse"))
        return Promise.resolve({ ok: true, json: () => Promise.resolve(parsedResult) });
      if (url.includes("/api/strategies/strat-1/positions"))
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(baseStrategy) });
    });

    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));
    await user.click(screen.getByRole("button", { name: "原始脚本" }));
    await user.click(screen.getByRole("button", { name: /re-parse script/i }));
    await user.type(screen.getByPlaceholderText(/粘贴新版/i), "print('new')");
    await user.click(screen.getByText("解析脚本"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/strategies/parse",
        expect.objectContaining({ method: "POST" })
      );
    });
    await waitFor(() => screen.getByText("确认更新"));
    expect(screen.getByDisplayValue("新策略")).toBeInTheDocument();
  });

  it("confirming PUT calls with all fields and switches to description tab", async () => {
    const user = userEvent.setup();
    const parsedResult = { name: "新策略", symbols: ["SPY"], content: "## 新策略描述" };
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes("/api/strategies/parse"))
        return Promise.resolve({ ok: true, json: () => Promise.resolve(parsedResult) });
      if (opts?.method === "PUT")
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...baseStrategy, ...parsedResult }),
        });
      if (url.includes("/api/strategies/strat-1/positions"))
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(baseStrategy) });
    });

    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));
    await user.click(screen.getByRole("button", { name: "原始脚本" }));
    await user.click(screen.getByRole("button", { name: /re-parse script/i }));
    await user.type(screen.getByPlaceholderText(/粘贴新版/i), "print('new')");
    await user.click(screen.getByText("解析脚本"));
    await waitFor(() => screen.getByText("确认更新"));
    await user.click(screen.getByText("确认更新"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/strategies/strat-1",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            name: "新策略",
            symbols: ["SPY"],
            content: "## 新策略描述",
            script: "print('new')",
          }),
        })
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("确认更新")).not.toBeInTheDocument();
    });
  });

  it("cancel hides the panel without PUT call", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch();
    global.fetch = fetchMock;

    render(<StrategyDetailPage />);
    await waitFor(() => screen.getByText("QQQ动量策略"));
    await user.click(screen.getByRole("button", { name: "原始脚本" }));
    await user.click(screen.getByRole("button", { name: /re-parse script/i }));
    await user.click(screen.getByRole("button", { name: /取消$/ }));

    expect(screen.queryByText("解析脚本")).not.toBeInTheDocument();
    const putCalls = fetchMock.mock.calls.filter(
      ([, opts]: [string, RequestInit?]) => opts?.method === "PUT"
    );
    expect(putCalls).toHaveLength(0);
  });
});
