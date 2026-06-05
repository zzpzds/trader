"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface MemoryFormValues {
  id?: string;
  title: string;
  content: string;
  kind: "note" | "idea" | "lesson" | "context";
  strategyId: string | null;
  symbol: string | null;
  tags: string[];
  pinned: boolean;
}

interface Strategy {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  initial: Partial<MemoryFormValues>;
  strategies: Strategy[];
  onClose: () => void;
  onSaved: () => void;
}

const KINDS: Array<{ value: MemoryFormValues["kind"]; label: string }> = [
  { value: "note", label: "复盘笔记" },
  { value: "idea", label: "想法/假设" },
  { value: "lesson", label: "经验教训" },
  { value: "context", label: "背景资料" },
];

export function MemoryDialog({ open, initial, strategies, onClose, onSaved }: Props) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<MemoryFormValues["kind"]>("note");
  const [strategyId, setStrategyId] = useState<string>("");
  const [symbol, setSymbol] = useState("");
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(initial.title ?? "");
      setContent(initial.content ?? "");
      setKind(initial.kind ?? "note");
      setStrategyId(initial.strategyId ?? "");
      setSymbol(initial.symbol ?? "");
      setPinned(initial.pinned ?? false);
    }
  }, [open, initial]);

  if (!open) return null;

  async function handleSave() {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      const body = {
        title,
        content,
        kind,
        strategyId: strategyId || null,
        symbol: symbol || null,
        pinned,
      };
      const url = initial.id ? `/api/memories/${initial.id}` : "/api/memories";
      const method = initial.id ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!initial.id) return;
    if (!confirm("确认删除这条笔记？")) return;
    await fetch(`/api/memories/${initial.id}`, { method: "DELETE" });
    onSaved();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-lg bg-background border shadow-lg p-4 space-y-3">
        <h2 className="text-lg font-semibold">{initial.id ? "编辑笔记" : "新建笔记"}</h2>
        <Input
          placeholder="标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Textarea
          placeholder="内容"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
        />
        <div className="flex gap-2 flex-wrap items-center">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as MemoryFormValues["kind"])}
            className="border rounded px-2 py-1 text-sm bg-background"
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <select
            value={strategyId}
            onChange={(e) => setStrategyId(e.target.value)}
            className="border rounded px-2 py-1 text-sm bg-background"
          >
            <option value="">（不绑定策略）</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Input
            placeholder="标的（可选）"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            className="w-40"
          />
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
            />
            置顶（注入 prompt）
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          {initial.id && (
            <Button variant="destructive" onClick={handleDelete}>
              删除
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving || !title.trim() || !content.trim()}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}
