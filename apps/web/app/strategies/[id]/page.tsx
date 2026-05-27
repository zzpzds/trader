"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Copy, Plus, Trash2, Edit2, PlayCircle, RefreshCw, Upload, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ParsedStrategy } from "@/lib/parse-strategy";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PnlChart } from "@/components/pnl-chart";

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
  shares: string;
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

function formatShares(shares: string | number): string {
  const n = typeof shares === "string" ? parseFloat(shares) : shares;
  return String(n);
}

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
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const cancelledRef = useRef(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionInput, setDescriptionInput] = useState("");
  const [savingDescription, setSavingDescription] = useState(false);
  const [showReparse, setShowReparse] = useState(false);
  const [reparseTab, setReparseTab] = useState<"upload" | "paste">("paste");
  const [reparseScript, setReparseScript] = useState("");
  const [reparseParsed, setReparseParsed] = useState<ParsedStrategy | null>(null);
  const [reparseEditName, setReparseEditName] = useState("");
  const [reparseEditSymbols, setReparseEditSymbols] = useState<string[]>([]);
  const [reparsing, setReparsing] = useState(false);
  const [savingReparse, setSavingReparse] = useState(false);

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
        shares: parseFloat(lotShares),
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

  async function handleRenameSave() {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === strategy!.name) {
      setEditingName(false);
      return;
    }
    setEditingName(false);
    try {
      const res = await fetch(`/api/strategies/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        const updated = await res.json();
        setStrategy((prev) => prev ? { ...prev, name: updated.name } : prev);
      } else {
        alert("重命名失败，请重试");
      }
    } catch {
      alert("重命名失败，请重试");
    }
  }

  async function handleSaveDescription() {
    setSavingDescription(true);
    try {
      const res = await fetch(`/api/strategies/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: descriptionInput }),
      });
      if (res.ok) {
        const updated = await res.json();
        setStrategy((prev) => prev ? { ...prev, content: updated.content } : prev);
        setEditingDescription(false);
      } else {
        alert("保存失败，请重试");
      }
    } catch {
      alert("保存失败，请重试");
    } finally {
      setSavingDescription(false);
    }
  }

  async function handleReparse() {
    if (!reparseScript.trim()) return;
    setReparsing(true);
    setReparseParsed(null);
    try {
      const res = await fetch("/api/strategies/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: reparseScript }),
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
        return;
      }
      setReparseParsed(data);
      setReparseEditName(data.name ?? "");
      setReparseEditSymbols(data.symbols ?? []);
    } catch (err) {
      alert("解析失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setReparsing(false);
    }
  }

  async function handleReparseConfirm() {
    if (!reparseParsed) return;
    setSavingReparse(true);
    try {
      const res = await fetch(`/api/strategies/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: reparseEditName,
          symbols: reparseEditSymbols,
          content: reparseParsed.content,
          script: reparseScript,
        }),
      });
      if (res.ok) {
        await fetchStrategy();
        setShowReparse(false);
        setReparseScript("");
        setReparseParsed(null);
        setTab("description");
      } else {
        alert("更新失败，请重试");
      }
    } catch {
      alert("更新失败，请重试");
    } finally {
      setSavingReparse(false);
    }
  }

  function handleReparseFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".py")) {
      alert("Only .py files are accepted");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      setReparseScript(ev.target?.result as string);
      setReparseTab("paste");
    };
    reader.readAsText(file);
  }

  function handleRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      cancelledRef.current = true;
      setEditingName(false);
    }
  }

  function calcAggregated(lots: Lot[]) {
    const totalShares = lots.reduce((s, l) => s + parseFloat(l.shares), 0);
    const totalCost = lots.reduce((s, l) => s + parseFloat(l.shares) * parseFloat(l.costPrice), 0);
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
    <div className="h-screen flex flex-col p-4 md:p-6 max-w-none md:max-w-4xl mx-auto">
      <div className="shrink-0 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => router.push("/strategies")}>
            <ArrowLeft size={16} />
          </Button>
          {editingName ? (
            <input
              aria-label="strategy name"
              className="text-2xl font-bold bg-transparent border-b border-primary outline-none w-auto min-w-0"
              value={nameInput}
              autoFocus
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              onBlur={handleRenameSave}
            />
          ) : (
            <h1 className="text-2xl font-bold">{strategy.name}</h1>
          )}
          <button
            aria-label="rename strategy"
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => {
              setNameInput(strategy.name);
              setEditingName(true);
            }}
          >
            <Edit2 size={16} />
          </button>
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

      <div className="flex gap-1 mb-4 border-b shrink-0 overflow-x-auto">
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
        <div>
          <div className="flex justify-end mb-2">
            {editingDescription ? (
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveDescription} disabled={savingDescription}>
                  {savingDescription ? "保存中..." : "保存"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditingDescription(false)}>
                  取消
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                aria-label="edit description"
                onClick={() => {
                  setDescriptionInput(strategy.content);
                  setEditingDescription(true);
                }}
              >
                <Edit2 size={14} />
              </Button>
            )}
          </div>
          {editingDescription ? (
            <Textarea
              aria-label="description input"
              value={descriptionInput}
              onChange={(e) => setDescriptionInput(e.target.value)}
              className="min-h-[300px] font-mono text-sm"
            />
          ) : (
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{strategy.content}</ReactMarkdown>
            </div>
          )}
        </div>
      )}

      {tab === "script" && (
        <div>
          <div className="relative">
            <div className="absolute top-2 right-2 flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                aria-label="re-parse script"
                onClick={() => {
                  setShowReparse(!showReparse);
                  setReparseParsed(null);
                  setReparseScript("");
                }}
              >
                <RefreshCw size={14} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigator.clipboard.writeText(strategy.script)}
              >
                <Copy size={14} />
              </Button>
            </div>
            <pre className="bg-muted p-4 rounded-md text-sm overflow-x-auto">
              <code>{strategy.script}</code>
            </pre>
          </div>

          {showReparse && (
            <div className="mt-4 border rounded-md p-4">
              {!reparseParsed ? (
                <>
                  <div className="flex gap-2 mb-4">
                    <Button
                      variant={reparseTab === "upload" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setReparseTab("upload")}
                    >
                      <Upload size={14} className="mr-1" /> 上传文件
                    </Button>
                    <Button
                      variant={reparseTab === "paste" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setReparseTab("paste")}
                    >
                      <FileText size={14} className="mr-1" /> 粘贴代码
                    </Button>
                  </div>
                  {reparseTab === "upload" ? (
                    <Input type="file" accept=".py" onChange={handleReparseFileUpload} />
                  ) : (
                    <Textarea
                      placeholder="粘贴新版 Python 策略脚本..."
                      className="min-h-[200px] font-mono text-sm"
                      value={reparseScript}
                      onChange={(e) => setReparseScript(e.target.value)}
                    />
                  )}
                  <div className="flex gap-2 mt-4">
                    <Button onClick={handleReparse} disabled={reparsing || !reparseScript.trim()}>
                      {reparsing ? "解析中..." : "解析脚本"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowReparse(false);
                        setReparseScript("");
                      }}
                    >
                      取消
                    </Button>
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">策略名称</label>
                    <Input
                      value={reparseEditName}
                      onChange={(e) => setReparseEditName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">股票代码</label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {reparseEditSymbols.map((s, i) => (
                        <Badge key={i} variant="secondary">
                          {s}
                          <button
                            className="ml-1 text-xs hover:text-destructive"
                            onClick={() =>
                              setReparseEditSymbols(reparseEditSymbols.filter((_, j) => j !== i))
                            }
                          >
                            x
                          </button>
                        </Badge>
                      ))}
                      <Input
                        className="w-24 h-7 text-xs"
                        placeholder="+ 添加"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && e.currentTarget.value.trim()) {
                            setReparseEditSymbols([
                              ...reparseEditSymbols,
                              e.currentTarget.value.trim().toUpperCase(),
                            ]);
                            e.currentTarget.value = "";
                          }
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium">新描述预览</label>
                    <div className="mt-1 p-3 bg-muted rounded-md text-sm max-h-[400px] overflow-y-auto prose prose-sm">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{reparseParsed.content}</ReactMarkdown>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleReparseConfirm} disabled={savingReparse}>
                      {savingReparse ? "更新中..." : "确认更新"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setReparseParsed(null);
                        setReparseScript("");
                      }}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "positions" && (
  <div className="space-y-4">
    <PnlChart fetchUrl={`/api/strategies/${id}/history`} />

    <div className="flex justify-end">
      <Button size="sm" onClick={() => setShowAddLot(!showAddLot)}>
        <Plus size={14} className="mr-1" /> 新增批次
      </Button>
    </div>

    {showAddLot && (
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">股票代码</label>
              <Input value={lotSymbol} onChange={(e) => setLotSymbol(e.target.value)} placeholder="QQQ" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">股数</label>
              <Input type="number" step="0.0001" value={lotShares} onChange={(e) => setLotShares(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">成本价</label>
              <Input type="number" step="0.01" value={lotPrice} onChange={(e) => setLotPrice(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">建仓日期</label>
              <Input type="date" value={lotDate} onChange={(e) => setLotDate(e.target.value)} />
            </div>
            <div className="col-span-1 md:col-span-2">
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
        <div key={pos.id} className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between flex-wrap gap-1 mb-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{pos.symbol}</span>
              <span className="text-sm text-muted-foreground">
                {formatShares(totalShares)} 股 @ ${avgCost.toFixed(2)}
              </span>
            </div>
            {pos.latestPrice !== null ? (
              <span className={`text-sm font-medium ${pnlPositive ? "text-red-600" : "text-green-500"}`}>
                ${pos.latestPrice} &nbsp;
                <span className={`text-xs px-1.5 py-0.5 rounded ${pnlPositive ? "bg-red-50 text-red-700" : "bg-green-50 text-green-600"}`}>
                  {pnlPositive ? "+" : ""}{pnl}%
                </span>
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">--</span>
            )}
          </div>
          <div className="divide-y">
            {pos.positionLots.map((lot) => (
              <div key={lot.id} className="flex items-center justify-between py-2 first:pt-0 last:pb-0 hover:bg-muted/40 transition-colors">
                <div className="flex items-center gap-3 text-sm">
                  <span className="tabular-nums">{lot.lotDate}</span>
                  <span className="tabular-nums">{formatShares(lot.shares)}股</span>
                  <span className="tabular-nums">${parseFloat(lot.costPrice).toFixed(2)}</span>
                  {lot.notes && (
                    <span className="text-muted-foreground text-xs">{lot.notes}</span>
                  )}
                </div>
                <button
                  className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
                  onClick={() => handleDeleteLot(lot.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
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
