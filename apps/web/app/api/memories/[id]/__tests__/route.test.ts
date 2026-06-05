// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindFirst, mockUpdateReturning, mockDeleteReturning } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockUpdateReturning: vi.fn(),
  mockDeleteReturning: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: { memories: { findFirst: mockFindFirst } },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ returning: mockUpdateReturning })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({ returning: mockDeleteReturning })),
    })),
  },
}));

import { GET, PATCH, DELETE } from "../route";

const makeCtx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/memories/:id", () => {
  beforeEach(() => mockFindFirst.mockReset());

  it("returns 404 when not found", async () => {
    mockFindFirst.mockResolvedValueOnce(undefined);
    const res = await GET(new Request("http://localhost"), makeCtx("missing"));
    expect(res.status).toBe(404);
  });

  it("returns the row when found", async () => {
    mockFindFirst.mockResolvedValueOnce({ id: "m1", title: "t" });
    const res = await GET(new Request("http://localhost"), makeCtx("m1"));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("m1");
  });
});

describe("PATCH /api/memories/:id", () => {
  beforeEach(() => mockUpdateReturning.mockReset());

  it("updates allowed fields", async () => {
    mockUpdateReturning.mockResolvedValueOnce([
      { id: "m1", title: "new title" },
    ]);
    const res = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ title: "new title", pinned: true }),
        headers: { "Content-Type": "application/json" },
      }),
      makeCtx("m1")
    );
    expect(res.status).toBe(200);
  });

  it("returns 404 when row missing", async () => {
    mockUpdateReturning.mockResolvedValueOnce([]);
    const res = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ title: "x" }),
        headers: { "Content-Type": "application/json" },
      }),
      makeCtx("missing")
    );
    expect(res.status).toBe(404);
  });

  it("rejects invalid kind", async () => {
    const res = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ kind: "bogus" }),
        headers: { "Content-Type": "application/json" },
      }),
      makeCtx("m1")
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/memories/:id", () => {
  beforeEach(() => mockDeleteReturning.mockReset());

  it("returns 204 on success", async () => {
    mockDeleteReturning.mockResolvedValueOnce([{ id: "m1" }]);
    const res = await DELETE(new Request("http://localhost"), makeCtx("m1"));
    expect(res.status).toBe(204);
  });

  it("returns 404 when not found", async () => {
    mockDeleteReturning.mockResolvedValueOnce([]);
    const res = await DELETE(new Request("http://localhost"), makeCtx("missing"));
    expect(res.status).toBe(404);
  });
});
