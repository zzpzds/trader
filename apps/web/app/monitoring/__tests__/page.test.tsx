// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import MonitoringPage from "../page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("runId=run-2"),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange, value }: any) => (
    <select value={value} onChange={(e) => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: ({ children }: any) => <>{children}</>,
}));

function mockFetch(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

const sampleRuns = [
  {
    id: "run-1",
    strategyId: "strat-1",
    strategyName: "QQQ动量",
    runDate: "2026-05-20",
    status: "completed",
    analysis: "## 分析\n市场正常",
    hasActionItems: false,
    error: null,
    createdAt: "2026-05-20T02:00:00Z",
  },
  {
    id: "run-2",
    strategyId: "strat-1",
    strategyName: "QQQ动量",
    runDate: "2026-05-21",
    status: "completed",
    analysis: "## 分析\n建议减仓",
    hasActionItems: true,
    error: null,
    createdAt: "2026-05-21T02:00:00Z",
  },
];

describe("MonitoringPage with runId param", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/strategies")) return mockFetch([]);
      return mockFetch(sampleRuns);
    });
  });

  it("auto-expands the run matching runId search param", async () => {
    render(<MonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText("建议减仓")).toBeInTheDocument();
    });
  });
});
