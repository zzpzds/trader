// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("tavilyFetch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env.TAVILY_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TAVILY_API_KEY;
  });

  it("returns articles from Tavily API", async () => {
    const { tavilyFetch } = await import("../tavily-fetch.js");
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { title: "ISRG News", url: "https://example.com/1", content: "Intuitive Surgical reports..." },
          { title: "Robot Surgery", url: "https://example.com/2", content: "Da Vinci robot..." },
        ],
      }),
    });

    const articles = await tavilyFetch("ISRG stock news");

    expect(articles).toHaveLength(2);
    expect(articles[0]).toEqual({
      title: "ISRG News",
      url: "https://example.com/1",
      content: "Intuitive Surgical reports...",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("ISRG stock news"),
      })
    );
  });

  it("returns empty array when fetch responds with non-ok status", async () => {
    const { tavilyFetch } = await import("../tavily-fetch.js");
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 429,
    });

    const articles = await tavilyFetch("ISRG stock news");
    expect(articles).toEqual([]);
  });

  it("returns empty array when TAVILY_API_KEY is missing", async () => {
    delete process.env.TAVILY_API_KEY;
    const { tavilyFetch } = await import("../tavily-fetch.js");

    const articles = await tavilyFetch("anything");
    expect(articles).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns empty array when fetch throws", async () => {
    const { tavilyFetch } = await import("../tavily-fetch.js");
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network down"));

    const articles = await tavilyFetch("ISRG");
    expect(articles).toEqual([]);
  });
});
