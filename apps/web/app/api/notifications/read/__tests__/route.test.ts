// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDelete } = vi.hoisted(() => ({
  mockDelete: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    delete: mockDelete,
  },
}));

vi.mock("@trader/db", () => ({
  notifications: {
    isRead: { name: "is_read" },
  },
}));

import { DELETE } from "../route";

describe("DELETE /api/notifications/read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes all read notifications", async () => {
    const whereMock = vi.fn().mockResolvedValueOnce(undefined);
    mockDelete.mockReturnValue({ where: whereMock });

    const res = await DELETE();
    const data = await res.json();

    expect(mockDelete).toHaveBeenCalled();
    expect(whereMock).toHaveBeenCalled();
    expect(data.ok).toBe(true);
  });
});
