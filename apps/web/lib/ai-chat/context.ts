import { desc, eq, inArray, or } from "drizzle-orm";
import {
  memories,
  priceSnapshots,
  type MemoryRow,
  type PositionLotRow,
  type PositionRow,
  type PriceSnapshotRow,
  type StrategyRow,
} from "@trader/db";
import { db } from "@/lib/db";
import { replayPosition, type Txn, type TxnType } from "@/lib/pnl";

const STRATEGY_LIMIT = 20;
const STRATEGY_CONTENT_LIMIT = 1200;
const PRICES_PER_SYMBOL_LIMIT = 10;
const MEMORY_LIMIT = 12;
const MEMORY_CONTENT_LIMIT = 6000;
const FIXED_PRICE_LIMITATION = "价格来自系统已有快照，不保证实时。";

type RecentPriceRow = Pick<PriceSnapshotRow, "symbol" | "date" | "close">;

export interface AiChatRepository {
  listStrategies(): Promise<StrategyRow[]>;
  listPositions(): Promise<PositionRow[]>;
  listLots(): Promise<PositionLotRow[]>;
  listRecentPrices(symbols: string[]): Promise<Record<string, RecentPriceRow[]>>;
  listMemories(args: {
    symbols: string[];
    strategyIds: string[];
  }): Promise<MemoryRow[]>;
}

