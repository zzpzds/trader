"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface StrategyPositions {
  strategyId: string;
  strategyName: string;
  positions: Array<{
    id: string;
    symbol: string;
    latestPrice: number | null;
    positionLots: Array<{
      shares: number;
      costPrice: string;
    }>;
  }>;
}

export default function PositionsPage() {
  const [data, setData] = useState<StrategyPositions[]>([]);

  useEffect(() => {
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
    fetchAll();
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">持仓管理</h1>

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
              const totalShares = pos.positionLots.reduce((s, l) => s + l.shares, 0);
              const totalCost = pos.positionLots.reduce(
                (s, l) => s + l.shares * parseFloat(l.costPrice),
                0
              );
              const avgCost = totalShares > 0 ? totalCost / totalShares : 0;
              const pnl =
                pos.latestPrice
                  ? ((pos.latestPrice - avgCost) / avgCost * 100).toFixed(2)
                  : null;

              return (
                <Card key={pos.id}>
                  <CardContent className="p-3 flex items-center justify-between">
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
