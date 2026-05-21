"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MonitoringRun {
  id: string;
  strategyId: string;
  strategyName: string;
  runDate: string;
  status: string;
  analysis: string | null;
  hasActionItems: boolean | null;
  error: string | null;
  createdAt: string;
}

export default function MonitoringPage() {
  return (
    <Suspense>
      <MonitoringContent />
    </Suspense>
  );
}

function MonitoringContent() {
  const searchParams = useSearchParams();
  const runIdParam = searchParams.get("runId");

  const [runs, setRuns] = useState<MonitoringRun[]>([]);
  const [strategyFilter, setStrategyFilter] = useState<string>("all");
  const [strategies, setStrategies] = useState<Array<{ id: string; name: string }>>([]);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function deleteRun(id: string) {
    setDeletingId(id);
    await fetch(`/api/monitoring/runs/${id}`, { method: "DELETE" });
    setRuns((prev) => prev.filter((r) => r.id !== id));
    if (expandedRun === id) setExpandedRun(null);
    setDeletingId(null);
  }

  useEffect(() => {
    fetch("/api/strategies")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setStrategies(data); });
  }, []);

  useEffect(() => {
    const params = strategyFilter !== "all" ? `?strategyId=${strategyFilter}` : "";
    fetch(`/api/monitoring/runs${params}`)
      .then((r) => r.json())
      .then((data) => {
        setRuns(data);
        if (runIdParam) setExpandedRun(runIdParam);
      });
  }, [strategyFilter, runIdParam]);

  const stats = {
    total: runs.length,
    completed: runs.filter((r) => r.status === "completed").length,
    failed: runs.filter((r) => r.status === "failed").length,
    actionItems: runs.filter((r) => r.hasActionItems).length,
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">监控中心</h1>

      <div className="grid grid-cols-4 gap-3 mb-6">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground">总运行次数</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
            <p className="text-xs text-muted-foreground">完成</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-red-600">{stats.failed}</p>
            <p className="text-xs text-muted-foreground">失败</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-orange-600">{stats.actionItems}</p>
            <p className="text-xs text-muted-foreground">操作建议</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-3 mb-4">
        <Select value={strategyFilter} onValueChange={(v) => setStrategyFilter(v ?? "all")}>
          <SelectTrigger className="w-48">
            <SelectValue>
              {strategyFilter === "all"
                ? "全部策略"
                : (strategies.find((s) => s.id === strategyFilter)?.name ?? "按策略过滤")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部策略</SelectItem>
            {strategies.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {runs.length === 0 && (
          <p className="text-muted-foreground text-center py-10">暂无监控记录</p>
        )}
        {runs.map((run) => (
          <Card
            key={run.id}
            className="cursor-pointer"
            onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{run.runDate}</span>
                  <span className="text-sm text-muted-foreground">{run.strategyName}</span>
                </div>
                <div className="flex items-center gap-2">
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
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    disabled={deletingId === run.id}
                    onClick={(e) => { e.stopPropagation(); deleteRun(run.id); }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {expandedRun === run.id && (
                <div className="mt-3 pt-3 border-t">
                  {run.status === "completed" && run.analysis && (
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.analysis}</ReactMarkdown>
                    </div>
                  )}
                  {run.status === "failed" && run.error && (
                    <p className="text-sm text-destructive">{run.error}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
