// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockNewsSummariesFindMany } = vi.hoisted(() => ({
  mockNewsSummariesFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      newsSummaries: { findMany: mockNewsSummariesFindMany },
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ _type: "eq", col, val }),
}));

vi.mock("@trader/db", () => ({
  newsSummaries: { summaryDate: { name: "summary_date" } },
}));

import { GET } from "../route";

describe("GET /api/news", () => {
  beforeEach(() => {
    mockNewsSummariesFindMany.mockReset();
  });

  it("returns summaries for the given date", async () => {
    mockNewsSummariesFindMany.mockResolvedValueOnce([
      {
        strategyId: "strat-1",
        summaryDate: "2026-05-29",
        content: "今日热点摘要",
        strategy: { name: "T1 策略" },
      },
    ]);

    const req = new Request("http://localhost/api/news?date=2026-05-29");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.date).toBe("2026-05-29");
    expect(body.summaries).toHaveLength(1);
    expect(body.summaries[0]).toEqual({
      strategyId: "strat-1",
      strategyName: "T1 策略",
      content: "今日热点摘要",
    });
  });

  it("defaults to today (UTC YYYY-MM-DD) when date param missing", async () => {
    mockNewsSummariesFindMany.mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/news");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.summaries).toEqual([]);
  });

  it("falls back to null strategyName when no joined strategy is present", async () => {
    mockNewsSummariesFindMany.mockResolvedValueOnce([
      {
        strategyId: "orphan",
        summaryDate: "2026-05-29",
        content: "x",
      },
    ]);

    const req = new Request("http://localhost/api/news?date=2026-05-29");
    const res = await GET(req);
    const body = await res.json();
    expect(body.summaries[0].strategyName).toBeNull();
  });
});
