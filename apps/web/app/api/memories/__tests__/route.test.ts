// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecute, mockInsertReturning } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockInsertReturning: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    execute: mockExecute,
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: mockInsertReturning,
      })),
    })),
  },
}));

import { GET, POST } from "../route";

function makeReq(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/memories");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url);
}

describe("GET /api/memories", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("returns rows from db.execute", async () => {
    mockExecute.mockResolvedValueOnce([
      { id: "m1", title: "t", content: "c", kind: "note", pinned: false },
    ]);
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("m1");
  });

  it("invokes db.execute with q filter (trigram path)", async () => {
    mockExecute.mockResolvedValueOnce([]);
    const res = await GET(makeReq({ q: "NVDA" }));
    expect(res.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/memories", () => {
  beforeEach(() => {
    mockInsertReturning.mockReset();
  });

  it("creates memory with required fields", async () => {
    mockInsertReturning.mockResolvedValueOnce([
      { id: "m1", title: "T", content: "C", kind: "note" },
    ]);
    const res = await POST(
      new Request("http://localhost/api/memories", {
        method: "POST",
        body: JSON.stringify({ title: "T", content: "C" }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe("m1");
  });

  it("rejects when title missing", async () => {
    const res = await POST(
      new Request("http://localhost/api/memories", {
        method: "POST",
        body: JSON.stringify({ content: "C" }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects when content missing", async () => {
    const res = await POST(
      new Request("http://localhost/api/memories", {
        method: "POST",
        body: JSON.stringify({ title: "T" }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
  });
});
