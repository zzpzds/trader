// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecuteLots, mockExecuteSnaps } = vi.hoisted(() => ({
  mockExecuteLots: vi.fn(),
  mockExecuteSnaps: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    execute: vi.fn().mockImplementation((q) => {
      const text = String(q).toLowerCase();
      if (text.includes("position_lots")) return mockExecuteLots();
      return mockExecuteSnaps();
    }),
  },
}));

import { GET } from "../route";

describe("GET /api/insights", () => {
  beforeEach(() => {
    mockExecuteLots.mockReset();
    mockExecuteSnaps.mockReset();
  });

  it("returns empty result when fewer than 5 closed trades", async () => {
    mockExecuteLots.mockResolvedValueOnce([]);
    mockExecuteSnaps.mockResolvedValueOnce([]);
    const res = await GET(new Request("http://localhost/api/insights"));
    const data = await res.json();
    expect(data.empty).toBe(true);
  });
});
