import { lt, sql } from "drizzle-orm";
import { newsSummaries } from "@trader/db";
import { tavilyFetch } from "./tavily-fetch.js";
import { summarizeNews } from "./summarize.js";
import pLimit from "p-limit";
const CONCURRENCY_LIMIT = 3;
const RETENTION_DAYS = 7;
const DEFAULT_INTER_LLM_DELAY_MS = 45_000;
// Serialize all LLM calls across strategies. The upstream Anthropic gateway
// rate-limits aggressively per-minute, so we both serialize and pace.
const llmLimit = pLimit(1);
function todayUtc() {
    return new Date().toISOString().slice(0, 10);
}
function cutoffDate() {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - RETENTION_DAYS);
    return d.toISOString().slice(0, 10);
}
export async function runNewsJob(db, opts = {}) {
    const interLlmDelayMs = opts.interLlmDelayMs ?? DEFAULT_INTER_LLM_DELAY_MS;
    const today = todayUtc();
    await db.delete(newsSummaries).where(lt(newsSummaries.summaryDate, cutoffDate()));
    const allStrategies = await db.query.strategies.findMany();
    if (allStrategies.length === 0) {
        console.log("[news] no strategies found, skipping");
        return;
    }
    const limit = pLimit(CONCURRENCY_LIMIT);
    const tasks = allStrategies.map((strategy, idx) => limit(() => processStrategy(db, strategy, today, {
        interLlmDelayMs,
        isLast: idx === allStrategies.length - 1,
    })));
    await Promise.allSettled(tasks);
    console.log(`[news] job completed for ${today}`);
}
async function processStrategy(db, strategy, today, pacing) {
    const symbols = strategy.symbols ?? [];
    const queries = [
        ...symbols.map((s) => `${s} stock news`),
        `${strategy.name} investing news`,
    ];
    const perQuery = await Promise.all(queries.map(async (q) => {
        try {
            return await tavilyFetch(q);
        }
        catch {
            return [];
        }
    }));
    const seen = new Set();
    const articles = [];
    for (const list of perQuery) {
        for (const a of list) {
            if (seen.has(a.url))
                continue;
            seen.add(a.url);
            articles.push(a);
        }
    }
    let content;
    try {
        content = await llmLimit(async () => {
            try {
                return await summarizeNews(strategy.name, strategy.content, articles);
            }
            finally {
                if (!pacing.isLast && pacing.interLlmDelayMs > 0) {
                    await new Promise((r) => setTimeout(r, pacing.interLlmDelayMs));
                }
            }
        });
    }
    catch (err) {
        console.error(`[news] ${strategy.name} summarize failed (skipping DB write):`, err instanceof Error ? err.message : String(err));
        return;
    }
    try {
        await db
            .insert(newsSummaries)
            .values({
            strategyId: strategy.id,
            summaryDate: today,
            content,
            rawArticles: articles,
        })
            .onConflictDoUpdate({
            target: [newsSummaries.strategyId, newsSummaries.summaryDate],
            set: {
                content: sql `excluded.content`,
                rawArticles: sql `excluded.raw_articles`,
            },
        });
        console.log(`[news] ${strategy.name}: summary saved for ${today}`);
    }
    catch (err) {
        console.error(`[news] ${strategy.name} DB write failed:`, err instanceof Error ? err.message : String(err));
    }
}
