const EPS = 1e-9;

export type TxnType = "BUY" | "SELL";

export interface Txn {
  id: string;
  type: TxnType;
  shares: number;
  price: number;
  date: string; // YYYY-MM-DD
  createdAt?: string | Date | null;
}

export interface PositionPnl {
  heldShares: number;
  costBasis: number;
  avgCost: number;
  grossInvested: number;
  realizedPnl: number;
  isClosed: boolean;
}

function sortTxns(txns: Txn[]): Txn[] {
  return [...txns].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ca - cb;
  });
}

export function replayPosition(txns: Txn[]): PositionPnl {
  let heldShares = 0;
  let costBasis = 0;
  let grossInvested = 0;
  let realizedPnl = 0;

  for (const t of sortTxns(txns)) {
    if (t.type === "BUY") {
      heldShares += t.shares;
      costBasis += t.shares * t.price;
      grossInvested += t.shares * t.price;
    } else {
      const avg = heldShares > EPS ? costBasis / heldShares : 0;
      realizedPnl += (t.price - avg) * t.shares;
      costBasis -= avg * t.shares;
      heldShares -= t.shares;
    }
  }

  if (heldShares < EPS) {
    heldShares = 0;
    costBasis = 0;
  }
  const avgCost = heldShares > EPS ? costBasis / heldShares : 0;

  return {
    heldShares,
    costBasis,
    avgCost,
    grossInvested,
    realizedPnl,
    isClosed: txns.length > 0 && heldShares < EPS,
  };
}

export interface TotalPnl {
  unrealizedPnl: number | null;
  totalPnl: number | null;
  totalPnlPercent: number | null;
}

export function computeTotalPnl(
  state: PositionPnl,
  latestPrice: number | null
): TotalPnl {
  if (state.heldShares < EPS) {
    const pct =
      state.grossInvested > EPS
        ? Math.round((state.realizedPnl / state.grossInvested) * 10000) / 100
        : null;
    return { unrealizedPnl: 0, totalPnl: state.realizedPnl, totalPnlPercent: pct };
  }
  if (latestPrice == null) {
    return { unrealizedPnl: null, totalPnl: null, totalPnlPercent: null };
  }
  const unrealizedPnl = latestPrice * state.heldShares - state.costBasis;
  const totalPnl = state.realizedPnl + unrealizedPnl;
  const pct =
    state.grossInvested > EPS
      ? Math.round((totalPnl / state.grossInvested) * 10000) / 100
      : null;
  return { unrealizedPnl, totalPnl, totalPnlPercent: pct };
}

export function canDeleteBuy(txns: Txn[], lotId: string): boolean {
  const target = txns.find((t) => t.id === lotId);
  if (!target) return true;
  if (target.type === "SELL") return true;
  const remaining = txns.filter((t) => t.id !== lotId);
  let held = 0;
  for (const t of sortTxns(remaining)) {
    held += t.type === "BUY" ? t.shares : -t.shares;
    if (held < -EPS) return false;
  }
  return true;
}
