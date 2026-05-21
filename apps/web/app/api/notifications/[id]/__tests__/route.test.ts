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
    id: { name: "id" },
  },
}));

import { DELETE } from "../route";

describe("DELETE /api/notifications/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes a single notification by id", async () => {
    const whereMock = vi.fn().mockResolvedValueOnce(undefined);
    mockDelete.mockReturnValue({ where: whereMock });

    const req = new Request("http://localhost/api/notifications/n1");
    const res = await DELETE(req, { params: Promise.resolve({ id: "n1" }) });
    const data = await res.json();

    expect(mockDelete).toHaveBeenCalled();
    expect(whereMock).toHaveBeenCalled();
    expect(data.ok).toBe(true);
  });
});
