// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindMany } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const subquery = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
  };
  return {
    db: {
      query: {
        notifications: { findMany: mockFindMany },
      },
      select: vi.fn(() => subquery),
    },
  };
});

import { GET } from "../route";

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/notifications");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url);
}

const sampleNotification = {
  id: "n1",
  monitoringRunId: "run1",
  title: "建议减仓",
  content: "分析摘要",
  isRead: false,
  createdAt: new Date("2026-05-21T02:00:00Z"),
  monitoringRun: {
    strategyId: "strat-1",
    hasActionItems: true,
    strategy: { name: "QQQ动量策略" },
  },
};

const readNotification = {
  id: "n2",
  monitoringRunId: "run2",
  title: "持仓正常",
  content: "一切正常",
  isRead: true,
  createdAt: new Date("2026-05-20T02:00:00Z"),
  monitoringRun: {
    strategyId: "strat-2",
    hasActionItems: false,
    strategy: { name: "SPY趋势策略" },
  },
};

describe("GET /api/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns notifications with strategyId and strategyName", async () => {
    mockFindMany.mockResolvedValueOnce([sampleNotification]);

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(data.notifications[0]).toMatchObject({
      id: "n1",
      monitoringRunId: "run1",
      strategyId: "strat-1",
      strategyName: "QQQ动量策略",
      title: "建议减仓",
      isRead: false,
    });
  });

  it("computes stats from returned notifications", async () => {
    mockFindMany.mockResolvedValueOnce([sampleNotification, readNotification]);

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(data.unreadCount).toBe(1);
    expect(data.todayCount).toBe(1);
    expect(data.weekActionCount).toBe(1);
  });

  it("passes where SQL when status=unread", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    await GET(makeRequest({ status: "unread" }));

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.anything() })
    );
    const arg = mockFindMany.mock.calls[0][0];
    expect(arg.where).toBeDefined();
  });

  it("passes where SQL when strategyId provided", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    await GET(makeRequest({ strategyId: "strat-1" }));

    const arg = mockFindMany.mock.calls[0][0];
    expect(arg.where).toBeDefined();
  });

  it("passes undefined where when no filters", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    await GET(makeRequest());

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined })
    );
  });
});
