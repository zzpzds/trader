export interface LotInput {
  id: string;
  positionId: string;
  symbol: string;
  type: "BUY" | "SELL";
  lotDate: string;
  costPrice: number;
  shares: number;
  referencePrice: number | null;
}

export interface SnapshotInput {
  symbol: string;
  date: string;
  close: number;
}

export interface InsightsReport {
  basic: {
    closedTrades: number;
    winRate: number;
    avgHoldDays: number;
    profitLossRatio: number;
    totalRealizedPnl: number;
    maxDrawdown: number;
  };
  disposition: {
    avgHoldDaysWinners: number;
    avgHoldDaysLosers: number;
    score: number;
    flag: "none" | "mild" | "severe";
  };
  anchoring: {
    avgChaseHighPct: number;
    chaseRate: number;
    avgVsRefPct: number;
    flag: "none" | "mild" | "severe";
  };
  overtrading: {
    avgTradesPerWeek: number;
    flipsWithin3d: number;
    flag: "none" | "mild" | "severe";
  };
}

export type ComputeResult = InsightsReport | { empty: true; reason: "insufficient_data" };

const MIN_CLOSED_TRADES = 5;
const ANCHOR_LOOKBACK_DAYS = 30;

const DISPOSITION_MILD = 0.3;
const DISPOSITION_SEVERE = 0.6;
const ANCHOR_MILD_PCT = 5;
const ANCHOR_SEVERE_PCT = 15;
const OVERTRADE_MILD_WEEKLY = 5;
const OVERTRADE_SEVERE_WEEKLY = 10;
const OVERTRADE_FLIPS_SEVERE = 3;

function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.max(0, Math.round((db - da) / 86_400_000));
}

interface ClosedTrade {
  symbol: string;
  buyDate: string;
  sellDate: string;
  buyPrice: number;
  sellPrice: number;
  shares: number;
  realized: number;
  holdDays: number;
}

function pairTrades(lots: LotInput[]): ClosedTrade[] {
  const byPos = new Map<string, LotInput[]>();
  for (const l of lots) {
    if (!byPos.has(l.positionId)) byPos.set(l.positionId, []);
    byPos.get(l.positionId)!.push(l);
  }

  const closed: ClosedTrade[] = [];
  for (const list of byPos.values()) {
    const sorted = [...list].sort((a, b) => a.lotDate.localeCompare(b.lotDate));
    const buys: Array<LotInput & { remaining: number }> = [];
    for (const lot of sorted) {
      if (lot.type === "BUY") {
        buys.push({ ...lot, remaining: lot.shares });
      } else {
        let remainingSell = lot.shares;
        while (remainingSell > 0 && buys.length > 0 && buys[0].remaining > 0) {
          const head = buys[0];
          const matched = Math.min(head.remaining, remainingSell);
          closed.push({
            symbol: lot.symbol,
            buyDate: head.lotDate,
            sellDate: lot.lotDate,
            buyPrice: head.costPrice,
            sellPrice: lot.costPrice,
            shares: matched,
            realized: (lot.costPrice - head.costPrice) * matched,
            holdDays: daysBetween(head.lotDate, lot.lotDate),
          });
          head.remaining -= matched;
          remainingSell -= matched;
          if (head.remaining === 0) buys.shift();
        }
      }
    }
  }
  return closed;
}