export interface PortfolioChatContext {
  generatedAt: string;
  strategies: Array<{
    id: string;
    name: string;
    symbols: string[];
    content: string;
  }>;
  positions: Array<{
    id: string;
    strategyId: string | null;
    strategyName: string | null;
    symbol: string;
    referencePrice: number | null;
    totalShares: number;
    averageCost: number;
    latestPrice: number | null;
    unrealizedPnl: number | null;
  }>;
  prices: Array<{
    symbol: string;
    latestClose: number | null;
    recentCloses: Array<{ date: string; close: number }>;
  }>;
  memories: Array<{
    id: string;
    title: string;
    content: string;
    label: string;
    pinned: boolean;
    updatedAt: string;
  }>;
  limitations: string[];
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function buildMemoryLabel(
  memory: MemoryRow,
  strategyNameById: Map<string, string>
): string {
  const parts = ["背景"];
  const kindLabel =
    memory.kind === "context"
      ? "背景"
      : memory.kind === "lesson"
        ? "复盘"
        : memory.kind === "idea"
          ? "想法"
          : "笔记";
  parts.push(kindLabel);
  if (memory.symbol) parts.push(memory.symbol);
  if (memory.strategyId) {
    const strategyName = strategyNameById.get(memory.strategyId);
    if (strategyName) parts.push(strategyName);
  }
  return parts.join(" / ");
}

function buildMemoryScore(
  memory: MemoryRow,
  symbols: Set<string>,
  strategyIds: Set<string>
): number {
  let score = 0;
  if (memory.pinned) score += 10_000_000_000_000;
  if (memory.symbol && symbols.has(memory.symbol)) score += 1_000_000_000_000;
  if (memory.strategyId && strategyIds.has(memory.strategyId)) score += 100_000_000_000;
  score += new Date(memory.updatedAt).getTime();
  return score;
}

export function createDbAiChatRepository(): AiChatRepository {
  return {
    async listStrategies() {
      return db.query.strategies.findMany({
        orderBy: (table, { desc: descFn }) => [descFn(table.updatedAt)],
        limit: STRATEGY_LIMIT,
      });
    },
    async listPositions() {
      return db.query.positions.findMany({
        orderBy: (table, { desc: descFn }) => [descFn(table.updatedAt)],
      });
    },
    async listLots() {
      return db.query.positionLots.findMany({
        orderBy: (table, { asc }) => [asc(table.lotDate), asc(table.createdAt)],
      });
    },
    async listRecentPrices(symbols) {
      if (symbols.length === 0) return {};

      const rows = await db
        .select({
          symbol: priceSnapshots.symbol,
          date: priceSnapshots.date,
          close: priceSnapshots.close,
        })
        .from(priceSnapshots)
        .where(inArray(priceSnapshots.symbol, symbols))
        .orderBy(priceSnapshots.symbol, desc(priceSnapshots.date));

      const grouped: Record<string, RecentPriceRow[]> = {};
      for (const row of rows) {
        const bucket = grouped[row.symbol] ?? [];
        if (bucket.length < PRICES_PER_SYMBOL_LIMIT) {
          bucket.push(row);
          grouped[row.symbol] = bucket;
        }
      }
      return grouped;
    },
    async listMemories({ symbols, strategyIds }) {
      const filters = [];
      filters.push(eq(memories.pinned, true));
      if (symbols.length > 0) filters.push(inArray(memories.symbol, symbols));
      if (strategyIds.length > 0) filters.push(inArray(memories.strategyId, strategyIds));

      return db.query.memories.findMany({
        where: or(...filters),
        orderBy: (table, { desc: descFn }) => [descFn(table.pinned), descFn(table.updatedAt)],
        limit: 48,
      });
    },
  };
}

export async function buildPortfolioChatContext(args?: {
  repo?: AiChatRepository;
  now?: Date;
}): Promise<PortfolioChatContext> {
  const repo = args?.repo ?? createDbAiChatRepository();
  const now = args?.now ?? new Date();

  const strategyRows = (await repo.listStrategies()).slice(0, STRATEGY_LIMIT);
  const positionRows = await repo.listPositions();
  const lotRows = await repo.listLots();

  const strategyNameById = new Map(strategyRows.map((strategy) => [strategy.id, strategy.name]));
  const lotsByPositionId = new Map<string, PositionLotRow[]>();
  for (const lot of lotRows) {
    const list = lotsByPositionId.get(lot.positionId) ?? [];
    list.push(lot);
    lotsByPositionId.set(lot.positionId, list);
  }

  const strategiesContext = strategyRows.map((strategy) => ({
    id: strategy.id,
    name: strategy.name,
    symbols: strategy.symbols ?? [],
    content: strategy.content.slice(0, STRATEGY_CONTENT_LIMIT),
  }));

  const symbols = new Set<string>();
  for (const strategy of strategiesContext) {
    for (const symbol of strategy.symbols) symbols.add(symbol);
  }

  const positionsContext = positionRows
    .map((position) => {
      const txns: Txn[] = (lotsByPositionId.get(position.id) ?? []).map((lot) => ({
        id: lot.id,
        type: (lot.type as TxnType) ?? "BUY",
        shares: Number.parseFloat(lot.shares),
        price: Number.parseFloat(lot.costPrice),
        date: lot.lotDate,
        createdAt: lot.createdAt,
      }));
      const state = replayPosition(txns);
      if (!(state.heldShares > 0)) return null;
      symbols.add(position.symbol);
      return {
        id: position.id,
        strategyId: position.strategyId,
        strategyName: position.strategyId ? strategyNameById.get(position.strategyId) ?? null : null,
        symbol: position.symbol,
        referencePrice: toNumber(position.referencePrice),
        totalShares: state.heldShares,
        averageCost: state.avgCost,
        latestPrice: null as number | null,
        unrealizedPnl: null as number | null,
      };
    })
    .filter((position): position is NonNullable<typeof position> => position !== null);

  const symbolList = [...symbols];
  const recentPricesBySymbol = await repo.listRecentPrices(symbolList);
  const limitations = [FIXED_PRICE_LIMITATION];

  const pricesContext = symbolList
    .sort((left, right) => left.localeCompare(right))
    .map((symbol) => {
      const recentRows = (recentPricesBySymbol[symbol] ?? []).slice(0, PRICES_PER_SYMBOL_LIMIT);
      const recentCloses = recentRows
        .map((row) => ({
          date:
            typeof row.date === "string"
              ? row.date
              : row.date instanceof Date
                ? row.date.toISOString().slice(0, 10)
                : String(row.date),
          close: toNumber(row.close) ?? 0,
        }))
        .filter((row) => Number.isFinite(row.close));
      const latestClose = recentCloses[0]?.close ?? null;
      return {
        symbol,
        latestClose,
        recentCloses,
      };
    });

  const priceBySymbol = new Map(pricesContext.map((price) => [price.symbol, price.latestClose]));
  for (const position of positionsContext) {
    const latestPrice = priceBySymbol.get(position.symbol) ?? null;
    position.latestPrice = latestPrice;
    position.unrealizedPnl =
      latestPrice == null ? null : latestPrice * position.totalShares - position.averageCost * position.totalShares;
    if (latestPrice == null) {
      limitations.push(`${position.symbol} 缺少最新可用价格快照`);
    }
  }

  const relevantStrategyIds = [
    ...new Set([
      ...strategiesContext.map((strategy) => strategy.id),
      ...positionsContext.flatMap((position) => (position.strategyId ? [position.strategyId] : [])),
    ]),
  ];
  const memoryRows = await repo.listMemories({
    symbols: symbolList,
    strategyIds: relevantStrategyIds,
  });
  const relevantSymbols = new Set(symbolList);
  const relevantStrategies = new Set(relevantStrategyIds);
  const sortedMemories = [...memoryRows].sort(
    (left, right) =>
      buildMemoryScore(right, relevantSymbols, relevantStrategies) -
      buildMemoryScore(left, relevantSymbols, relevantStrategies)
  );

  const memoriesContext: PortfolioChatContext["memories"] = [];
  let totalMemoryChars = 0;
  for (const memory of sortedMemories) {
    if (memoriesContext.length >= MEMORY_LIMIT) break;
    if (totalMemoryChars + memory.content.length > MEMORY_CONTENT_LIMIT) continue;
    memoriesContext.push({
      id: memory.id,
      title: memory.title,
      content: memory.content,
      label: buildMemoryLabel(memory, strategyNameById),
      pinned: memory.pinned,
      updatedAt: normalizeDate(memory.updatedAt),
    });
    totalMemoryChars += memory.content.length;
  }

  return {
    generatedAt: now.toISOString(),
    strategies: strategiesContext,
    positions: positionsContext,
    prices: pricesContext,
    memories: memoriesContext,
    limitations: [...new Set(limitations)],
  };
}
