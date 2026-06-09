export async function tavilyFetch(query) {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
        console.warn("[news] TAVILY_API_KEY not set, skipping search");
        return [];
    }
    try {
        const res = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                api_key: apiKey,
                query,
                search_depth: "basic",
                days: 1,
                max_results: 3,
            }),
        });
        if (!res.ok) {
            console.warn(`[news] Tavily request failed: ${res.status}`);
            return [];
        }
        const data = (await res.json());
        return (data.results ?? []).map((r) => ({
            title: r.title,
            url: r.url,
            content: r.content,
        }));
    }
    catch (err) {
        console.warn("[news] Tavily fetch error:", err instanceof Error ? err.message : String(err));
        return [];
    }
}
