"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Copy, Plus, Trash2, Edit2, PlayCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Strategy {
  id: string;
  name: string;
  symbols: string[];
  content: string;
  script: string;
}

interface Position {
  id: string;
  symbol: string;
  latestPrice: number | null;
  positionLots: Lot[];
}

interface Lot {
  id: string;
  shares: number;
  costPrice: string;
  lotDate: string;
  notes: string | null;
}

interface MonitoringRun {
  id: string;
  runDate: string;
  status: string;
  analysis: string | null;
  hasActionItems: boolean | null;
  error: string | null;
}

type Tab = "description" | "script" | "positions" | "analysis";

export default function StrategyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [tab, setTab] = useState<Tab>("positions");
  const [positions, setPositions] = useState<Position[]>([]);
  const [runs, setRuns] = useState<MonitoringRun[]>([]);
  const [showAddLot, setShowAddLot] = useState(false);
  const [lotSymbol, setLotSymbol] = useState("");
  const [lotShares, setLotShares] = useState("");
  const [lotPrice, setLotPrice] = useState("");
  const [lotDate, setLotDate] = useState(new Date().toISOString().slice(0, 10));
  const [lotNotes, setLotNotes] = useState("");
  const [triggerStatus, setTriggerStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchStrategy = useCallback(async () => {
    const res = await fetch(`/api/strategies/${id}`);
    if (res.ok) setStrategy(await res.json());
  }, [id]);

  const fetchPositions = useCallback(async () => {
    const res = await fetch(`/api/strategies/${id}/positions`);
    if (res.ok) setPositions(await res.json());
  }, [id]);

  const fetchRuns = useCallback(async () => {
    const res = await fetch(`/api/monitoring/runs?strategyId=${id}`);
    if (res.ok) {
      const data = await res.json();
      setRuns(data);
    }
  }, [id]);

  useEffect(() => {
    fetchStrategy();
  }, [fetchStrategy]);

  useEffect(() => {
    if (tab === "positions") fetchPositions();
    if (tab === "analysis") fetchRuns();
  }, [tab, fetchPositions, fetchRuns]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function handleAddLot() {
    if (!lotSymbol || !lotShares || !lotPrice || !lotDate) return;
    await fetch(`/api/strategies/${id}/lots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: lotSymbol.toUpperCase(),
        shares: parseInt(lotShares),
        costPrice: lotPrice,
        lotDate,
        notes: lotNotes || undefined,
      }),
    });
    setShowAddLot(false);
    setLotSymbol("");
    setLotShares("");
    setLotPrice("");
    setLotNotes("");
    fetchPositions();
  }

  async function handleDeleteLot(lotId: string) {
    await fetch(`/api/lots/${lotId}`, { method: "DELETE" });
    fetchPositions();
  }

  async function handleTrigger() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setTriggerStatus("loading");
    try {
      const res = await fetch(`/api/monitoring/trigger/${id}`, { method: "POST" });
      await res.json().catch(() => {});
      setTriggerStatus(res.ok ? "success" : "error");
    } catch {
      setTriggerStatus("error");
    } finally {
      timerRef.current = setTimeout(() => setTriggerStatus("idle"), 3000);
    }
  }

  function calcAggregated(lots: Lot[]) {
    const totalShares = lots.reduce((s, l) => s + l.shares, 0);
    const totalCost = lots.reduce((s, l) => s + l.shares * parseFloat(l.costPrice), 0);
    const avgCost = totalShares > 0 ? totalCost / totalShares : 0;
    return { totalShares, avgCost };
  }

  if (!strategy) return <div className="p-6">Loading...</div>;

  const tabs: { key: Tab; label: string }[] = [
    { key: "positions", label: "持仓" },
    { key: "description", label: "策略描述" },
    { key: "script", label: "原始脚本" },
    { key: "analysis", label: "最近分析" },
  ];

  return (
    <div className="h-screen flex flex-col p-6 max-w-4xl mx-auto">
      <div className="shrink-0 mb-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push("/strategies")}>
            <ArrowLeft size={16} />
          </Button>
          <h1 className="text-2xl font-bold">{strategy.name}</h1>
          <div className="flex gap-1">
            {strategy.symbols?.map((s) => (
              <Badge key={s} variant="outline">{s}</Badge>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={triggerStatus === "loading"}
            onClick={handleTrigger}
          >
            <PlayCircle size={14} className="mr-1" />
            {triggerStatus === "loading" ? "触发中..." : "立即分析"}
          </Button>
        </div>
        {triggerStatus === "success" && (
          <p className="text-xs text-muted-foreground mt-1.5 ml-10">
            ✓ 分析已触发，稍后在「最近分析」Tab 查看结果
          </p>
        )}
        {triggerStatus === "error" && (
          <p className="text-xs text-destructive mt-1.5 ml-10">
            触发失败，请重试
          </p>
        )}
      </div>

      <div className="flex gap-1 mb-4 border-b shrink-0">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${
              tab === key
                ? "border-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
      {tab === "description" && (
        <div className="prose prose-sm max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{strategy.content}</ReactMarkdown>
        </div>
      )}

      {tab === "script" && (
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2"
            onClick={() => navigator.clipboard.writeText(strategy.script)}
          >
            <Copy size={14} />
          </Button>
          <pre className="bg-muted p-4 rounded-md text-sm overflow-x-auto">
            <code>{strategy.script}</code>
          </pre>
        </div>
      )}

      {tab === "positions" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setShowAddLot(!showAddLot)}>
              <Plus size={14} className="mr-1" /> 新增批次
            </Button>
          </div>

          {showAddLot && (
            <Card>
              <CardContent className="p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">股票代码</label>
                    <Input value={lotSymbol} onChange={(e) => setLotSymbol(e.target.value)} placeholder="QQQ" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">股数</label>
                    <Input type="number" value={lotShares} onChange={(e) => setLotShares(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">成本价</label>
                    <Input type="number" step="0.01" value={lotPrice} onChange={(e) => setLotPrice(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">建仓日期</label>
                    <Input type="date" value={lotDate} onChange={(e) => setLotDate(e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-muted-foreground">备注</label>
                    <Input value={lotNotes} onChange={(e) => setLotNotes(e.target.value)} />
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" onClick={handleAddLot}>保存</Button>
                  <Button size="sm" variant="outline" onClick={() => setShowAddLot(false)}>取消</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {positions.map((pos) => {
            const { totalShares, avgCost } = calcAggregated(pos.positionLots);
            const pnl = pos.latestPrice
              ? ((pos.latestPrice - avgCost) / avgCost * 100).toFixed(2)
              : null;
            const pnlPositive = pnl !== null && parseFloat(pnl) >= 0;
            return (
              <div key={pos.id} className="rounded-lg border bg-card">
                <div className="flex items-center gap-3 px-4 py-3 border-b">
                  <span className="font-semibold">{pos.symbol}</span>
                  <span className="text-sm text-muted-foreground">
                    {totalShares} 股 @ ${avgCost.toFixed(2)}
                  </span>
                  {pos.latestPrice !== null ? (
                    <span className={`text-sm font-medium ${pnlPositive ? "text-green-600" : "text-red-500"}`}>
                      ${pos.latestPrice} &nbsp;
                      <span className={`text-xs px-1.5 py-0.5 rounded ${pnlPositive ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                        {pnlPositive ? "+" : ""}{pnl}%
                      </span>
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">--</span>
                  )}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th className="text-left font-normal px-4 py-2">日期</th>
                      <th className="text-right font-normal px-4 py-2">股数</th>
                      <th className="text-right font-normal px-4 py-2">成本价</th>
                      <th className="text-left font-normal px-4 py-2">备注</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {pos.positionLots.map((lot) => (
                      <tr key={lot.id} className="hover:bg-muted/40 transition-colors">
                        <td className="px-4 py-2.5 tabular-nums">{lot.lotDate}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{lot.shares}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">${parseFloat(lot.costPrice).toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">{lot.notes ?? ""}</td>
                        <td className="pr-2 py-2.5 text-center">
                          <button
                            className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
                            onClick={() => handleDeleteLot(lot.id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}

          {positions.length === 0 && (
            <p className="text-muted-foreground text-center py-6">暂无持仓记录</p>
          )}
        </div>
      )}

      {tab === "analysis" && (
        <div className="space-y-3">
          {runs.length === 0 && (
            <p className="text-muted-foreground text-center py-6">暂无监控记录</p>
          )}
          {runs.map((run) => (
            <Card key={run.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{run.runDate}</span>
                  <div className="flex gap-2">
                    <Badge
                      variant={
                        run.status === "completed"
                          ? "default"
                          : run.status === "failed"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {run.status}
                    </Badge>
                    {run.hasActionItems && (
                      <Badge variant="outline" className="text-orange-600">
                        操作建议
                      </Badge>
                    )}
                  </div>
                </div>
                {run.status === "completed" && run.analysis && (
                  <div className="prose prose-sm max-w-none mt-2">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.analysis}</ReactMarkdown>
                  </div>
                )}
                {run.status === "failed" && run.error && (
                  <p className="text-sm text-destructive mt-2">{run.error}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
