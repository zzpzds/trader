"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PnlChart } from "@/components/pnl-chart";

interface StrategyPositions {
  strategyId: string;
  strategyName: string;
  positions: Array<{
    id: string;
    symbol: string;
    latestPrice: number | null;
    positionLots: Array<{
      shares: string;
      costPrice: string;
    }>;
  }>;
}

interface SummaryData {
  totalCost: number;
  totalValue: number;
  absolutePnl: number;
  percentPnl: number;
  coveredPositions: number;
  totalPositions: number;
}

export default function PositionsPage() {
  const [data, setData] = useState<StrategyPositions[]>([]);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(false);

  useEffect(() => {
    async function fetchSummary() {
      try {
        const res = await fetch("/api/positions/summary");
        if (!res.ok) throw new Error("failed");
        const json = await res.json();
        if (typeof json.totalCost !== "number" || typeof json.coveredPositions !== "number") {
          throw new Error("invalid response");
        }
        setSummary(json);
      } catch {
        setSummaryError(true);
      } finally {
        setSummaryLoading(false);
      }
    }

    async function fetchAll() {
      const res = await fetch("/api/strategies");
      const strategies = await res.json();

      const results: StrategyPositions[] = [];
      for (const s of strategies) {
        const posRes = await fetch(`/api/strategies/${s.id}/positions`);
        if (posRes.ok) {
          const positions = await posRes.json();
          if (positions.length > 0) {
            results.push({
              strategyId: s.id,
              strategyName: s.name,
              positions,
            });
          }
        }
      }
      setData(results);
    }

    fetchSummary();
    fetchAll();
  }, []);

  const usdFormat: Intl.NumberFormatOptions = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

  return (
    <div className="p-4 md:p-6 max-w-none md:max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">持仓管理</h1>

      <Card className="mb-6">
        <CardContent className="p-4">
          <p className="text-sm font-medium text-muted-foreground mb-3">总持仓收益</p>
          {summaryLoading ? (
            <div className="h-10 bg-muted animate-pulse rounded" />
          ) : summaryError ? (
            <p className="text-sm text-muted-foreground">数据加载失败</p>
          ) : summary && summary.coveredPositions === 0 ? (
            <p className="text-sm text-muted-foreground">暂无价格数据</p>
          ) : summary && (
            <div className="flex items-end gap-6 flex-wrap">
              <div>
                <p className="text-xs text-muted-foreground">总成本</p>
                <p className="text-base font-medium">
                  ${summary.totalCost.toLocaleString("en-US", usdFormat)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">当前市值</p>
                <p className="text-base font-medium">
                  ${summary.totalValue.toLocaleString("en-US", usdFormat)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">收益</p>
                <p className={`text-base font-semibold ${summary.absolutePnl >= 0 ? "text-red-600" : "text-green-600"}`}>
                  {summary.absolutePnl >= 0 ? "+" : ""}${summary.absolutePnl.toLocaleString("en-US", usdFormat)}&nbsp;
                  <span className="text-sm font-medium">
                    {summary.percentPnl >= 0 ? "+" : ""}{summary.percentPnl.toFixed(2)}%
                  </span>
                </p>
              </div>
              {summary.coveredPositions < summary.totalPositions && (
                <p className="text-xs text-muted-foreground ml-auto self-end">
                  基于 {summary.coveredPositions}/{summary.totalPositions} 个持仓的价格数据
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <PnlChart fetchUrl="/api/positions/history" />

      {data.length === 0 && (
        <p className="text-muted-foreground text-center py-10">暂无持仓</p>
      )}

      {data.map(({ strategyId, strategyName, positions }) => (
        <div key={strategyId} className="mb-6">
          <h2 className="text-lg font-semibold mb-2">
            <Link href={`/strategies/${strategyId}`} className="hover:underline">
              {strategyName}
            </Link>
          </h2>
          <div className="space-y-2">
            {positions.map((pos) => {
              const totalShares = pos.positionLots.reduce((s, l) => s + parseFloat(l.shares), 0);
              const totalCost = pos.positionLots.reduce(
                (s, l) => s + parseFloat(l.shares) * parseFloat(l.costPrice),
                0
              );
              const avgCost = totalShares > 0 ? totalCost / totalShares : 0;
              const pnl =
                pos.latestPrice
                  ? ((pos.latestPrice - avgCost) / avgCost * 100).toFixed(2)
                  : null;

              return (
                <Card key={pos.id}>
                  <CardContent className="p-3 flex items-center justify-between flex-wrap gap-1">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline">{pos.symbol}</Badge>
                      <span className="text-sm">{totalShares} 股</span>
                      <span className="text-sm text-muted-foreground">
                        均价 ${avgCost.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {pos.latestPrice ? (
                        <>
                          <span className="text-sm">${pos.latestPrice}</span>
                          <span
                            className={`text-sm font-medium ${
                              pnl && parseFloat(pnl) >= 0
                                ? "text-red-600"
                                : "text-green-600"
                            }`}
                          >
                            {pnl}%
                          </span>
                        </>
                      ) : (
                        <span className="text-sm text-muted-foreground">--</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
