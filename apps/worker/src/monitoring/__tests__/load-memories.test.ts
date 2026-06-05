import { describe, it, expect } from "vitest";
import { mergeAndCapMemories, type RawMemory } from "../load-memories.js";

const NOW = new Date("2026-06-05T00:00:00Z").getTime();

function mk(over: Partial<RawMemory> = {}): RawMemory {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: over.title ?? "T",
    content: over.content ?? "C",
    kind: over.kind ?? "note",
    symbol: over.symbol ?? null,
    pinned: over.pinned ?? false,
    updatedAt: over.updatedAt ?? new Date(NOW),
  };
}

describe("mergeAndCapMemories", () => {
  it("dedupes by id across sources", () => {
    const a = mk({ id: "x", title: "shared" });
    const b = mk({ id: "x", title: "shared" });
    const result = mergeAndCapMemories([a], [b], []);
    expect(result.length).toBe(1);
  });

  it("orders pinned first then by updatedAt desc", () => {
    const old = mk({ id: "1", pinned: false, updatedAt: new Date(NOW - 86400000) });
    const fresh = mk({ id: "2", pinned: false, updatedAt: new Date(NOW) });
    const pinned = mk({ id: "3", pinned: true, updatedAt: new Date(NOW - 200000000) });
    const result = mergeAndCapMemories([old, fresh, pinned], [], []);
    expect(result.map((m) => m.id)).toEqual(["3", "2", "1"]);
  });

  it("caps to 8 entries", () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      mk({ id: `m${i}`, updatedAt: new Date(NOW - i * 1000) })
    );
    const result = mergeAndCapMemories(many, [], []);
    expect(result.length).toBe(8);
  });

  it("truncates contentPreview to 200 chars", () => {
    const long = mk({ id: "x", content: "a".repeat(500) });
    const [r] = mergeAndCapMemories([long], [], []);
    expect(r.contentPreview.length).toBeLessThanOrEqual(200);
  });

  it("respects total 4000 char budget", () => {
    const big = Array.from({ length: 8 }, (_, i) =>
      mk({ id: `m${i}`, content: "a".repeat(800) })
    );
    const result = mergeAndCapMemories(big, [], []);
    const total = result.reduce((s, r) => s + r.contentPreview.length, 0);
    expect(total).toBeLessThanOrEqual(4000);
  });
});
