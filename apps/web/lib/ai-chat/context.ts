import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  memories,
  positionLots,
  positions,
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
const POSITION_CONTEXT_LIMIT = 50;
const PRICES_PER_SYMBOL_LIMIT = 10;
const MEMORY_LIMIT = 12;
const MEMORY_CONTENT_LIMIT = 6000;
const PINNED_MEMORY_BUCKET_LIMIT = 12;
const SYMBOL_MEMORY_BUCKET_LIMIT = 12;
const STRATEGY_MEMORY_BUCKET_LIMIT = 12;
const GLOBAL_MEMORY_BUCKET_LIMIT = 12;
const FIXED_PRICE_LIMITATION = "价格来自系统已有快照，不保证实时。";
const INVALID_PRICE_LIMITATION = "存在无效价格快照，已跳过部分价格数据。";

type RecentPriceRow = Pick<PriceSnapshotRow, "symbol" | "date" | "close">;

export type OpenPositionCandidateRow = Pick<
  PositionRow,
  "id" | "strategyId" | "symbol" | "referencePrice" | "updatedAt"
>;

export interface AiChatRepository {
  listStrategies(): Promise<StrategyRow[]>;
  listOpenPositionCandidates(args: { limit: number }): Promise<OpenPositionCandidateRow[]>;
  listLotsForPositions(positionIds: string[]): Promise<PositionLotRow[]>;
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

function formatPriceDate(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
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

function normalizeTimestamp(value: Date | string): number {
  return new Date(value).getTime();
}

function mergeMemoryBuckets(buckets: MemoryRow[][]): MemoryRow[] {
  const merged: MemoryRow[] = [];
  const seen = new Set<string>();

  for (const bucket of buckets) {
    for (const memory of bucket) {
      if (seen.has(memory.id)) continue;
      seen.add(memory.id);
      merged.push(memory);
    }
  }

  return merged;
}

function sortMemoriesByRecency(memories: MemoryRow[]): MemoryRow[] {
  return [...memories].sort(
    (left, right) => normalizeTimestamp(right.updatedAt) - normalizeTimestamp(left.updatedAt)
  );
}

function selectMemoriesByBucket(
  memoryRows: MemoryRow[],
  relevantSymbols: Set<string>,
  relevantStrategies: Set<string>
): MemoryRow[] {
  const pinned = sortMemoriesByRecency(memoryRows.filter((memory) => memory.pinned));
  const symbol = sortMemoriesByRecency(
    memoryRows.filter(
      (memory) => !memory.pinned && !!memory.symbol && relevantSymbols.has(memory.symbol)
    )
  );
  const strategy = sortMemoriesByRecency(
    memoryRows.filter(
      (memory) =>
        !memory.pinned &&
        !memory.symbol &&
        !!memory.strategyId &&
        relevantStrategies.has(memory.strategyId)
    )
  );
  const recentGlobal = sortMemoriesByRecency(
    memoryRows.filter(
      (memory) => !memory.pinned && memory.symbol == null && memory.strategyId == null
    )
  );
  const fallback = sortMemoriesByRecency(
    memoryRows.filter(
      (memory) =>
        !memory.pinned &&
        !(memory.symbol && relevantSymbols.has(memory.symbol)) &&
        !(memory.strategyId && relevantStrategies.has(memory.strategyId)) &&
        !(memory.symbol == null && memory.strategyId == null)
    )
  );

  return mergeMemoryBuckets([pinned, symbol, strategy, recentGlobal, fallback]);
}

export function createDbAiChatRepository(): AiChatRepository {
  return {
    async listStrategies() {
      return db.query.strategies.findMany({
        orderBy: (table, { desc: descFn }) => [descFn(table.updatedAt)],
        limit: STRATEGY_LIMIT,
      });
    },
    async listOpenPositionCandidates({ limit }) {
      const netShares = sql<string>`
        sum(
          case
            when ${positionLots.type} = 'BUY' then ${positionLots.shares}
            else -${positionLots.shares}
          end
        )
      `;
      return db
        .select({
          id: positions.id,
          strategyId: positions.strategyId,
          symbol: positions.symbol,
          referencePrice: positions.referencePrice,
          updatedAt: positions.updatedAt,
        })
        .from(positions)
        .innerJoin(positionLots, eq(positionLots.positionId, positions.id))
        .groupBy(
          positions.id,
          positions.strategyId,
          positions.symbol,
          positions.referencePrice,
          positions.updatedAt
        )
        .having(sql`${netShares} > 0`)
        .orderBy(desc(positions.updatedAt), desc(positions.id))
        .limit(limit);
    },
    async listLotsForPositions(positionIds) {
      if (positionIds.length === 0) return [];
      return db.query.positionLots.findMany({
        where: inArray(positionLots.positionId, positionIds),
        orderBy: [asc(positionLots.lotDate), asc(positionLots.createdAt)],
      });
    },
    async listRecentPrices(symbols) {
      if (symbols.length === 0) return {};

      const grouped: Record<string, RecentPriceRow[]> = {};
      for (const symbol of symbols) {
        grouped[symbol] = await db
          .select({
            symbol: priceSnapshots.symbol,
            date: priceSnapshots.date,
            close: priceSnapshots.close,
          })
          .from(priceSnapshots)
          .where(eq(priceSnapshots.symbol, symbol))
          .orderBy(desc(priceSnapshots.date))
          .limit(PRICES_PER_SYMBOL_LIMIT);
      }
      return grouped;
    },
    async listMemories({ symbols, strategyIds }) {
      const pinnedMemories = await db.query.memories.findMany({
        where: eq(memories.pinned, true),
        orderBy: (table, { desc: descFn }) => [descFn(table.updatedAt)],
        limit: PINNED_MEMORY_BUCKET_LIMIT,
      });
      const symbolMemories =
        symbols.length === 0
          ? []
          : await db.query.memories.findMany({
              where: inArray(memories.symbol, symbols),
              orderBy: (table, { desc: descFn }) => [descFn(table.updatedAt)],
              limit: SYMBOL_MEMORY_BUCKET_LIMIT,
            });
      const strategyMemories =
        strategyIds.length === 0
          ? []
          : await db.query.memories.findMany({
              where: inArray(memories.strategyId, strategyIds),
              orderBy: (table, { desc: descFn }) => [descFn(table.updatedAt)],
              limit: STRATEGY_MEMORY_BUCKET_LIMIT,
            });
      const globalMemories = await db.query.memories.findMany({
        where: and(isNull(memories.symbol), isNull(memories.strategyId)),
        orderBy: (table, { desc: descFn }) => [descFn(table.updatedAt)],
        limit: GLOBAL_MEMORY_BUCKET_LIMIT,
      });

      return mergeMemoryBuckets([
        pinnedMemories,
        symbolMemories,
        strategyMemories,
        globalMemories,
      ]);
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
  const openPositionCandidateRows = await repo.listOpenPositionCandidates({
    limit: POSITION_CONTEXT_LIMIT + 1,
  });
  const selectedOpenPositionRows = [...openPositionCandidateRows]
    .sort(
      (left, right) =>
        normalizeTimestamp(right.updatedAt) - normalizeTimestamp(left.updatedAt) ||
        right.id.localeCompare(left.id)
    )
    .slice(0, POSITION_CONTEXT_LIMIT);
  const lotRows = await repo.listLotsForPositions(
    selectedOpenPositionRows.map((position) => position.id)
  );

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

  const openPositionCandidates = selectedOpenPositionRows
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
        updatedAt: normalizeTimestamp(position.updatedAt),
      };
    })
    .filter((position): position is NonNullable<typeof position> => position !== null);

  const limitations = [FIXED_PRICE_LIMITATION];
  const positionsContext = openPositionCandidates
    .sort((left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id))
    .slice(0, POSITION_CONTEXT_LIMIT)
    .map(({ updatedAt: _updatedAt, ...position }) => position);
  if (openPositionCandidateRows.length > POSITION_CONTEXT_LIMIT) {
    limitations.push(`未关闭持仓过多，仅包含前 ${POSITION_CONTEXT_LIMIT} 条持仓上下文。`);
  }
  for (const position of positionsContext) {
    symbols.add(position.symbol);
  }

  const symbolList = [...symbols];
  const recentPricesBySymbol = await repo.listRecentPrices(symbolList);

  const pricesContext = symbolList
    .sort((left, right) => left.localeCompare(right))
    .map((symbol) => {
      const recentRows = (recentPricesBySymbol[symbol] ?? []).slice(0, PRICES_PER_SYMBOL_LIMIT);
      let skippedInvalidRows = false;
      const recentCloses = recentRows
        .map((row) => {
          const close = toNumber(row.close);
          if (close == null) {
            skippedInvalidRows = true;
            return null;
          }
          return {
            date: formatPriceDate(row.date),
            close,
          };
        })
        .filter((row): row is { date: string; close: number } => row !== null);
      const latestClose = recentCloses[0]?.close ?? null;
      if (skippedInvalidRows) {
        limitations.push(`${symbol} ${INVALID_PRICE_LIMITATION}`);
      }
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
  const sortedMemories = selectMemoriesByBucket(
    [...memoryRows].sort(
      (left, right) =>
        buildMemoryScore(right, relevantSymbols, relevantStrategies) -
        buildMemoryScore(left, relevantSymbols, relevantStrategies)
    ),
    relevantSymbols,
    relevantStrategies
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
