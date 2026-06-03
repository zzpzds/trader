"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, Plus } from "lucide-react";
import { LotForm, type LotFormValues } from "@/components/lot-form";
import { SellForm, type SellFormValues } from "@/components/sell-form";

interface Transaction {
  id: string;
  type: "BUY" | "SELL";
  shares: string;
  costPrice: string;
  lotDate: string;
  notes: string | null;
}

interface ManualPosition {
  id: string;
  symbol: string;
  totalShares: string;
  avgCost: string;
  latestPrice: number | null;
  realizedPnl: number;
  unrealizedPnl: number | null;
  totalPnl: number | null;
  totalPnlPercent: number | null;
  isClosed: boolean;
  transactions: Transaction[];
}

const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 12;

export function ManualPositionsTab() {
  const [data, setData] = useState<ManualPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [sellingId, setSellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollAttemptsRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/positions/manual", { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      const json = await res.json();
      setData(json);
      setError(null);
    } catch {
      setError("数据加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // Poll while any position has no latest price; cap to avoid infinite polling
  useEffect(() => {
    const hasPending = data.some((p) => !p.isClosed && p.latestPrice === null);
    if (!hasPending) {
      pollAttemptsRef.current = 0;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }
    if (pollTimerRef.current) return;
    pollTimerRef.current = setInterval(() => {
      pollAttemptsRef.current += 1;
      if (pollAttemptsRef.current > POLL_MAX_ATTEMPTS) {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
        return;
      }
      load();
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, [data]);

  async function handleAdd(values: LotFormValues) {
    const res = await fetch("/api/positions/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: values.symbol,
        shares: parseFloat(values.shares),
        costPrice: values.costPrice,
        lotDate: values.lotDate,
        notes: values.notes || undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "添加失败");
      return;
    }
    setShowAdd(false);
    pollAttemptsRef.current = 0;
    await load();
  }

  async function handleSell(symbol: string, values: SellFormValues) {
    const res = await fetch("/api/positions/manual/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol,
        shares: parseFloat(values.shares),
        price: values.price,
        sellDate: values.sellDate,
        notes: values.notes || undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "卖出失败");
      return;
    }
    setSellingId(null);
    await load();
  }

  async function handleDeleteLot(lotId: string) {
    const res = await fetch(`/api/positions/manual/lots/${lotId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "删除失败");
      return;
    }
    setError(null);
    await load();
  }

  async function handleDeletePosition(positionId: string) {
    await fetch(`/api/positions/manual/${positionId}`, { method: "DELETE" });
    await load();
  }

  if (loading) {
    return <p className="text-muted-foreground text-center py-10">加载中…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowAdd((s) => !s)}>
          <Plus size={14} className="mr-1" /> 添加持仓
        </Button>
      </div>

      {showAdd && (
        <LotForm
          submitLabel="添加"
          onSubmit={handleAdd}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {!showAdd && data.length === 0 && (
        <p className="text-muted-foreground text-center py-10">暂无手动持仓</p>
      )}

      {data.map((p) => {
        const totalShares = parseFloat(p.totalShares);
        const avg = parseFloat(p.avgCost);
        const pnl = p.totalPnl;
        const pct = p.totalPnlPercent;
        const gain = pnl != null && pnl >= 0;

        return (
          <Card key={p.id}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-medium">{p.symbol}</span>
                  {p.isClosed ? (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">已清仓</span>
                  ) : (
                    <>
                      <span className="text-sm">{totalShares} 股</span>
                      <span className="text-sm text-muted-foreground">均价 ${avg.toFixed(2)}</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!p.isClosed && (p.latestPrice == null ? (
                    <span className="text-xs text-muted-foreground">价格加载中…</span>
                  ) : (
                    <span className="text-sm tabular-nums">${p.latestPrice.toFixed(2)}</span>
                  ))}
                  {pnl != null && pct != null && (
                    <span className={`text-sm font-medium tabular-nums ${gain ? "text-red-600" : "text-green-600"}`}>
                      {gain ? "+" : ""}${pnl.toFixed(2)} ({pct.toFixed(2)}%)
                    </span>
                  )}
                  {!p.isClosed && (
                    <Button variant="outline" size="sm" className="h-7" onClick={() => setSellingId(sellingId === p.id ? null : p.id)}>
                      卖出
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDeletePosition(p.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {sellingId === p.id && (
                <div className="mt-3">
                  <SellForm
                    symbol={p.symbol}
                    maxShares={totalShares}
                    onSubmit={(v) => handleSell(p.symbol, v)}
                    onCancel={() => setSellingId(null)}
                  />
                </div>
              )}

              {p.transactions.length > 0 && (
                <div className="mt-2 space-y-1 text-xs">
                  {p.transactions.map((t) => (
                    <div key={t.id} className="flex items-start justify-between gap-2 text-muted-foreground">
                      <span className="min-w-0 flex-1">
                        <span className={t.type === "SELL" ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                          {t.type === "SELL" ? "卖出" : "买入"}
                        </span>{" "}
                        {t.lotDate} · {parseFloat(t.shares)} 股 · ${parseFloat(t.costPrice).toFixed(2)}
                        {t.notes ? ` · ${t.notes}` : ""}
                      </span>
                      <button onClick={() => handleDeleteLot(t.id)} className="shrink-0 whitespace-nowrap hover:text-destructive">
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