function maxDrawdown(closed: ClosedTrade[]): number {
  if (closed.length === 0) return 0;
  const sorted = [...closed].sort((a, b) => a.sellDate.localeCompare(b.sellDate));
  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of sorted) {
    cum += t.realized;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

function computeAnchoring(buyLots: LotInput[], snapshots: SnapshotInput[]) {
  if (buyLots.length === 0) {
    return { avgChaseHighPct: 0, chaseRate: 0, avgVsRefPct: 0 };
  }
  const bySymbol = new Map<string, SnapshotInput[]>();
  for (const s of snapshots) {
    if (!bySymbol.has(s.symbol)) bySymbol.set(s.symbol, []);
    bySymbol.get(s.symbol)!.push(s);
  }
  for (const arr of bySymbol.values()) arr.sort((a, b) => a.date.localeCompare(b.date));

  let chaseHighSum = 0;
  let chaseHighN = 0;
  let chaseAboveMaCount = 0;
  let chaseAboveMaTotal = 0;
  let vsRefSum = 0;
  let vsRefN = 0;

  for (const lot of buyLots) {
    const arr = bySymbol.get(lot.symbol) ?? [];
    const cutoff = new Date(lot.lotDate).getTime();
    const lookbackStart = cutoff - ANCHOR_LOOKBACK_DAYS * 86_400_000;
    const window = arr.filter((s) => {
      const t = new Date(s.date).getTime();
      return t >= lookbackStart && t < cutoff;
    });
    if (window.length > 0) {
      const high = Math.max(...window.map((s) => s.close));
      const ma = window.reduce((a, s) => a + s.close, 0) / window.length;
      chaseHighSum += ((lot.costPrice - high) / high) * 100;
      chaseHighN += 1;
      chaseAboveMaTotal += 1;
      if (lot.costPrice > ma) chaseAboveMaCount += 1;
    }
    if (lot.referencePrice && lot.referencePrice > 0) {
      vsRefSum += ((lot.costPrice - lot.referencePrice) / lot.referencePrice) * 100;
      vsRefN += 1;
    }
  }

  return {
    avgChaseHighPct: chaseHighN === 0 ? 0 : chaseHighSum / chaseHighN,
    chaseRate: chaseAboveMaTotal === 0 ? 0 : chaseAboveMaCount / chaseAboveMaTotal,
    avgVsRefPct: vsRefN === 0 ? 0 : vsRefSum / vsRefN,
  };
}

function flagFromThresholds(value: number, mild: number, severe: number): "none" | "mild" | "severe" {
  if (value > severe) return "severe";
  if (value > mild) return "mild";
  return "none";
}

function flipsWithin3Days(lots: LotInput[]): number {
  const bySym = new Map<string, LotInput[]>();
  for (const l of lots) {
    if (!bySym.has(l.symbol)) bySym.set(l.symbol, []);
    bySym.get(l.symbol)!.push(l);
  }
  let flips = 0;
  for (const arr of bySym.values()) {
    const sorted = [...arr].sort((a, b) => a.lotDate.localeCompare(b.lotDate));
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].type === "SELL" && sorted[i + 1].type === "BUY") {
        if (daysBetween(sorted[i].lotDate, sorted[i + 1].lotDate) <= 3) flips += 1;
      }
    }
  }
  return flips;
}

export function computeInsights(lots: LotInput[], snapshots: SnapshotInput[]): ComputeResult {
  const closed = pairTrades(lots);

  if (closed.length < MIN_CLOSED_TRADES) {
    return { empty: true, reason: "insufficient_data" };
  }

  const winners = closed.filter((t) => t.realized > 0);
  const losers = closed.filter((t) => t.realized < 0);

  const winRate = winners.length / closed.length;
  const avgHoldDays = closed.reduce((s, t) => s + t.holdDays, 0) / closed.length;
  const avgWinPnl = winners.length === 0 ? 0 : winners.reduce((s, t) => s + t.realized, 0) / winners.length;
  const avgLossPnl = losers.length === 0 ? 0 : losers.reduce((s, t) => s + Math.abs(t.realized), 0) / losers.length;
  const profitLossRatio = avgLossPnl === 0 ? 0 : avgWinPnl / avgLossPnl;
  const totalRealizedPnl = closed.reduce((s, t) => s + t.realized, 0);
  const maxDd = maxDrawdown(closed);

  const avgWinDays = winners.length === 0 ? 0 : winners.reduce((s, t) => s + t.holdDays, 0) / winners.length;
  const avgLossDays = losers.length === 0 ? 0 : losers.reduce((s, t) => s + t.holdDays, 0) / losers.length;
  const dispositionScore = avgLossDays === 0 ? 0 : (avgLossDays - avgWinDays) / avgLossDays;
  const dispositionFlag = flagFromThresholds(dispositionScore, DISPOSITION_MILD, DISPOSITION_SEVERE);

  const buys = lots.filter((l) => l.type === "BUY");
  const anchor = computeAnchoring(buys, snapshots);
  const anchoringFlag = flagFromThresholds(anchor.avgChaseHighPct, ANCHOR_MILD_PCT, ANCHOR_SEVERE_PCT);

  const dates = lots.map((l) => new Date(l.lotDate).getTime()).sort((a, b) => a - b);
  const span = dates.length === 0 ? 0 : (dates[dates.length - 1] - dates[0]) / (7 * 86_400_000);
  const avgTradesPerWeek = span === 0 ? lots.length : lots.length / Math.max(1, span);
  const flips = flipsWithin3Days(lots);
  const overtradeFlag: "none" | "mild" | "severe" =
    flips >= OVERTRADE_FLIPS_SEVERE || avgTradesPerWeek > OVERTRADE_SEVERE_WEEKLY
      ? "severe"
      : flips >= 1 || avgTradesPerWeek > OVERTRADE_MILD_WEEKLY
      ? "mild"
      : "none";

  return {
    basic: {
      closedTrades: closed.length,
      winRate,
      avgHoldDays,
      profitLossRatio,
      totalRealizedPnl,
      maxDrawdown: maxDd,
    },
    disposition: {
      avgHoldDaysWinners: avgWinDays,
      avgHoldDaysLosers: avgLossDays,
      score: dispositionScore,
      flag: dispositionFlag,
    },
    anchoring: { ...anchor, flag: anchoringFlag },
    overtrading: { avgTradesPerWeek, flipsWithin3d: flips, flag: overtradeFlag },
  };
}
