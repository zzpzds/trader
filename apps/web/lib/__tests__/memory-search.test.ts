// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildMemoryListQuery } from "../memory-search";

describe("buildMemoryListQuery", () => {
  it("falls back to LIKE when q.length < 2", () => {
    const q = buildMemoryListQuery({ q: "a" });
    expect(q.searchMode).toBe("like");
    expect(q.likePattern).toBe("%a%");
  });

  it("uses pg_trgm when q.length >= 2", () => {
    const q = buildMemoryListQuery({ q: "NVDA" });
    expect(q.searchMode).toBe("trgm");
    expect(q.trgmThreshold).toBe(0.1);
  });

  it("ignores empty q", () => {
    const q = buildMemoryListQuery({});
    expect(q.searchMode).toBe("none");
  });

  it("clamps limit to [1, 100], default 20", () => {
    expect(buildMemoryListQuery({}).limit).toBe(20);
    expect(buildMemoryListQuery({ limit: 200 }).limit).toBe(100);
    expect(buildMemoryListQuery({ limit: 0 }).limit).toBe(1);
  });

  it("preserves filter fields", () => {
    const q = buildMemoryListQuery({
      strategyId: "s1",
      symbol: "AAPL",
      kind: "idea",
      pinned: true,
    });
    expect(q.filters).toMatchObject({
      strategyId: "s1",
      symbol: "AAPL",
      kind: "idea",
      pinned: true,
    });
  });
});
