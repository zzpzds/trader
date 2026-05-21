// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import NotificationsPage from "../page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange, value }: any) => (
    <select
      data-testid="strategy-filter"
      value={value}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children, value }: any) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: ({ children }: any) => <>{children}</>,
}));

function mockFetch(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

const sampleNotifications = {
  notifications: [
    {
      id: "n1",
      monitoringRunId: "run1",
      strategyId: "strat-1",
      strategyName: "QQQ动量策略",
      title: "建议减仓",
      content: "根据分析...",
      isRead: false,
      createdAt: "2026-05-21T02:00:00Z",
    },
    {
      id: "n2",
      monitoringRunId: "run2",
      strategyId: "strat-2",
      strategyName: "SPY趋势策略",
      title: "持仓正常",
      content: "一切正常",
      isRead: true,
      createdAt: "2026-05-20T02:00:00Z",
    },
  ],
  unreadCount: 1,
  todayCount: 1,
  weekActionCount: 1,
};

const sampleStrategies = [
  { id: "strat-1", name: "QQQ动量策略" },
  { id: "strat-2", name: "SPY趋势策略" },
];

describe("NotificationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/strategies")) return mockFetch(sampleStrategies);
      return mockFetch(sampleNotifications);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders page title", async () => {
    render(<NotificationsPage />);

    await waitFor(() => {
      expect(screen.getByText("通知")).toBeInTheDocument();
    });
  });

  it("renders stats cards with numbers", async () => {
    render(<NotificationsPage />);

    await waitFor(() => {
      // unreadCount = 1, shown in stats
      expect(screen.getByText("未读通知")).toBeInTheDocument();
    });
  });

  it("renders notification list with titles", async () => {
    render(<NotificationsPage />);

    await waitFor(() => {
      expect(screen.getByText("建议减仓")).toBeInTheDocument();
    });
    expect(screen.getByText("持仓正常")).toBeInTheDocument();
  });

  it("renders strategy name badges", async () => {
    render(<NotificationsPage />);

    await waitFor(() => {
      expect(screen.getAllByText("QQQ动量策略").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText("SPY趋势策略").length).toBeGreaterThanOrEqual(1);
  });

  it("shows unread dot for unread notifications", async () => {
    const { container } = render(<NotificationsPage />);

    await waitFor(() => {
      expect(screen.getByText("建议减仓")).toBeInTheDocument();
    });

    const unreadDots = container.querySelectorAll(".rounded-full.bg-primary");
    expect(unreadDots.length).toBeGreaterThanOrEqual(1);
  });

  it("shows empty state when no notifications", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes("/api/strategies")) return mockFetch([]);
      return mockFetch({
        notifications: [],
        unreadCount: 0,
        todayCount: 0,
        weekActionCount: 0,
      });
    });

    render(<NotificationsPage />);

    await waitFor(() => {
      expect(screen.getByText("暂无通知")).toBeInTheDocument();
    });
  });

  it("renders filter tabs", async () => {
    render(<NotificationsPage />);

    await waitFor(() => {
      expect(screen.getByText("全部")).toBeInTheDocument();
    });
    expect(screen.getByText("未读")).toBeInTheDocument();
    expect(screen.getByText("已读")).toBeInTheDocument();
  });

  it("renders batch action buttons", async () => {
    render(<NotificationsPage />);

    await waitFor(() => {
      expect(screen.getByText("全部标记已读")).toBeInTheDocument();
    });
    expect(screen.getByText("删除已读")).toBeInTheDocument();
  });
});