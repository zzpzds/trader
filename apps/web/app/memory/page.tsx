"use client";

import { useState, useEffect, useCallback } from "react";
import { Pin, Search, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MemoryDialog, type MemoryFormValues } from "@/components/memory-dialog";

interface Memory {
  id: string;
  title: string;
  content: string;
  kind: "note" | "idea" | "lesson" | "context";
  strategyId: string | null;
  symbol: string | null;
  tags: string[];
  pinned: boolean;
  updatedAt: string;
}

interface Strategy { id: string; name: string }

const KIND_LABEL: Record<Memory["kind"], string> = {
  note: "复盘",
  idea: "想法",
  lesson: "教训",
  context: "背景",
};

export default function MemoryPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [q, setQ] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("");
  const [strategyFilter, setStrategyFilter] = useState<string>("");
  const [editing, setEditing] = useState<Partial<MemoryFormValues> | null>(null);

  const fetchMemories = useCallback(async () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (kindFilter) params.set("kind", kindFilter);
    if (strategyFilter) params.set("strategyId", strategyFilter);
    const res = await fetch(`/api/memories?${params}`);
    setMemories(await res.json());
  }, [q, kindFilter, strategyFilter]);

  useEffect(() => {
    const t = setTimeout(fetchMemories, 300);
    return () => clearTimeout(t);
  }, [fetchMemories]);

  useEffect(() => {
    fetch("/api/strategies")
      .then((r) => r.json())
      .then(setStrategies);
  }, []);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-60">
          <Search size={14} className="absolute left-2 top-2.5 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索笔记…"
            className="pl-7"
          />
        </div>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="border rounded px-2 py-1 text-sm bg-background"
        >
          <option value="">全部类型</option>
          {Object.entries(KIND_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select
          value={strategyFilter}
          onChange={(e) => setStrategyFilter(e.target.value)}
          className="border rounded px-2 py-1 text-sm bg-background"
        >
          <option value="">全部策略</option>
          {strategies.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <Button onClick={() => setEditing({})}>
          <Plus size={14} /> 新建笔记
        </Button>
      </div>

      {memories.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          还没有笔记，monitoring 时不会注入任何上下文。
        </p>
      )}

      <div className="grid gap-2">
        {memories.map((m) => {
          const strat = strategies.find((s) => s.id === m.strategyId);
          return (
            <Card
              key={m.id}
              className="cursor-pointer hover:shadow"
              onClick={() => setEditing({
                id: m.id,
                title: m.title,
                content: m.content,
                kind: m.kind,
                strategyId: m.strategyId,
                symbol: m.symbol,
                tags: m.tags,
                pinned: m.pinned,
              })}
            >
              <CardContent className="py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {m.pinned && <Pin size={12} className="text-amber-600" />}
                  <span className="font-medium">{m.title}</span>
                  <Badge variant="outline" className="text-[10px]">{KIND_LABEL[m.kind]}</Badge>
                  {strat && <Badge variant="secondary" className="text-[10px]">{strat.name}</Badge>}
                  {m.symbol && <Badge variant="secondary" className="text-[10px]">{m.symbol}</Badge>}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {new Date(m.updatedAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{m.content}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {editing !== null && (
        <MemoryDialog
          open={true}
          initial={editing}
          strategies={strategies}
          onClose={() => setEditing(null)}
          onSaved={fetchMemories}
        />
      )}
    </div>
  );
}
