import { lt, sql } from "drizzle-orm";
import { strategies, newsSummaries } from "@trader/db";
import { tavilyFetch, type TavilyArticle } from "./tavily-fetch.js";
import { summarizeNews } from "./summarize.js";
import type { drizzle } from "drizzle-orm/postgres-js";
import type * as schema from "@trader/db";
import pLimit from "p-limit";

type DbType = ReturnType<typeof drizzle<typeof schema>>;

const CONCURRENCY_LIMIT = 3;
const RETENTION_DAYS = 7;

// Serialize all LLM calls across strategies. The upstream Anthropic gateway
// rate-limits aggressively per-minute, and bursting 3 concurrent summarize
// requests reliably trips 429. Tavily fetches stay parallel.
const llmLimit = pLimit(1);

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function cutoffDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - RETENTION_DAYS);
  return d.toISOString().slice(0, 10);
}

export async function runNewsJob(db: DbType) {
  const today = todayUtc();

  await db.delete(newsSummaries).where(lt(newsSummaries.summaryDate, cutoffDate()));

  const allStrategies = await db.query.strategies.findMany();
  if (allStrategies.length === 0) {
    console.log("[news] no strategies found, skipping");
    return;
  }

  const limit = pLimit(CONCURRENCY_LIMIT);

  const tasks = allStrategies.map((strategy) =>
    limit(() => processStrategy(db, strategy, today))
  );

  await Promise.allSettled(tasks);
  console.log(`[news] job completed for ${today}`);
}

async function processStrategy(
  db: DbType,
  strategy: { id: string; name: string; content: string; symbols: unknown },
  today: string
) {
  try {
    const symbols = (strategy.symbols as string[] | null) ?? [];
    const queries = [
      ...symbols.map((s) => `${s} stock news`),
      `${strategy.name} investing news`,
    ];

    const perQuery = await Promise.all(
      queries.map(async (q): Promise<TavilyArticle[]> => {
        try {
          return await tavilyFetch(q);
        } catch {
          return [];
        }
      })
    );

    const seen = new Set<string>();
    const articles: TavilyArticle[] = [];
    for (const list of perQuery) {
      for (const a of list) {
        if (seen.has(a.url)) continue;
        seen.add(a.url);
        articles.push(a);
      }
    }

    const content = await llmLimit(() => summarizeNews(strategy.name, strategy.content, articles));

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
          content: sql`excluded.content`,
          rawArticles: sql`excluded.raw_articles`,
        },
      });

    console.log(`[news] ${strategy.name}: summary saved for ${today}`);
  } catch (err) {
    console.error(
      `[news] ${strategy.name} failed:`,
      err instanceof Error ? err.message : String(err)
    );
  }
}
