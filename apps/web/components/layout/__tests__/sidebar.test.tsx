// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Sidebar } from "../sidebar";

const mockPathname = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: (string | undefined | null | false)[]) => args.filter(Boolean).join(" "),
}));

function mockFetchResponse(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

describe("Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    mockPathname.mockReturnValue("/strategies");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows notification menu item", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ unreadCount: 0 })
    );

    render(<Sidebar />);

    await waitFor(() => {
      expect(screen.getByText("通知")).toBeInTheDocument();
    });
  });

  it("shows unread badge when unreadCount > 0", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ unreadCount: 3 })
    );

    render(<Sidebar />);

    await waitFor(() => {
      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });

  it("hides unread badge when unreadCount is 0", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ unreadCount: 0 })
    );

    render(<Sidebar />);

    await waitFor(() => {
      expect(screen.getByText("通知")).toBeInTheDocument();
    });
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("does not render old NotificationPanel bell dropdown", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ unreadCount: 0 })
    );

    render(<Sidebar />);

    await waitFor(() => {
      expect(screen.getByText("通知")).toBeInTheDocument();
    });
    // Old NotificationPanel was a button with aria-label="通知"
    const bellButton = screen.queryByRole("button", { name: /通知/ });
    expect(bellButton).not.toBeInTheDocument();
  });

  it("renders all four menu items", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ unreadCount: 0 })
    );

    render(<Sidebar />);

    await waitFor(() => {
      expect(screen.getByText("通知")).toBeInTheDocument();
    });

    const links = screen.getAllByRole("link");
    const labels = links.map((el) => el.textContent?.trim());
    expect(labels).toEqual(
      expect.arrayContaining(["策略库", "持仓管理", "监控中心", "通知"])
    );
  });
});