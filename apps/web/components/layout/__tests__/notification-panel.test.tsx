import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationPanel } from "../notification-panel";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

function mockFetchResponse(data: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve(data),
  });
}

const sampleNotifications = {
  notifications: [
    {
      id: "n1",
      monitoringRunId: "run1",
      title: "QQQ 触发加仓条件",
      content: "根据分析...",
      isRead: false,
      createdAt: "2026-05-18T02:00:00Z",
    },
    {
      id: "n2",
      monitoringRunId: "run2",
      title: "TQQQ 建议减仓",
      content: "风险偏高...",
      isRead: true,
      createdAt: "2026-05-17T02:00:00Z",
    },
  ],
  unreadCount: 1,
};

describe("NotificationPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders bell icon with unread count badge", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse(sampleNotifications)
    );

    render(<NotificationPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText("通知")).toBeInTheDocument();
    });
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("hides badge when unread count is zero", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ notifications: [], unreadCount: 0 })
    );

    render(<NotificationPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText("通知")).toBeInTheDocument();
    });
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("opens dropdown on bell click and shows notification list", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse(sampleNotifications)
    );

    render(<NotificationPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText("通知")).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText("通知"));

    expect(screen.getByText("QQQ 触发加仓条件")).toBeInTheDocument();
    expect(screen.getByText("TQQQ 建议减仓")).toBeInTheDocument();
  });

  it("marks notification as read and navigates on click", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse(sampleNotifications)
    );

    render(<NotificationPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText("通知")).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText("通知"));

    // Mock the mark-as-read call
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ ok: true })
    );

    await user.click(screen.getByText("QQQ 触发加仓条件"));

    expect(global.fetch).toHaveBeenCalledWith("/api/notifications/n1/read", {
      method: "PUT",
    });
    expect(mockPush).toHaveBeenCalledWith("/monitoring");
  });

  it("marks all as read when button clicked", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse(sampleNotifications)
    );

    render(<NotificationPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText("通知")).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText("通知"));

    // Mock the read-all call
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ ok: true })
    );

    await user.click(screen.getByText("全部标记已读"));

    expect(global.fetch).toHaveBeenCalledWith("/api/notifications/read-all", {
      method: "PUT",
    });
  });
});
