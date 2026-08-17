import {
  replayPosition,
  type PositionReplayResult,
  type PositionTransaction,
  type PositionTransactionType,
} from "@trader/db/position-replay";

export { replayPosition };

const EPS = 1e-9;

export type TxnType = PositionTransactionType;

export interface Txn extends PositionTransaction {
  type: TxnType;
}

export type PositionPnl = PositionReplayResult;

function sortTxns(txns: Txn[]): Txn[] {
  return [...txns].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ca - cb;
  });
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

export interface DatedTxn extends Txn {
  symbol: string;
}

export interface Snapshot {
  symbol: string;
  date: string;
  close: number;
}

export function buildPnlHistory(
  txns: DatedTxn[],
  snapshots: Snapshot[]
): Array<{ date: string; percentPnl: number }> {
  const bySymbol = new Map<string, DatedTxn[]>();
  for (const t of txns) {
    if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, []);
    bySymbol.get(t.symbol)!.push(t);
  }

  const priceByDate = new Map<string, Map<string, number>>();
  for (const s of snapshots) {
    if (!priceByDate.has(s.date)) priceByDate.set(s.date, new Map());
    priceByDate.get(s.date)!.set(s.symbol, s.close);
  }

  const dates = [...priceByDate.keys()].sort();
  const carry = new Map<string, number>();
  const result: Array<{ date: string; percentPnl: number }> = [];

  for (const date of dates) {
    const todays = priceByDate.get(date);
    if (todays) for (const [sym, px] of todays) carry.set(sym, px);

    let marketValue = 0;
    let remainingCost = 0;
    let realizedCum = 0;
    let grossInvested = 0;

    for (const [sym, list] of bySymbol) {
      const price = carry.get(sym);
      if (price === undefined) continue;
      const upTo = list.filter((t) => t.date <= date);
      if (upTo.length === 0) continue;
      const st = replayPosition(upTo);
      marketValue += st.heldShares * price;
      remainingCost += st.costBasis;
      realizedCum += st.realizedPnl;
      grossInvested += st.grossInvested;
    }

    if (grossInvested <= EPS) continue;
    const totalPnl = marketValue - remainingCost + realizedCum;
    result.push({
      date,
      percentPnl: Math.round((totalPnl / grossInvested) * 10000) / 100,
    });
  }

  return result;
}
