export type PositionTransactionType = "BUY" | "SELL";

export interface PositionTransaction {
  id: string;
  type?: PositionTransactionType | null;
  shares: number;
  price: number;
  date: string | Date;
  createdAt?: string | Date | null;
}

export interface PositionReplayResult {
  heldShares: number;
  costBasis: number;
  avgCost: number;
  grossInvested: number;
  realizedPnl: number;
  isClosed: boolean;
}

const EPSILON = 1e-9;

function compareDateValues(left: string | Date | null | undefined, right: string | Date | null | undefined) {
  const leftValue = left == null ? "" : left instanceof Date ? left.toISOString() : left;
  const rightValue = right == null ? "" : right instanceof Date ? right.toISOString() : right;
  return leftValue.localeCompare(rightValue);
}

export function replayPositionTransactions(transactions: readonly PositionTransaction[]): PositionReplayResult {
  const ordered = [...transactions].sort((left, right) =>
    compareDateValues(left.date, right.date) ||
    compareDateValues(left.createdAt, right.createdAt) ||
    left.id.localeCompare(right.id),
  );

  let heldShares = 0;
  let costBasis = 0;
  let grossInvested = 0;
  let realizedPnl = 0;

  for (const transaction of ordered) {
    const type = transaction.type ?? "BUY";
    if (type === "BUY") {
      heldShares += transaction.shares;
      costBasis += transaction.shares * transaction.price;
      grossInvested += transaction.shares * transaction.price;
      continue;
    }
    if (type !== "SELL") {
      throw new Error(`Unknown position transaction type: ${String(type)}`);
    }

    const avgCost = heldShares === 0 ? 0 : costBasis / heldShares;
    heldShares -= transaction.shares;
    costBasis -= transaction.shares * avgCost;
    realizedPnl += transaction.shares * (transaction.price - avgCost);
  }

  if (heldShares < EPSILON) {
    heldShares = 0;
    costBasis = 0;
  }

  return {
    heldShares,
    costBasis,
    avgCost: heldShares === 0 ? 0 : costBasis / heldShares,
    grossInvested,
    realizedPnl,
    isClosed: ordered.length > 0 && heldShares === 0,
  };
}
