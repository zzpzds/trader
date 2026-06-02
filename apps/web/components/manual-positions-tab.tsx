"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, Plus } from "lucide-react";
import { LotForm, type LotFormValues } from "@/components/lot-form";

interface ManualLot {
  id: string;
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
  lots: ManualLot[];
}

const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 12;

export function ManualPositionsTab() {
  const [data, setData] = useState<ManualPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
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
    const hasPending = data.some((p) => p.latestPrice === null);
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

  async function handleDeleteLot(lotId: string) {
    await fetch(`/api/positions/manual/lots/${lotId}`, { method: "DELETE" });
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
        const cost = totalShares * avg;
        const value = p.latestPrice != null ? totalShares * p.latestPrice : null;
        const pnl = value != null ? value - cost : null;

        return (
          <Card key={p.id}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-medium">{p.symbol}</span>
                  <span className="text-sm">{totalShares} 股</span>
                  <span className="text-sm text-muted-foreground">
                    均价 ${avg.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {p.latestPrice == null ? (
                    <span className="text-xs text-muted-foreground">价格加载中…</span>
                  ) : (
                    <>
                      <span className="text-sm tabular-nums">
                        ${p.latestPrice.toFixed(2)}
                      </span>
                      <span
                        className={`text-sm font-medium tabular-nums ${
                          pnl! >= 0 ? "text-red-600" : "text-green-600"
                        }`}
                      >
                        {pnl! >= 0 ? "+" : ""}${pnl!.toFixed(2)} (
                        {((pnl! / cost) * 100).toFixed(2)}%)
                      </span>
                    </>
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
              {p.lots.length > 0 && (
                <div className="mt-2 space-y-1 text-xs">
                  {p.lots.map((l) => (
                    <div
                      key={l.id}
                      className="flex justify-between text-muted-foreground"
                    >
                      <span>
                        {l.lotDate} · {parseFloat(l.shares)} 股 · $
                        {parseFloat(l.costPrice).toFixed(2)}
                        {l.notes ? ` · ${l.notes}` : ""}
                      </span>
                      <button
                        onClick={() => handleDeleteLot(l.id)}
                        className="hover:text-destructive"
                      >
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
