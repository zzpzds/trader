import { eq, and } from "drizzle-orm";
import { strategies, positions, positionLots, monitoringRuns, notifications } from "@trader/db";
import { fetchPrices } from "./yahoo-fetch.js";
import { createAnalyzer, type PositionInfo } from "./analyze.js";
import type { drizzle } from "drizzle-orm/postgres-js";
import type * as schema from "@trader/db";
import pLimit from "p-limit";

type DbType = ReturnType<typeof drizzle<typeof schema>>;

const CONCURRENCY_LIMIT = 3;

export async function runMonitoringJob(db: DbType, strategyId?: string) {
  const limit = pLimit(CONCURRENCY_LIMIT);
  const analyze = createAnalyzer();

  const strategiesWithLots = await findStrategiesWithLots(db, strategyId);

  if (strategiesWithLots.length === 0) {
    console.log("[monitoring] No strategies with lots found, skipping");
    return;
  }

  const tasks = strategiesWithLots.map((strategy) =>
    limit(() => processStrategy(db, strategy, analyze))
  );

  await Promise.allSettled(tasks);
}

interface StrategyWithLots {
  id: string;
  name: string;
  content: string;
  symbols: string[];
  positions: Array<{
    id: string;
    symbol: string;
    positionLots: Array<{
      shares: number;
      costPrice: string;
      lotDate: string;
      notes: string | null;
    }>;
  }>;
}

async function findStrategiesWithLots(db: DbType, strategyId?: string): Promise<StrategyWithLots[]> {
  const allStrategies = strategyId
    ? await db.query.strategies.findMany({ where: eq(strategies.id, strategyId) })
    : await db.query.strategies.findMany();

  const result: StrategyWithLots[] = [];

  for (const strategy of allStrategies) {
    const pos = await db.query.positions.findMany({
      where: eq(positions.strategyId, strategy.id),
      with: { positionLots: true },
    });

    const posWithLots = pos.filter((p) => p.positionLots.length > 0);
    if (posWithLots.length > 0) {
      result.push({
        id: strategy.id,
        name: strategy.name,
        content: strategy.content,
        symbols: (strategy.symbols as string[]) ?? [],
        positions: posWithLots.map((p) => ({
          id: p.id,
          symbol: p.symbol,
          positionLots: p.positionLots.map((l) => ({
            shares: l.shares,
            costPrice: l.costPrice,
            lotDate: l.lotDate,
            notes: l.notes,
          })),
        })),
      });
    }
  }

  return result;
}

async function processStrategy(
  db: DbType,
  strategy: StrategyWithLots,
  analyze: ReturnType<typeof createAnalyzer>
) {
  const today = new Date().toISOString().slice(0, 10);

  const [run] = await db
    .insert(monitoringRuns)
    .values({
      strategyId: strategy.id,
      runDate: today,
      status: "pending",
    })
    .returning();

  try {
    const symbols = strategy.positions.map((p) => p.symbol);
    const prices = await fetchPrices(symbols, "60d");

    const positionInfos: PositionInfo[] = strategy.positions.map((p) => {
      const totalShares = p.positionLots.reduce((s, l) => s + l.shares, 0);
      const totalCost = p.positionLots.reduce(
        (s, l) => s + l.shares * parseFloat(l.costPrice),
        0
      );
      const avgCost = totalShares > 0 ? totalCost / totalShares : 0;

      return {
        symbol: p.symbol,
        totalShares,
        avgCost,
        lots: p.positionLots.map((l) => ({
          shares: l.shares,
          costPrice: parseFloat(l.costPrice),
          lotDate: l.lotDate,
          notes: l.notes ?? undefined,
        })),
      };
    });

    const priceSnapshots: Record<string, number> = {};
    for (const [symbol, data] of Object.entries(prices)) {
      priceSnapshots[symbol] = data.latest;
    }

    const analysis = await analyze(strategy.name, strategy.content, positionInfos, prices);

    await db
      .update(monitoringRuns)
      .set({
        status: "completed",
        analysis: analysis.analysis,
        hasActionItems: analysis.hasActionItems,
        prices: priceSnapshots,
      })
      .where(eq(monitoringRuns.id, run.id));

    if (analysis.hasActionItems) {
      await db.insert(notifications).values({
        monitoringRunId: run.id,
        title: analysis.actionSummary ?? "Action required",
        content: analysis.analysis.slice(0, 500),
        isRead: false,
      });
    }

    console.log(`[monitoring] Strategy ${strategy.name}: completed, actionItems=${analysis.hasActionItems}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(monitoringRuns)
      .set({ status: "failed", error: message })
      .where(eq(monitoringRuns.id, run.id));
    console.error(`[monitoring] Strategy ${strategy.name}: failed - ${message}`);
  }
}
