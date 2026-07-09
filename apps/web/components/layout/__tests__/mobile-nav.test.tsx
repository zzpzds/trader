// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MobileNav } from "../mobile-nav";

const mockPathname = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

function mockFetchResponse(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

describe("MobileNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    mockPathname.mockReturnValue("/strategies");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders all four tab items", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ unreadCount: 0 })
    );

    render(<MobileNav />);

    await waitFor(() => {
      expect(screen.getByText("策略库")).toBeInTheDocument();
    });
    expect(screen.getByText("持仓")).toBeInTheDocument();
    expect(screen.getByText("监控")).toBeInTheDocument();
    expect(screen.getByText("通知")).toBeInTheDocument();
  });

  it("highlights the active tab based on pathname", async () => {
    mockPathname.mockReturnValue("/positions");
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ unreadCount: 0 })
    );

    render(<MobileNav />);

    await waitFor(() => {
      const activeTab = screen.getByText("持仓").closest("a");
      expect(activeTab?.className).toContain("text-primary");
    });
  });

  it("shows unread badge on notification tab", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ unreadCount: 5 })
    );

    render(<MobileNav />);

    await waitFor(() => {
      expect(screen.getByText("5")).toBeInTheDocument();
    });
  });

  it("does not show badge when unreadCount is 0", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ unreadCount: 0 })
    );

    render(<MobileNav />);

    await waitFor(() => {
      expect(screen.getByText("通知")).toBeInTheDocument();
    });
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("renders ai chat tab with short mobile label and stable layout", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ unreadCount: 0 })
    );

    render(<MobileNav />);

    await waitFor(() => {
      expect(screen.getByText("问答")).toBeInTheDocument();
    });

    const aiChatTab = screen.getByRole("link", { name: /问答/i });
    expect(aiChatTab).toHaveAttribute("href", "/ai-chat");
    expect(aiChatTab).toHaveClass("whitespace-nowrap");
    expect(screen.queryByText("组合问答")).not.toBeInTheDocument();
  });
});
